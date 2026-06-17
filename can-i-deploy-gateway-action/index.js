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

async function getGatewayParticipants(brokerUrl, token, consumerName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    const all = data._embedded?.pacticipants || [];
    return all
        .map(p => p.name)
        .filter(name => name.startsWith(`${consumerName}->`));
}

async function canIDeploy(brokerUrl, token, appName, version, toEnvironment, retryWhileUnknown, retryInterval) {
    let attempts = 0;
    while (true) {
        const url = `${brokerUrl}/matrix?q[][pacticipant]=${encodeURIComponent(appName)}&q[][version]=${encodeURIComponent(version)}&latestby=cvpv&environment=${encodeURIComponent(toEnvironment)}`;
        const data = await brokerRequest(url, token);

        if (data.summary?.deployable) {
            console.log(`✅ ${appName} ${version} can be deployed to ${toEnvironment}`);
            return true;
        }

        if (data.summary?.unknown > 0 && attempts < retryWhileUnknown) {
            attempts++;
            console.log(`⏳ ${appName} unknown results, retrying in ${retryInterval}s (${attempts}/${retryWhileUnknown})`);
            await new Promise(r => setTimeout(r, retryInterval * 1000));
            continue;
        }

        console.error(`❌ ${appName} ${version} cannot be deployed to ${toEnvironment}`);
        console.error(data.summary?.reason || "Unknown reason");
        return false;
    }
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
            console.log(`⏳ ${appName} unknown results, retrying in ${retryInterval}s (${attempts}/${retryWhileUnknown})`);
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
    const appName = getInput("applicationName");
    const version = getInput("version");
    const toEnvironment = getInput("toEnvironment");
    const retryWhileUnknown = parseInt(getInput("retryWhileUnknown") || "0");
    const retryInterval = parseInt(getInput("retryInterval") || "10");

    const gatewayParticipants = await getGatewayParticipants(brokerUrl, token, appName);
    console.log(`Found ${gatewayParticipants.length} gateway participants: ${gatewayParticipants.join(", ") || "none"}`);

    const results = await Promise.all([
        canIDeploy(brokerUrl, token, appName, version, toEnvironment, retryWhileUnknown, retryInterval),
        ...gatewayParticipants.map(name =>
            canIDeployLatest(brokerUrl, token, name, toEnvironment, retryWhileUnknown, retryInterval)
        )
    ]);

    if (results.some(r => !r)) {
        process.exit(1);
    }
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});