const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_GITHUBTOKEN: "token",
        INPUT_PROVIDERNAME: "Provider",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_ACTOR: "tester"
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
            typeof body === "string" ? body : JSON.stringify(body)
    };
}

test("hasWebhookAlready: matching webhook exists", async () => {
    global.fetch = async url => {
        if (url.includes("/webhooks/provider/")) {
            return response({
                _links: {
                    "pb:webhooks": [
                        {
                            href: "https://broker.example.com/webhooks/1"
                        }
                    ]
                }
            });
        }

        return response({
            events: [
                {
                    name: "contract_requiring_verification_published"
                }
            ]
        });
    };

    const { hasWebhookAlready } = freshModule();

    assert.strictEqual(
        await hasWebhookAlready(
            "https://broker.example.com",
            "Provider",
            "Consumer"
        ),
        true
    );
});

test("run: creates missing webhooks for unique consumers", async () => {
    setEnv();
    const created = [];

    global.fetch = async (url, options = {}) => {
        if (url.includes("/pacts/provider/")) {
            return response({
                _links: {
                    "pb:pacts": [
                        { name: "ConsumerA" },
                        { name: "ConsumerA" },
                        { name: "ConsumerB" }
                    ]
                }
            });
        }

        if (
            url.includes("/webhooks/provider/") &&
            (!options.method || options.method === "GET")
        ) {
            return response({
                _links: {
                    "pb:webhooks": []
                }
            });
        }

        if (options.method === "POST") {
            created.push({
                url,
                body: JSON.parse(options.body)
            });

            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.strictEqual(created.length, 2);
    assert.ok(created.some(request =>
        request.url.includes("ConsumerA")
    ));
    assert.ok(created.some(request =>
        request.url.includes("ConsumerB")
    ));
});

test("run: existing webhook is not created again", async () => {
    setEnv();
    let posts = 0;

    global.fetch = async (url, options = {}) => {
        if (url.includes("/pacts/provider/")) {
            return response({
                _links: {
                    "pb:pacts": [
                        { name: "Consumer" }
                    ]
                }
            });
        }

        if (
            url.includes("/webhooks/provider/") &&
            (!options.method || options.method === "GET")
        ) {
            return response({
                _links: {
                    "pb:webhooks": [
                        {
                            href: "https://broker.example.com/webhooks/1"
                        }
                    ]
                }
            });
        }

        if (url.endsWith("/webhooks/1")) {
            return response({
                events: [
                    {
                        name: "contract_requiring_verification_published"
                    }
                ]
            });
        }

        if (options.method === "POST") {
            posts++;
            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());
    assert.strictEqual(posts, 0);
});

test("createWebhook: sends correct payload", async () => {
    let request;

    global.fetch = async (url, options) => {
        request = {
            url,
            body: JSON.parse(options.body)
        };

        return response({});
    };

    const { createWebhook } = freshModule();

    await createWebhook(
        "https://broker.example.com",
        "https://api.github.com/repos/owner/repo",
        "Provider",
        "Consumer",
        "token",
        "tester"
    );

    assert.strictEqual(
        request.body.events[0].name,
        "contract_requiring_verification_published"
    );

    assert.strictEqual(
        request.body.request.url,
        "https://api.github.com/repos/owner/repo/dispatches"
    );

    assert.strictEqual(
        request.body.request.body.client_payload.pact_url,
        "${pactbroker.pactUrl}"
    );
});

test("getJson: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Unauthorized", 401);

    const { getJson } = freshModule();

    await assert.rejects(
        getJson("https://broker.example.com/test"),
        /Status: 401/
    );
});

test("createWebhook: creation error -> fails", async () => {
    global.fetch = async () =>
        response("Forbidden", 403);

    const { createWebhook } = freshModule();

    await assert.rejects(
        createWebhook(
            "https://broker.example.com",
            "https://api.github.com/repos/owner/repo",
            "Provider",
            "Consumer",
            "token",
            "tester"
        ),
        /Webhook creation failed: 403/
    );
});

test("getJson: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Forbidden", 403);

    const { getJson } = freshModule();

    await assert.rejects(
        getJson("https://broker.example.com/test"),
        /Status: 403/
    );
});