const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    const base = {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_BROKERTOKEN: "tok",
        INPUT_APPLICATIONNAME: "app",
        INPUT_VERSION: "abc123",
        INPUT_TOENVIRONMENT: "prod",
        INPUT_RETRYWHILEUNKNOWN: "0",
        INPUT_RETRYINTERVAL: "0",
    };
    Object.assign(process.env, base, overrides);
}

function mockFetch(responses) {
    let i = 0;
    global.fetch = async () => {
        const r = responses[Math.min(i, responses.length - 1)];
        i++;
        return { ok: true, json: async () => r };
    };
}

test("deployable: does not throw or exit", async () => {
    setEnv();
    mockFetch([{ summary: { deployable: true } }]);
    delete require.cache[require.resolve("./index.js")];
    const { run } = require("./index.js");
    await assert.doesNotReject(run());
});

test("not deployable: exits with code 1", async () => {
    setEnv();
    mockFetch([{ summary: { deployable: false, reason: "no verified pact" } }]);
    delete require.cache[require.resolve("./index.js")];
    const { run } = require("./index.js");

    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error("exit"); };

    await assert.rejects(run());
    assert.strictEqual(exitCode, 1);

    process.exit = originalExit;
});

test("unknown result: retries then succeeds", async () => {
    setEnv({ INPUT_RETRYWHILEUNKNOWN: "1" });
    mockFetch([
        { summary: { unknown: 1 } },
        { summary: { deployable: true } },
    ]);
    delete require.cache[require.resolve("./index.js")];
    const { run } = require("./index.js");
    await assert.doesNotReject(run());
});