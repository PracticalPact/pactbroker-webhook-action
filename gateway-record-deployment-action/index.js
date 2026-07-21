function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

async function brokerRequest(url, method = "GET", body = null) {
    const options = {
        method,
        headers: {
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

async function getDeployedVersions(brokerUrl, participant, environmentUuid, environment) {
    try {
        const data = await brokerRequest(
            `${brokerUrl}/pacticipants/${encodeURIComponent(participant)}/latest-version`
        );
        const deployedEnvs = data._links?.["pb:deployed-environments"] || [];
        const isDeployed = deployedEnvs.some(e =>
            e.currently_deployed && e.name?.toLowerCase() === environment.toLowerCase()
        );
        return isDeployed ? [data.number] : [];
    } catch (e) {
        console.log(`Could not fetch latest version for ${participant}: ${e.message}`);
        return [];
    }
}

async function getVersions(brokerUrl, participant) {
    const data = await brokerRequest(
        `${brokerUrl}/pacticipants/${encodeURIComponent(participant)}/versions`
       
    );

    return (data._embedded?.versions || []).map(v => v.number).filter(Boolean);
}

async function recordDeployment(brokerUrl, participantName, version, environmentUuid, environment) {
    const url =
        `${brokerUrl}/pacticipants/${encodeURIComponent(participantName)}` +
        `/versions/${encodeURIComponent(version)}` +
        `/deployed-versions/environment/${environmentUuid}`;

    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/hal+json, application/json, */*" }, body: "{}" });
    if (!response.ok) {
        throw new Error(`Failed to record deployment for ${participantName}@${version}: ${response.status} ${await response.text()}`);
    }
    console.log(`Recorded ${participantName}@${version} in ${environment}`);
}

function findCompositeVersion(versions, consumerVersion, gatewayVersion) {
    const exact = `${consumerVersion}-${gatewayVersion}`;

    return versions.find(v => v === exact) ||
        versions.find(v =>
            v.startsWith(`${consumerVersion}-`) &&
            v.endsWith(`-${gatewayVersion}`)
        );
}

async function getGatewayDownstreams(brokerUrl, gatewayName, participants) {
    return participants.filter(name => name.startsWith(`${gatewayName}---`));
}

function getGatewayConsumers(gatewayName, participants) {
    return participants.filter(name => name.endsWith(`---${gatewayName}`));
}

// For a single Consumer---GW participant: if Consumer is deployed to this
// environment, record the matching composite version as deployed here too.
// If Consumer isn't deployed here at all, this is not an error -- it's simply
// not relevant to this environment and is skipped.
async function recordConsumerGatewayPair(brokerUrl, participant, consumerName, gatewayVersion, environmentUuid, environment) {
    const consumerVersions = await getDeployedVersions(brokerUrl, consumerName, environmentUuid, environment);

    if (consumerVersions.length === 0) {
        console.log(`Skipping ${participant}: '${consumerName}' is not deployed to ${environment}`);
        return;
    }

    const uniqueVersions = [...new Set(consumerVersions)];
    if (uniqueVersions.length !== 1) {
        throw new Error(
            `Consumer '${consumerName}' has inconsistent deployed versions in ${environment}: ` +
            uniqueVersions.join(", ")
        );
    }
    const consumerVersion = uniqueVersions[0];

    const versions = await getVersions(brokerUrl, participant);
    const compositeVersion = findCompositeVersion(versions, consumerVersion, gatewayVersion);

    if (!compositeVersion) {
        throw new Error(
            `No composite version found for ${participant}, ${consumerVersion} and ${gatewayVersion}`
        );
    }

    await recordDeployment(brokerUrl, participant, compositeVersion, environmentUuid, environment);
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const gatewayName = getInput("applicationName");
    const gatewayVersion = getInput("version");
    const environment = getInput("environment");

    if (!brokerUrl) throw new Error("brokerUrl is required");
    if (!gatewayName) throw new Error("applicationName is required");
    if (!gatewayVersion) throw new Error("version is required");
    if (!environment) throw new Error("environment is required");

    const [participants, environmentUuid] = await Promise.all([
        getParticipantNames(brokerUrl),
        getEnvironmentUuid(brokerUrl, environment)
    ]);

    const downstreams = await getGatewayDownstreams(brokerUrl, gatewayName, participants);
    const consumerGateways = getGatewayConsumers(gatewayName, participants);

    console.log(`Found ${downstreams.length} downstream participant(s)`);
    console.log(`Found ${consumerGateways.length} consumer-gateway participant(s)`);

    // Record the gateway's own deployment against each downstream provider.
    await Promise.all(
        downstreams.map(name =>
            recordDeployment(brokerUrl, name, gatewayVersion, environmentUuid, environment)
        )
    );

    // Reconcile each Consumer---GW pair: only recorded as deployed here if
    // the consumer is also deployed here. Each consumer is independent --
    // one failing consumer doesn't block the others from being recorded.
    const results = await Promise.allSettled(
        consumerGateways.map(participant => {
            const consumerName = participant.slice(0, -(`---${gatewayName}`.length));
            return recordConsumerGatewayPair(
                brokerUrl, participant, consumerName, gatewayVersion, environmentUuid, environment
            );
        })
    );

    const failures = results.filter(r => r.status === "rejected");
    if (failures.length > 0) {
        throw new Error(failures.map(f => f.reason.message).join("; "));
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
    getGatewayDownstreams,
    getGatewayConsumers,
    recordConsumerGatewayPair,
    run
};