const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_GATEWAYNAME: "Gateway",
        GITHUB_REPOSITORY: "owner/repo"
    }, overrides);
}

function freshModule() {
    delete require.cache[require.resolve("./index.js")];
    return require("./index.js");
}

function response(body = {}, status = 200) {
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

test("getParticipants: finds gateway participants", async () => {
    global.fetch = async () => response({
        _embedded: {
            pacticipants: [
                { name: "Gateway---Provider" },
                { name: "Consumer---Gateway" },
                { name: "Unrelated" }
            ]
        }
    });

    const { getParticipants } = freshModule();

    const result = await getParticipants(
        "https://broker.example.com",
        "Gateway"
    );

    assert.deepStrictEqual(result, [
        "Gateway---Provider",
        "Consumer---Gateway"
    ]);
});

test("run: registers all gateway participants", async () => {
    setEnv();
    const requests = [];

    global.fetch = async (url, options = {}) => {
        if (url.endsWith("/pacticipants")) {
            return response({
                _embedded: {
                    pacticipants: [
                        { name: "Gateway---Provider" },
                        { name: "Consumer---Gateway" }
                    ]
                }
            });
        }

        if (options.method === "PATCH") {
            requests.push({ url, options });
            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.strictEqual(requests.length, 2);
    assert.ok(requests.some(r =>
        r.url.includes("Gateway---Provider")
    ));
    assert.ok(requests.some(r =>
        r.url.includes("Consumer---Gateway")
    ));

    const body = JSON.parse(requests[0].options.body);

    assert.strictEqual(
        body.repositoryUrl,
        "https://github.com/owner/repo"
    );
    assert.strictEqual(body.mainBranch, "main");
});

test("run: no matching participants -> exits cleanly", async () => {
    setEnv();

    global.fetch = async () => response({
        _embedded: {
            pacticipants: []
        }
    });

    const { run } = freshModule();

    await assert.doesNotReject(run());
});

test("getParticipants: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Unauthorized", 401);

    const { getParticipants } = freshModule();

    await assert.rejects(
        getParticipants(
            "https://broker.example.com",
            "Gateway"
        ),
        /Failed to get participants: 401/
    );
});

test("registerParticipant: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Forbidden", 403);

    const { registerParticipant } = freshModule();

    await assert.rejects(
        registerParticipant(
            "https://broker.example.com",
            "Gateway---Provider",
            "https://github.com/owner/repo"
        ),
        /Failed to register Gateway---Provider: 403/
    );
});

test("run: missing repository -> fails", async () => {
    setEnv();
    delete process.env.GITHUB_REPOSITORY;

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /GITHUB_REPOSITORY is required/
    );
});