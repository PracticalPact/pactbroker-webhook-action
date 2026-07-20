function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

async function brokerRequest(url, token, method = "GET", body = null) {
    const options = {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/hal+json, application/json, */*",
            "Content-Type": "application/json"
        }
    };

    if (body !== null) options.body = JSON.stringify(body);

    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(`Broker error ${response.status}: ${await response.text()}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

async function getEnvironmentUuid(brokerUrl, token, environment) {
    const data = await brokerRequest(`${brokerUrl}/environments`, token);
    const env = (data._embedded?.environments || []).find(e => e.name === environment);

    if (!env) throw new Error(`Environment '${environment}' was not found`);
    return env.uuid;
}

async function getGatewayDownstreams(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);

    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}---`));
}

async function recordDeployment(
    brokerUrl,
    token,
    participantName,
    version,
    environmentUuid,
    environment
) {
    const url =
        `${brokerUrl}/pacticipants/${encodeURIComponent(participantName)}` +
        `/versions/${encodeURIComponent(version)}` +
        `/deployed-versions/environment/${environmentUuid}`;

    await brokerRequest(url, token, "POST", {});
    console.log(`Recorded ${participantName}@${version} in ${environment}`);
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const token = getInput("brokerToken");
    const gatewayName = getInput("applicationName");
    const gatewayVersion = getInput("version");
    const environment = getInput("environment");

    if (!brokerUrl) throw new Error("brokerUrl is required");
    if (!token) throw new Error("brokerToken is required");
    if (!gatewayName) throw new Error("applicationName is required");
    if (!gatewayVersion) throw new Error("version is required");
    if (!environment) throw new Error("environment is required");

    const [downstreams, environmentUuid] = await Promise.all([
        getGatewayDownstreams(brokerUrl, token, gatewayName),
        getEnvironmentUuid(brokerUrl, token, environment)
    ]);

    console.log(`Found ${downstreams.length} downstream participant(s)`);

    await Promise.all(
        downstreams.map(name =>
            recordDeployment(
                brokerUrl,
                token,
                name,
                gatewayVersion,
                environmentUuid,
                environment
            )
        )
    );
}

if (require.main === module) {
    run().catch(error => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = {
    getInput,
    brokerRequest,
    getEnvironmentUuid,
    getGatewayDownstreams,
    recordDeployment,
    run
};