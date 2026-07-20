const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_APPLICATIONNAME: "Consumer",
        INPUT_VERSION: "abc123",
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
        json: async () => body,
        text: async () =>
            typeof body === "string"
                ? body
                : JSON.stringify(body)
    };
}

test("getEnvironmentUuid: returns matching UUID", async () => {
    global.fetch = async () => response({
        _embedded: {
            environments: [
                { name: "test", uuid: "env-test" },
                { name: "prod", uuid: "env-prod" }
            ]
        }
    });

    const { getEnvironmentUuid } = freshModule();

    const uuid = await getEnvironmentUuid(
        "https://broker.example.com",
        "prod"
    );

    assert.strictEqual(uuid, "env-prod");
});

test("run: records deployment", async () => {
    setEnv();
    let recorded;

    global.fetch = async (url, options = {}) => {
        if (url.endsWith("/environments")) {
            return response({
                _embedded: {
                    environments: [
                        { name: "prod", uuid: "env-prod" }
                    ]
                }
            });
        }

        if (options.method === "POST") {
            recorded = { url, options };
            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.ok(recorded.url.includes("/pacticipants/Consumer/"));
    assert.ok(recorded.url.includes("/versions/abc123/"));
    assert.ok(recorded.url.endsWith("/environment/env-prod"));
    assert.strictEqual(recorded.options.method, "POST");
});

test("run: environment does not exist -> fails", async () => {
    setEnv();

    global.fetch = async () => response({
        _embedded: {
            environments: []
        }
    });

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /Environment prod not found/
    );
});

test("getEnvironmentUuid: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Unauthorized", 401);

    const { getEnvironmentUuid } = freshModule();

    await assert.rejects(
        getEnvironmentUuid(
            "https://broker.example.com",
            "prod"
        ),
        /Failed to get environments: 401/
    );
});

test("recordDeployment: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Forbidden", 403);

    const { recordDeployment } = freshModule();

    await assert.rejects(
        recordDeployment(
            "https://broker.example.com",
            "Consumer",
            "abc123",
            "env-prod",
            "prod"
        ),
        /Failed to record deployment: 403/
    );
});

test("run: missing input -> fails", async () => {
    setEnv({
        INPUT_VERSION: ""
    });

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /version is required/
    );
});