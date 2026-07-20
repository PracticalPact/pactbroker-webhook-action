const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_CONSUMERVERSION: "abc123",
        INPUT_BRANCH: "main"
    }, overrides);
}

function freshModule() {
    delete require.cache[require.resolve("./index.js")];
    return require("./index.js");
}

function response(body = "", status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () =>
            typeof body === "string" ? body : JSON.stringify(body)
    };
}

function createPactFiles(files) {
    const pactDir = path.resolve("./pacts");

    fs.rmSync(pactDir, { recursive: true, force: true });
    fs.mkdirSync(pactDir);

    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(
            path.join(pactDir, name),
            JSON.stringify(content)
        );
    }

    return pactDir;
}

test.afterEach(() => {
    fs.rmSync(path.resolve("./pacts"), {
        recursive: true,
        force: true
    });
});

test("getPactFiles: finds Pact JSON files", () => {
    createPactFiles({
        "contract.json": {
            consumer: { name: "Consumer" },
            provider: { name: "Provider" }
        }
    });

    const { getPactFiles } = freshModule();
    const files = getPactFiles();

    assert.strictEqual(files.length, 1);
    assert.ok(files[0].endsWith("contract.json"));
});

test("getPactFiles: missing directory -> fails", () => {
    const { getPactFiles } = freshModule();

    assert.throws(
        getPactFiles,
        /Pact directory not found/
    );
});

test("publishPact: publishes contract", async () => {
    const pactDir = createPactFiles({
        "contract.json": {
            consumer: { name: "Consumer" },
            provider: { name: "Provider" },
            interactions: []
        }
    });

    let request;

    global.fetch = async (url, options) => {
        request = { url, options };
        return response();
    };

    const { publishPact } = freshModule();

    const consumer = await publishPact(
        "https://broker.example.com",
        path.join(pactDir, "contract.json"),
        "abc123"
    );

    assert.strictEqual(consumer, "Consumer");
    assert.ok(request.url.includes("/provider/Provider/consumer/Consumer/"));
    assert.ok(request.url.endsWith("/version/abc123"));
    assert.strictEqual(request.options.method, "PUT");
});

test("run: publishes contracts and registers branches once per consumer", async () => {
    setEnv();

    createPactFiles({
        "provider-a.json": {
            consumer: { name: "Consumer" },
            provider: { name: "ProviderA" }
        },
        "provider-b.json": {
            consumer: { name: "Consumer" },
            provider: { name: "ProviderB" }
        }
    });

    const requests = [];

    global.fetch = async (url, options) => {
        requests.push({ url, options });
        return response();
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    const publications = requests.filter(r =>
        r.url.includes("/pacts/provider/")
    );

    const branches = requests.filter(r =>
        r.url.includes("/branches/")
    );

    assert.strictEqual(publications.length, 2);
    assert.strictEqual(branches.length, 1);
    assert.ok(branches[0].url.includes("/branches/main/"));
});

test("publishPact: missing consumer or provider -> fails", async () => {
    const pactDir = createPactFiles({
        "invalid.json": {
            interactions: []
        }
    });

    const { publishPact } = freshModule();

    await assert.rejects(
        publishPact(
            "https://broker.example.com",
            path.join(pactDir, "invalid.json"),
            "abc123"
        ),
        /Missing consumer or provider name/
    );
});

test("publishPact: Broker error -> fails", async () => {
    const pactDir = createPactFiles({
        "contract.json": {
            consumer: { name: "Consumer" },
            provider: { name: "Provider" }
        }
    });

    global.fetch = async () =>
        response("Forbidden", 403);

    const { publishPact } = freshModule();

    await assert.rejects(
        publishPact(
            "https://broker.example.com",
            path.join(pactDir, "contract.json"),
            "abc123"
        ),
        /Failed to publish contract.json: 403/
    );
});

test("registerBranch: Broker error -> fails", async () => {
    global.fetch = async () =>
        response("Forbidden", 403);

    const { registerBranch } = freshModule();

    await assert.rejects(
        registerBranch(
            "https://broker.example.com",
            "Consumer",
            "abc123",
            "main"
        ),
        /Failed to register branch for Consumer: 403/
    );
});