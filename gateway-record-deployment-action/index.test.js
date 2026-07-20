const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_BROKERTOKEN: "tok",
        INPUT_APPLICATIONNAME: "Gateway",
        INPUT_VERSION: "gateway123",
        INPUT_ENVIRONMENT: "prod"
    }, overrides);
}

function freshModule() {
    delete require.cache[require.resolve("./index.js")];
    return require("./index.js");
}

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () =>
            typeof body === "string" ? body : JSON.stringify(body)
    };
}

test("getGatewayDownstreams: finds gateway-provider participants", async () => {
    global.fetch = async () => response({
        _embedded: {
            pacticipants: [
                { name: "Gateway---ProviderA" },
                { name: "Gateway---ProviderB" },
                { name: "Consumer---Gateway" },
                { name: "Unrelated" }
            ]
        }
    });

    const { getGatewayDownstreams } = freshModule();

    const result = await getGatewayDownstreams(
        "https://broker.example.com",
        "tok",
        "Gateway"
    );

    assert.deepStrictEqual(result, [
        "Gateway---ProviderA",
        "Gateway---ProviderB"
    ]);
});

test("run: records deployment for all downstreams", async () => {
    setEnv();
    const recorded = [];

    global.fetch = async (url, options = {}) => {
        if (url.endsWith("/environments")) {
            return response({
                _embedded: {
                    environments: [{ name: "prod", uuid: "env-123" }]
                }
            });
        }

        if (url.endsWith("/pacticipants")) {
            return response({
                _embedded: {
                    pacticipants: [
                        { name: "Gateway---ProviderA" },
                        { name: "Gateway---ProviderB" }
                    ]
                }
            });
        }

        if (options.method === "POST") {
            recorded.push(url);
            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.strictEqual(recorded.length, 2);
    assert.ok(recorded.some(url => url.includes("Gateway---ProviderA")));
    assert.ok(recorded.some(url => url.includes("Gateway---ProviderB")));
    assert.ok(recorded.every(url => url.includes("gateway123")));
});

test("run: no downstreams -> exits cleanly", async () => {
    setEnv();

    global.fetch = async url => {
        if (url.endsWith("/environments")) {
            return response({
                _embedded: {
                    environments: [{ name: "prod", uuid: "env-123" }]
                }
            });
        }

        return response({
            _embedded: {
                pacticipants: []
            }
        });
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());
});

test("run: environment does not exist -> fails", async () => {
    setEnv();

    global.fetch = async url => {
        if (url.endsWith("/environments")) {
            return response({
                _embedded: {
                    environments: []
                }
            });
        }

        return response({
            _embedded: {
                pacticipants: []
            }
        });
    };

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /Environment 'prod' was not found/
    );
});

test("brokerRequest: Broker error -> fails", async () => {
    global.fetch = async () => response("Unauthorized", 401);

    const { brokerRequest } = freshModule();

    await assert.rejects(
        brokerRequest("https://broker.example.com/test", "bad-token"),
        /Broker error 401/
    );
});