const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_PROVIDERNAME: "Provider",
        INPUT_OASURL: "https://provider.example.com/swagger.json",
        INPUT_OASSERVICEURL: "https://oas.example.com",
        REPOSITORY_NAME: "Consumer"
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

test("webhookExists: matching webhook exists", async () => {
    global.fetch = async url => {
        if (url.includes("/webhooks/provider/")) {
            return response({
                _links: {
                    "pb:webhooks": [
                        { href: "https://broker.example.com/webhooks/1" }
                    ]
                }
            });
        }

        return response({
            events: [{ name: "contract_content_changed" }],
            request: {
                url: "https://oas.example.com/compare-from-webhook",
                body: {
                    providerUrl:
                        "https://provider.example.com/swagger.json"
                }
            }
        });
    };

    const { webhookExists } = freshModule();

    const exists = await webhookExists(
        "https://broker.example.com",
        "Provider",
        "Consumer",
        "https://provider.example.com/swagger.json",
        "https://oas.example.com/compare-from-webhook"
    );

    assert.strictEqual(exists, true);
});

test("run: creates missing webhook", async () => {
    setEnv();
    let created;

    global.fetch = async (url, options = {}) => {
        if (!options.method || options.method === "GET") {
            return response({
                _links: {
                    "pb:webhooks": []
                }
            });
        }

        if (options.method === "POST") {
            created = {
                url,
                body: JSON.parse(options.body)
            };

            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.ok(created.url.includes("Provider"));
    assert.ok(created.url.includes("Consumer"));

    assert.strictEqual(
        created.body.events[0].name,
        "contract_content_changed"
    );

    assert.strictEqual(
        created.body.request.body.providerUrl,
        "https://provider.example.com/swagger.json"
    );

    assert.strictEqual(
        created.body.request.body.pactUrl,
        "${pactbroker.pactUrl}"
    );

    assert.strictEqual(
        created.body.request.body.publishVerificationResult,
        true
    );
});

test("run: existing webhook is not recreated", async () => {
    setEnv();
    let posts = 0;

    global.fetch = async (url, options = {}) => {
        if (
            url.includes("/webhooks/provider/") &&
            !url.endsWith("/webhooks/1")
        ) {
            return response({
                _links: {
                    "pb:webhooks": [
                        { href: "https://broker.example.com/webhooks/1" }
                    ]
                }
            });
        }

        if (url.endsWith("/webhooks/1")) {
            return response({
                events: [{ name: "contract_content_changed" }],
                request: {
                    url: "https://oas.example.com/compare-from-webhook",
                    body: {
                        providerUrl:
                            "https://provider.example.com/swagger.json"
                    }
                }
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
        "Provider",
        "Consumer",
        "https://provider.example.com/swagger.json",
        "https://oas.example.com/compare-from-webhook"
    );

    assert.strictEqual(
        request.body.request.body.providerUrl,
        "https://provider.example.com/swagger.json"
    );

    assert.strictEqual(
        request.body.request.url,
        "https://oas.example.com/compare-from-webhook"
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

test("createWebhook: creation error -> fails", async () => {
    global.fetch = async () =>
        response("Forbidden", 403);

    const { createWebhook } = freshModule();

    await assert.rejects(
        createWebhook(
            "https://broker.example.com",
            "Provider",
            "Consumer",
            "https://provider.example.com/swagger.json",
            "https://oas.example.com/compare-from-webhook"
        ),
        /Webhook creation failed: 403/
    );
});