function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

async function brokerRequest(url, method = "GET", body = null) {
    const response = await fetch(url, {
        method,
        headers: {
            Accept: "application/hal+json, application/json, */*",
            "Content-Type": "application/json"
        },
        body: body !== null ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        throw new Error(`Broker error ${response.status}: ${await response.text()}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

async function getEnvironmentUuid(brokerUrl, environment) {
    const data = await brokerRequest(`${brokerUrl}/environments`);
    const env = (data._embedded?.environments || []).find(e => e.name === environment);

    if (!env) throw new Error(`Environment '${environment}' was not found`);
    return env.uuid;
}

async function getParticipantNames(brokerUrl) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`);
    return (data._embedded?.pacticipants || []).map(p => p.name).filter(Boolean);
}

async function getDeployedVersions(brokerUrl, participant, environmentUuid) {
    const url =
        `${brokerUrl}/pacticipants/${encodeURIComponent(participant)}` +
        `/currently-deployed-versions/environment/${environmentUuid}`;

    const data = await brokerRequest(url);

    return [
        ...(data._embedded?.versions || []).map(v => v.number),
        ...(data._links?.["pb:versions"] || []).map(v => v.name || v.title || v.number)
    ].filter(Boolean);
}

async function getVersions(brokerUrl, participant) {
    const data = await brokerRequest(
        `${brokerUrl}/pacticipants/${encodeURIComponent(participant)}/versions`
       
    );

    return (data._embedded?.versions || []).map(v => v.number).filter(Boolean);
}

async function recordDeployment(brokerUrl, participant, version, environmentUuid, environment) {
    const url =
        `${brokerUrl}/pacticipants/${encodeURIComponent(participant)}` +
        `/versions/${encodeURIComponent(version)}` +
        `/deployed-versions/environment/${environmentUuid}`;

    await brokerRequest(url, "POST", {});
    console.log(`Recorded ${participant}@${version} in ${environment}`);
}

function findCompositeVersion(versions, consumerVersion, gatewayVersion) {
    const exact = `${consumerVersion}-${gatewayVersion}`;

    return versions.find(v => v === exact) ||
        versions.find(v =>
            v.startsWith(`${consumerVersion}-`) &&
            v.endsWith(`-${gatewayVersion}`)
        );
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const consumerName = getInput("applicationName");
    const consumerVersion = getInput("version");
    const environment = getInput("environment");

    if (!brokerUrl) throw new Error("brokerUrl is required");
    if (!consumerName) throw new Error("applicationName is required");
    if (!consumerVersion) throw new Error("version is required");
    if (!environment) throw new Error("environment is required");

    const [environmentUuid, participants] = await Promise.all([
        getEnvironmentUuid(brokerUrl, environment),
        getParticipantNames(brokerUrl)
    ]);

    const consumerGateways = participants.filter(name =>
        name.startsWith(`${consumerName}---`)
    );

    if (consumerGateways.length === 0) {
        throw new Error(
            `No Consumer-Gateway participants found for '${consumerName}'. ` +
            `Use the standard record-deployment action instead.`
        );
    }

    for (const participant of consumerGateways) {
        const gatewayName = participant.substring(`${consumerName}---`.length);
        const gatewayProviders = participants.filter(name =>
            name.startsWith(`${gatewayName}---`)
        );

        if (gatewayProviders.length === 0) {
            throw new Error(`No Gateway-Provider participants found for '${gatewayName}'`);
        }

        const results = await Promise.all(
            gatewayProviders.map(async name => ({
                name,
                versions: await getDeployedVersions(
                    brokerUrl,
                    token,
                    name,
                    environmentUuid
                )
            }))
        );

        const missing = results.filter(r => r.versions.length === 0);

        if (missing.length > 0) {
            throw new Error(
                `Gateway '${gatewayName}' is not deployed for: ` +
                missing.map(r => r.name).join(", ")
            );
        }

        const gatewayVersions = [...new Set(results.flatMap(r => r.versions))];

        if (gatewayVersions.length !== 1) {
            throw new Error(
                `Gateway '${gatewayName}' has inconsistent deployed versions: ` +
                gatewayVersions.join(", ")
            );
        }

        const versions = await getVersions(brokerUrl, token, participant);
        const compositeVersion = findCompositeVersion(
            versions,
            consumerVersion,
            gatewayVersions[0]
        );

        if (!compositeVersion) {
            throw new Error(
                `No composite version found for ${participant}, ` +
                `${consumerVersion} and ${gatewayVersions[0]}`
            );
        }

        await recordDeployment(
            brokerUrl,
            token,
            participant,
            compositeVersion,
            environmentUuid,
            environment
        );
    }
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
    getParticipantNames,
    getDeployedVersions,
    getVersions,
    recordDeployment,
    findCompositeVersion,
    run
};