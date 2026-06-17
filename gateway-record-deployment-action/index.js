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

async function getGatewayParticipants(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}->`) || name.endsWith(`->${gatewayName}`));
}

async function getLatestVersion(brokerUrl, token, participantName) {
    const data = await brokerRequest(
        `${brokerUrl}/pacticipants/${encodeURIComponent(participantName)}/versions/latest`,
        token
    );
    return data.number;
}

async function recordDeployment(brokerUrl, token, participantName, version, environment) {
    await brokerRequest(
        `${brokerUrl}/pacticipants/${encodeURIComponent(participantName)}/versions/${encodeURIComponent(version)}/deployed-versions`,
        token,
        "POST",
        { environment }
    );
    console.log(`✅ Recorded deployment for ${participantName}@${version} to ${environment}`);
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const token = getInput("brokerToken");
    const gatewayName = getInput("applicationName");
    const environment = getInput("environment");

    const participants = await getGatewayParticipants(brokerUrl, token, gatewayName);
    console.log(`Found participants: ${participants.join(", ") || "none"}`);

    await Promise.all(participants.map(async (name) => {
        const version = await getLatestVersion(brokerUrl, token, name);
        await recordDeployment(brokerUrl, token, name, version, environment);
    }));
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});