const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_BROKERTOKEN: "tok",
        INPUT_CONSUMERNAME: "Frontend",
        INPUT_CONSUMERVERSION: "sha1",
        INPUT_TOENVIRONMENT: "prod",
        INPUT_RETRYWHILEUNKNOWN: "0",
        INPUT_RETRYINTERVAL: "0",
    }, overrides);
}

// Routes fetch calls to canned JSON based on URL shape.
function mockFetch(routes) {
    global.fetch = async (url, options = {}) => {
        for (const route of routes) {
            if (route.match(url, options)) {
                return { ok: true, json: async () => route.body, text: async () => "" };
            }
        }
        throw new Error(`No mock route for ${options.method || "GET"} ${url}`);
    };
}

function freshModule() {
    delete require.cache[require.resolve("./index.js")];
    return require("./index.js");
}

test("run: no gateways, consumer deployable -> no exit", async () => {
    setEnv();
    mockFetch([
        { match: (u) => u.includes("/pacticipants"), body: { _embedded: { pacticipants: [] } } },
        { match: (u) => u.includes("/matrix"), body: { summary: { deployable: true } } },
    ]);
    const { run } = freshModule();
    await assert.doesNotReject(run());
});

test("run: consumer not deployable -> exits 1", async () => {
    setEnv();
    mockFetch([
        { match: (u) => u.includes("/pacticipants"), body: { _embedded: { pacticipants: [] } } },
        { match: (u) => u.includes("/matrix"), body: { summary: { deployable: false, reason: "no pact" } } },
    ]);
    const { run } = freshModule();

    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error("exit"); };
    await assert.rejects(run());
    assert.strictEqual(exitCode, 1);
    process.exit = originalExit;
});

test("getGatewayNames: strips consumer prefix", async () => {
    setEnv();
    mockFetch([
        {
            match: (u) => u.includes("/pacticipants"), body: {
                _embedded: {
                    pacticipants: [
                        { name: "Frontend---Gateway" },
                        { name: "Frontend---Gateway---v2" },
                        { name: "OtherApp---Gateway" },
                    ]
                }
            }
        },
    ]);
    const { getGatewayNames } = freshModule();
    const names = await getGatewayNames("https://broker.example.com", "tok", "Frontend");
    assert.deepStrictEqual(names, ["Gateway", "Gateway---v2"]);
});

test("checkGatewayPairs: real broker error on one pair fails the check (not silently true)", async () => {
    setEnv();
    global.fetch = async (url) => {
        if (url.includes("/pacticipants")) {
            return {
                ok: true, json: async () => ({
                    _embedded: {
                        pacticipants: [
                            { name: "Gateway---FavoriteApi" },
                        ]
                    }
                })
            };
        }
        // Simulate broker outage for the getVerifiedGwSha matrix call
        return { ok: false, status: 500, text: async () => "broker down" };
    };

    const { checkGatewayPairs } = freshModule();
    const results = await checkGatewayPairs(
        "https://broker.example.com", "tok", "Frontend", "sha1", "Gateway",
        "prod", 0, 0
    );
    assert.deepStrictEqual(results, [false]);
});

test("checkGatewayPairs: no verified row for a pair is still a legitimate skip (true)", async () => {
    setEnv();
    global.fetch = async (url) => {
        if (url.includes("/pacticipants")) {
            return {
                ok: true, json: async () => ({
                    _embedded: {
                        pacticipants: [
                            { name: "Gateway---FavoriteApi" },
                        ]
                    }
                })
            };
        }
        if (url.includes("/matrix")) {
            // No matching row -> getVerifiedGwSha throws "No verified row found..."
            return { ok: true, json: async () => ({ matrix: [] }) };
        }
        throw new Error(`unexpected call: ${url}`);
    };

    const { checkGatewayPairs } = freshModule();
    const results = await checkGatewayPairs(
        "https://broker.example.com", "tok", "Frontend", "sha1", "Gateway",
        "prod", 0, 0
    );
    assert.deepStrictEqual(results, [true]);
});

// Simulates a broker where: Frontend is standalone-deployable, GW---API is
// verified against Frontend@sha1 with gateway version gwsha1, the
// Frontend---GW/API pact exists, publish succeeds, and the resulting
// composite version (sha1-gwsha1) is deployable.
function mockHappyPathBroker() {
    const posts = [];

    global.fetch = async (url, options = {}) => {
        if (url.includes("/pacticipants")) {
            return {
                ok: true,
                json: async () => ({
                    _embedded: {
                        pacticipants: [
                            { name: "Frontend---GW" },
                            { name: "GW---API" },
                        ]
                    }
                })
            };
        }

        if (url.includes("/matrix") && url.includes("q[][latest]=true")) {
            // getVerifiedGwSha: matrix lookup for Frontend@sha1 vs GW---API
            return {
                ok: true,
                json: async () => ({
                    matrix: [{
                        consumer: { name: "Frontend", version: { number: "sha1" } },
                        provider: { name: "GW---API", version: { number: "gwsha1" } }
                    }]
                })
            };
        }

        if (url.includes("/matrix")) {
            // canIDeploy checks for Frontend and Frontend---GW -- both deployable here
            return { ok: true, json: async () => ({ summary: { deployable: true } }) };
        }

        if (url.includes("/pacts/provider/API/consumer/Frontend---GW/latest")) {
            return {
                ok: true,
                json: async () => ({
                    consumer: { name: "Frontend---GW" },
                    provider: { name: "API" }
                })
            };
        }

        if (url.includes("/publish")) {
            posts.push(JSON.parse(options.body));
            return { ok: true, json: async () => ({}) };
        }

        throw new Error(`No mock route for ${options.method || "GET"} ${url}`);
    };

    return posts;
}

test("checkGatewayPairs: happy path -- verified, published, deployable", async () => {
    setEnv();
    const posts = mockHappyPathBroker();

    const { checkGatewayPairs } = freshModule();
    const results = await checkGatewayPairs(
        "https://broker.example.com", "tok", "Frontend", "sha1", "GW",
        "prod", 0, 0
    );

    assert.deepStrictEqual(results, [true]);
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].pacticipantName, "Frontend---GW");
    assert.strictEqual(posts[0].pacticipantVersionNumber, "sha1-gwsha1");
});

test("run: end-to-end happy path -- standalone and gateway pair both deployable, no exit", async () => {
    setEnv();
    mockHappyPathBroker();

    const { run } = freshModule();
    await assert.doesNotReject(run());
});