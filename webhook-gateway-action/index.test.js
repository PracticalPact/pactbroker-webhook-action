const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_GITHUBTOKEN: "token",
        INPUT_GATEWAYNAME: "Gateway",
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

test("run: processes all gateway participants", async () => {
    setEnv();
    const providerRequests = [];

    global.fetch = async (url, options = {}) => {
        if (url.endsWith("/pacticipants")) {
            return response({
                _embedded: {
                    pacticipants: [
                        { name: "Gateway---Provider" },
                        { name: "Consumer---Gateway" },
                        { name: "Unrelated" }
                    ]
                }
            });
        }

        if (url.includes("/pacts/provider/")) {
            providerRequests.push(url);
            return response({
                _links: {
                    "pb:pacts": []
                }
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.strictEqual(providerRequests.length, 2);
    assert.ok(providerRequests.some(url =>
        url.includes("Gateway---Provider")
    ));
    assert.ok(providerRequests.some(url =>
        url.includes("Consumer---Gateway")
    ));
});

test("processProvider: creates missing webhook", async () => {
    let created;

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

    const { processProvider } = freshModule();

    await processProvider(
        "https://broker.example.com",
        "https://api.github.com/repos/owner/repo",
        "Gateway---Provider",
        "token",
        "tester"
    );

    assert.ok(created.url.includes("Gateway---Provider"));
    assert.ok(created.url.includes("Consumer"));
    assert.strictEqual(
        created.body.events[0].name,
        "contract_requiring_verification_published"
    );
});

test("processProvider: existing webhook is not recreated", async () => {
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
            !url.endsWith("/webhooks/1")
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

    const { processProvider } = freshModule();

    await processProvider(
        "https://broker.example.com",
        "https://api.github.com/repos/owner/repo",
        "Gateway---Provider",
        "token",
        "tester"
    );

    assert.strictEqual(posts, 0);
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
            "https://api.github.com/repos/owner/repo",
            "Gateway---Provider",
            "Consumer",
            "token",
            "tester"
        ),
        /Webhook creation failed: 403/
    );
});