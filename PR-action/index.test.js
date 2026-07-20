const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_GITHUBTOKEN: "tok",
        INPUT_PACTURL: "https://broker.example.com/pacts/provider/Provider/consumer/Consumer/latest",
        INPUT_CONSUMERNAME: "Consumer",
        INPUT_CONSUMERVERSIONBRANCH: "feature/test",
        INPUT_CONSUMERVERSIONNUMBER: "abc123",
        INPUT_PROVIDERNAME: "Provider",
        INPUT_BASEBRANCH: "main",
        INPUT_GITHUBACTOR: "tester",
        GITHUB_REPOSITORY: "owner/repo"
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
            typeof body === "string" ? body : JSON.stringify(body)
    };
}

test("extractConsumerNameFromPactUrl: extracts consumer", () => {
    const { extractConsumerNameFromPactUrl } = freshModule();

    assert.strictEqual(
        extractConsumerNameFromPactUrl(
            "https://broker/pacts/provider/Provider/consumer/My%20Consumer/latest"
        ),
        "My Consumer"
    );
});

test("ensureBranch: existing branch is not created", async () => {
    let calls = 0;

    global.fetch = async () => {
        calls++;
        return response({
            object: { sha: "sha123" }
        });
    };

    const { ensureBranch } = freshModule();

    await assert.doesNotReject(
        ensureBranch("owner", "repo", "main", "fallback", "tok")
    );

    assert.strictEqual(calls, 1);
});

test("ensureBranch: creates missing branch from fallback", async () => {
    const requests = [];

    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });

        if (url.endsWith("/heads/base")) {
            return response("Not found", 404);
        }

        if (url.endsWith("/heads/main")) {
            return response({
                object: { sha: "sha123" }
            });
        }

        if (url.endsWith("/git/refs")) {
            return response({});
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const { ensureBranch } = freshModule();

    await ensureBranch(
        "owner",
        "repo",
        "base",
        "main",
        "tok"
    );

    assert.strictEqual(requests.length, 3);
    assert.strictEqual(requests[2].options.method, "POST");

    const body = JSON.parse(requests[2].options.body);

    assert.strictEqual(body.ref, "refs/heads/base");
    assert.strictEqual(body.sha, "sha123");
});

test("createOrUpdateFile: creates new file", async () => {
    const requests = [];

    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });

        if (options.method === "GET") {
            return response("Not found", 404);
        }

        return response({});
    };

    const { createOrUpdateFile } = freshModule();

    await createOrUpdateFile(
        "owner",
        "repo",
        "pact.json",
        "branch",
        '{"test":true}',
        "Add pact",
        "tok"
    );

    const request = requests.find(r => r.options.method === "PUT");
    const body = JSON.parse(request.options.body);

    assert.strictEqual(body.branch, "branch");
    assert.strictEqual(body.message, "Add pact");
    assert.strictEqual(
        Buffer.from(body.content, "base64").toString(),
        '{"test":true}'
    );
    assert.strictEqual(body.sha, undefined);
});

test("run: creates branch, file and pull request", async () => {
    setEnv();

    const requests = [];

    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });

        if (url === process.env.INPUT_PACTURL) {
            return response('{"consumer":{"name":"Consumer"}}');
        }

        if (url.includes("/git/refs/heads/main")) {
            return response({
                object: { sha: "base-sha" }
            });
        }

        if (
            url.includes("/contents/") &&
            options.method === "GET"
        ) {
            return response("Not found", 404);
        }

        if (url.endsWith("/pulls")) {
            return response({
                html_url: "https://github.com/owner/repo/pull/1"
            });
        }

        return response({});
    };

    const { run } = freshModule();

    await assert.doesNotReject(run());

    assert.ok(requests.some(r =>
        r.url.endsWith("/git/refs") &&
        r.options.method === "POST"
    ));

    assert.ok(requests.some(r =>
        r.url.includes("/contents/pact-failures/") &&
        r.options.method === "PUT"
    ));

    assert.ok(requests.some(r =>
        r.url.endsWith("/pulls") &&
        r.options.method === "POST"
    ));
});

test("run: missing GitHub token -> fails", async () => {
    setEnv({
        INPUT_GITHUBTOKEN: ""
    });

    const { run } = freshModule();

    await assert.rejects(
        run(),
        /Missing required input: githubToken/
    );
});

test("fetchPact: failed request -> fails", async () => {
    global.fetch = async () =>
        response("Not found", 404);

    const { fetchPact } = freshModule();

    await assert.rejects(
        fetchPact("https://broker.example.com/pact"),
        /Failed to fetch pact: 404/
    );
});

test("githubRequest: GitHub error -> fails", async () => {
    global.fetch = async () =>
        response("Unauthorized", 401);

    const { githubRequest } = freshModule();

    await assert.rejects(
        githubRequest("/repos/owner/repo", "GET", null, "bad-token"),
        /GitHub API error 401/
    );
});