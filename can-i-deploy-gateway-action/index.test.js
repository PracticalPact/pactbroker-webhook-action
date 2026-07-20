const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_BROKERTOKEN: "tok",
        INPUT_APPLICATIONNAME: "Gateway",
        INPUT_TOENVIRONMENT: "prod",
        INPUT_RETRYWHILEUNKNOWN: "0",
        INPUT_RETRYINTERVAL: "0",
    }, overrides);
}

function freshModule() {
    delete require.cache[require.resolve("./index.js")];
    return require("./index.js");
}

test("getGatewayDownstreamNames / getGatewayConsumerNames: split correctly", async () => {
    setEnv();
    global.fetch = async () => ({
        ok: true, json: async () => ({
            _embedded: {
                pacticipants: [
                    { name: "Gateway---FavoriteApi" },
                    { name: "Casino---Gateway" },
                    { name: "Unrelated" },
                ]
            }
        })
    });

    const { getGatewayDownstreamNames, getGatewayConsumerNames } = freshModule();
    const downstreams = await getGatewayDownstreamNames("https://broker.example.com", "tok", "Gateway");
    const consumers = await getGatewayConsumerNames("https://broker.example.com", "tok", "Gateway");
    assert.deepStrictEqual(downstreams, ["Gateway---FavoriteApi"]);
    assert.deepStrictEqual(consumers, ["Casino---Gateway"]);
});

test("run: no downstreams or consumers -> logs and exits cleanly", async () => {
    setEnv();
    global.fetch = async () => ({ ok: true, json: async () => ({ _embedded: { pacticipants: [] } }) });
    const { run } = freshModule();
    await assert.doesNotReject(run());
});

test("run: all participants deployable -> no exit", async () => {
    setEnv();
    global.fetch = async (url) => {
        if (url.includes("/pacticipants")) {
            return {
                ok: true, json: async () => ({
                    _embedded: {
                        pacticipants: [
                            { name: "Gateway---FavoriteApi" },
                            { name: "Casino---Gateway" },
                        ]
                    }
                })
            };
        }
        return { ok: true, json: async () => ({ summary: { deployable: true } }) };
    };
    const { run } = freshModule();
    await assert.doesNotReject(run());
});

test("run: one participant not deployable -> exits 1", async () => {
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
        return { ok: true, json: async () => ({ summary: { deployable: false, reason: "not verified" } }) };
    };
    const { run } = freshModule();

    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error("exit"); };
    await assert.rejects(run());
    assert.strictEqual(exitCode, 1);
    process.exit = originalExit;
});

test("canIDeployLatest: retries on unknown then succeeds", async () => {
    setEnv();
    let call = 0;
    global.fetch = async () => {
        call++;
        const body = call === 1 ? { summary: { unknown: 1 } } : { summary: { deployable: true } };
        return { ok: true, json: async () => body };
    };
    const { canIDeployLatest } = freshModule();
    const result = await canIDeployLatest("https://broker.example.com", "tok", "Gateway---FavoriteApi", "prod", 1, 0);
    assert.strictEqual(result, true);
    assert.strictEqual(call, 2);
});