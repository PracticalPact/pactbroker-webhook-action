function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

async function brokerRequest(url, token) {
    const response = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/hal+json, application/json, */*"
        }
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Broker error ${response.status}: ${text}`);
    }
    return response.json();
}

async function getGatewayDownstreamNames(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}---`));
}

async function getGatewayConsumerNames(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.endsWith(`---${gatewayName}`));
}

async function canIDeployLatest(brokerUrl, token, appName, toEnvironment, retryWhileUnknown, retryInterval) {
    let attempts = 0;
    while (true) {
        const url = `${brokerUrl}/matrix?q[][pacticipant]=${encodeURIComponent(appName)}&q[][latest]=true&latestby=cvpv&environment=${encodeURIComponent(toEnvironment)}`;
        const data = await brokerRequest(url, token);

        if (data.summary?.deployable) {
            console.log(`✅ ${appName} (latest) can be deployed to ${toEnvironment}`);
            return true;
        }

        if (data.summary?.unknown > 0 && attempts < retryWhileUnknown) {
            attempts++;
            console.log(`⏳ ${appName} unknown, retrying in ${retryInterval}s (${attempts}/${retryWhileUnknown})`);
            await new Promise(r => setTimeout(r, retryInterval * 1000));
            continue;
        }

        console.error(`❌ ${appName} (latest) cannot be deployed to ${toEnvironment}`);
        console.error(data.summary?.reason || "Unknown reason");
        return false;
    }
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const token = getInput("brokerToken");
    const gatewayName = getInput("applicationName");
    const toEnvironment = getInput("toEnvironment");
    const retryWhileUnknown = parseInt(getInput("retryWhileUnknown") || "0");
    const retryInterval = parseInt(getInput("retryInterval") || "10");

    const [downstreams, consumers] = await Promise.all([
        getGatewayDownstreamNames(brokerUrl, token, gatewayName),
        getGatewayConsumerNames(brokerUrl, token, gatewayName)
    ]);

    console.log(`Found ${downstreams.length} downstream participants: ${downstreams.join(", ") || "none"}`);
    console.log(`Found ${consumers.length} consumer participants: ${consumers.join(", ") || "none"}`);

    if (downstreams.length === 0 && consumers.length === 0) {
        console.log("No participants to check, exiting.");
        return;
    }

    // Downstreams must pass — they block deployment
    const downstreamResults = await Promise.all(
        downstreams.map(name => canIDeployLatest(brokerUrl, token, name, toEnvironment, retryWhileUnknown, retryInterval))
    );

    // Consumers are informational only — don't block deployment
    await Promise.all(
        consumers.map(async name => {
            const ok = await canIDeployLatest(brokerUrl, token, name, toEnvironment, retryWhileUnknown, retryInterval);
            if (!ok) console.log(`⚠️ Consumer ${name} cannot deploy but not blocking gateway deployment`);
        })
    );

    if (downstreamResults.some(r => !r)) process.exit(1);
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});