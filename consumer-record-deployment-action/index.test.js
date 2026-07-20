const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_BROKERTOKEN: "tok",
        INPUT_APPLICATIONNAME: "Casino",
        INPUT_VERSION: "consumer123",
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

test("findCompositeVersion: finds matching version", () => {
    const { findCompositeVersion } = freshModule();

    assert.strictEqual(
        findCompositeVersion(
            ["consumer123-gateway456"],
            "consumer123",
            "gateway456"
        ),
        "consumer123-gateway456"
    );
});

test("run: records Consumer-Gateway deployment", async () => {
    setEnv();
    let recorded;

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
                        { name: "Casino---Gateway" },
                        { name: "Gateway---FavoriteApi" }
                    ]
                }
            });
        }

        if (url.includes("currently-deployed-versions")) {
            return response({
                _embedded: {
                    versions: [{ number: "gateway456" }]
                }
            });
        }

        if (options.method === "POST" && url.includes("deployed-versions")) {
            recorded = url;
            return response({});
        }

        if (url.includes("Casino---Gateway/versions")) {
            return response({
                _embedded: {
                    versions: [{ number: "consumer123-gateway456" }]
                }
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();
    await assert.doesNotReject(run());

    assert.ok(recorded);
    assert.ok(recorded.includes("Casino---Gateway"));
    assert.ok(recorded.includes("consumer123-gateway456"));
});

test("run: no Consumer-Gateway participant -> fails", async () => {
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

    await assert.rejects(
        run(),
        /No Consumer-Gateway participants found/
    );
});

test("run: gateway is not deployed -> fails", async () => {
    setEnv();

    global.fetch = async url => {
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
                        { name: "Casino---Gateway" },
                        { name: "Gateway---FavoriteApi" }
                    ]
                }
            });
        }

        return response({
            _embedded: {
                versions: []
            }
        });
    };

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /Gateway 'Gateway' is not deployed/
    );
});

test("run: inconsistent gateway versions -> fails", async () => {
    setEnv();

    global.fetch = async url => {
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
                        { name: "Casino---Gateway" },
                        { name: "Gateway---ProviderA" },
                        { name: "Gateway---ProviderB" }
                    ]
                }
            });
        }

        const version = url.includes("ProviderA")
            ? "gateway111"
            : "gateway222";

        return response({
            _embedded: {
                versions: [{ number: version }]
            }
        });
    };

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /inconsistent deployed versions/
    );
});

test("run: composite version does not exist -> fails", async () => {
    setEnv();

    global.fetch = async url => {
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
                        { name: "Casino---Gateway" },
                        { name: "Gateway---FavoriteApi" }
                    ]
                }
            });
        }

        if (url.includes("currently-deployed-versions")) {
            return response({
                _embedded: {
                    versions: [{ number: "gateway456" }]
                }
            });
        }

        return response({
            _embedded: {
                versions: [{ number: "different-version" }]
            }
        });
    };

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /No composite version found/
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