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