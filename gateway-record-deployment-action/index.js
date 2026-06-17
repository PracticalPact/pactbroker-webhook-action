function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

async function brokerRequest(url, token, method = "GET", body = null) {
    const options = {
        method,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/hal+json, application/json, */*",
            "Content-Type": "application/json"
        }
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Broker error ${response.status}: ${text}`);
    }
    return response.json();
}

async function getGatewayDownstreams(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}->`));
}

async function getGatewayConsumers(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.endsWith(`->${gatewayName}`));
}

// Find the composite version ending in -{gwSha} for a consumer participant
async function findCompositeVersion(brokerUrl, token, participantName, gwSha) {
    const data = await brokerRequest(
        `${brokerUrl}/pacticipants/${encodeURIComponent(participantName)}/versions`,
        token
    );
    const versions = data._embedded?.versions || [];
    const match = versions.find(v => v.number?.endsWith(`-${gwSha}`));
    if (!match) throw new Error(`No composite version found for ${participantName} ending in -${gwSha}`);
    return match.number;
}

async function recordDeployment(brokerUrl, token, participantName, version, environment) {
    await brokerRequest(
        `${brokerUrl}/pacticipants/${encodeURIComponent(participantName)}/versions/${encodeURIComponent(version)}/deployed-versions`,
        token,
        "POST",
        { environment }
    );
    console.log(`✅ Recorded ${participantName}@${version} to ${environment}`);
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const token = getInput("brokerToken");
    const gatewayName = getInput("applicationName");
    const gwSha = getInput("version");
    const environment = getInput("environment");

    const [downstreams, consumers] = await Promise.all([
        getGatewayDownstreams(brokerUrl, token, gatewayName),
        getGatewayConsumers(brokerUrl, token, gatewayName)
    ]);

    console.log(`Downstreams: ${downstreams.join(", ") || "none"}`);
    console.log(`Consumers: ${consumers.join(", ") || "none"}`);

    await Promise.all([
        // Gateway->X: record at gwSha directly
        ...downstreams.map(name => recordDeployment(brokerUrl, token, name, gwSha, environment)),

        // X->Gateway: find composite version ending in -{gwSha}
        ...consumers.map(async name => {
            const version = await findCompositeVersion(brokerUrl, token, name, gwSha);
            return recordDeployment(brokerUrl, token, name, version, environment);
        })
    ]);
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});