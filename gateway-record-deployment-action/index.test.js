const test = require("node:test");
const assert = require("node:assert");

function setEnv(overrides) {
    Object.assign(process.env, {
        INPUT_BROKERURL: "https://broker.example.com",
        INPUT_BROKERTOKEN: "tok",
        INPUT_APPLICATIONNAME: "GW",
        INPUT_VERSION: "X",
        INPUT_ENVIRONMENT: "town21"
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
        text: async () => (typeof body === "string" ? body : JSON.stringify(body))
    };
}

// Broker state matching the user's table:
//   Consumer A -- deployed to town21 and town24, version "A"
//   Consumer B -- deployed to town26 only, version "B"
//   GW---Provider X -- deployed to town21
//   GW---Provider Y -- deployed to town24
//   Composite participants A---GW and B---GW both have versions "A-X" and "A-Y" registered
//   (B never has a matching composite since B is never deployed alongside X or Y)
function mockBroker({ recordedDeployments }) {
    const environments = {
        town21: "env-town21",
        town24: "env-town24",
        town26: "env-town26"
    };

    const consumerDeployedVersions = {
        // consumerName: { environmentUuid: [versions] }
        A: { "env-town21": ["A"], "env-town24": ["A"] },
        B: { "env-town26": ["B"] }
    };

    global.fetch = async (url, options = {}) => {
        if (url.endsWith("/environments")) {
            return response({
                _embedded: {
                    environments: Object.entries(environments).map(([name, uuid]) => ({ name, uuid }))
                }
            });
        }

        if (url.endsWith("/pacticipants")) {
            return response({
                _embedded: {
                    pacticipants: [
                        { name: "GW---Provider" },
                        { name: "A---GW" },
                        { name: "B---GW" }
                    ]
                }
            });
        }

        if (url.includes("currently-deployed-versions")) {
            const match = url.match(/pacticipants\/([^/]+)\/currently-deployed-versions\/environment\/([^/]+)/);
            const participant = decodeURIComponent(match[1]);
            const envUuid = match[2];
            const versions = (consumerDeployedVersions[participant] || {})[envUuid] || [];
            return response({ _embedded: { versions: versions.map(number => ({ number })) } });
        }

        if (url.includes("/versions") && options.method === "GET") {
            // getVersions: registered composite versions for A---GW / B---GW
            return response({ _embedded: { versions: [{ number: "A-X" }, { number: "A-Y" }] } });
        }

        if (options.method === "POST" && url.includes("deployed-versions")) {
            const match = url.match(/pacticipants\/([^/]+)\/versions\/([^/]+)\/deployed-versions\/environment\/([^/]+)/);
            recordedDeployments.push({
                participant: decodeURIComponent(match[1]),
                version: decodeURIComponent(match[2]),
                environmentUuid: match[3]
            });
            return response({});
        }

        throw new Error(`Unexpected call: ${options.method || "GET"} ${url}`);
    };
}

test("run: town21 deployment of GW version X -- A---X recorded, B---X skipped", async () => {
    setEnv({ INPUT_VERSION: "X", INPUT_ENVIRONMENT: "town21" });
    const recordedDeployments = [];
    mockBroker({ recordedDeployments });

    const { run } = freshModule();
    await assert.doesNotReject(run());

    const composite = recordedDeployments.filter(r => r.participant.includes("---GW"));
    assert.strictEqual(composite.length, 1);
    assert.strictEqual(composite[0].participant, "A---GW");
    assert.strictEqual(composite[0].version, "A-X");
    assert.strictEqual(composite[0].environmentUuid, "env-town21");

    // downstream recording still happens unconditionally
    assert.ok(recordedDeployments.some(r => r.participant === "GW---Provider" && r.version === "X"));
});

test("run: town24 deployment of GW version Y -- A---Y recorded, B---Y skipped", async () => {
    setEnv({ INPUT_VERSION: "Y", INPUT_ENVIRONMENT: "town24" });
    const recordedDeployments = [];
    mockBroker({ recordedDeployments });

    const { run } = freshModule();
    await assert.doesNotReject(run());

    const composite = recordedDeployments.filter(r => r.participant.includes("---GW"));
    assert.strictEqual(composite.length, 1);
    assert.strictEqual(composite[0].participant, "A---GW");
    assert.strictEqual(composite[0].version, "A-Y");
    assert.strictEqual(composite[0].environmentUuid, "env-town24");
});

test("run: gateway version with no matching downstream deployment for a deployed consumer -- fails", async () => {
    // Consumer A is deployed to town21, GW is being deployed with version "Z"
    // (never verified against A), so no A-Z composite exists.
    setEnv({ INPUT_VERSION: "Z", INPUT_ENVIRONMENT: "town21" });
    const recordedDeployments = [];
    mockBroker({ recordedDeployments });

    const { run } = freshModule();
    await assert.rejects(run(), /No composite version found for A---GW/);
});

test("run: no downstreams or consumer-gateways -> exits cleanly", async () => {
    setEnv();
    global.fetch = async url => {
        if (url.endsWith("/environments")) {
            return response({ _embedded: { environments: [{ name: "town21", uuid: "env-town21" }] } });
        }
        return response({ _embedded: { pacticipants: [] } });
    };

    const { run } = freshModule();
    await assert.doesNotReject(run());
});

test("recordConsumerGatewayPair: consumer not deployed to this environment -> skipped, no throw", async () => {
    global.fetch = async url => {
        if (url.includes("currently-deployed-versions")) {
            return response({ _embedded: { versions: [] } });
        }
        throw new Error(`Unexpected call: ${url}`);
    };

    const { recordConsumerGatewayPair } = freshModule();
    await assert.doesNotReject(
        recordConsumerGatewayPair(
            "https://broker.example.com", "tok", "B---GW", "B", "X", "env-town21", "town21"
        )
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