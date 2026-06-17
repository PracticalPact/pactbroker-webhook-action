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

// Find all Gateway->X provider names from the broker
async function getGatewayProviderNames(brokerUrl, token, gatewayName) {
    const data = await brokerRequest(`${brokerUrl}/pacticipants`, token);
    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}->`));
}

// Get the verified GW provider SHA from pair 1: consumerName vs gatewayProviderName
async function getVerifiedGwSha(brokerUrl, token, consumerName, consumerVersion, gatewayProviderName) {
    const url = `${brokerUrl}/matrix` +
        `?q[][pacticipant]=${encodeURIComponent(consumerName)}` +
        `&q[][version]=${encodeURIComponent(consumerVersion)}` +
        `&q[][pacticipant]=${encodeURIComponent(gatewayProviderName)}` +
        `&q[][latest]=true&latestby=cvpv`;
    const data = await brokerRequest(url, token);

    const row = data.matrix?.find(r =>
        r.consumer?.name === consumerName &&
        r.consumer?.version?.number === consumerVersion &&
        r.provider?.name === gatewayProviderName
    );

    if (!row) throw new Error(`No verified row found for ${consumerName}@${consumerVersion} vs ${gatewayProviderName}`);
    return row.provider.version.number;
}

// Fetch latest pact content for consumerGwName vs downstreamProvider
async function fetchLatestPact(brokerUrl, token, consumerGwName, downstreamProvider) {
    return brokerRequest(
        `${brokerUrl}/pacts/provider/${encodeURIComponent(downstreamProvider)}/consumer/${encodeURIComponent(consumerGwName)}/latest`,
        token
    );
}

// Publish pact under composite version
async function publishPact(brokerUrl, token, consumerGwName, compositeVersion, pactContent) {
    await brokerRequest(`${brokerUrl}/publish`, token, "POST", {
        pacticipantName: consumerGwName,
        pacticipantVersionNumber: compositeVersion,
        branch: "local",
        contracts: [{
            consumerName: pactContent.consumer.name,
            providerName: pactContent.provider.name,
            specification: "pact",
            contentType: "application/json",
            content: Buffer.from(JSON.stringify(pactContent)).toString("base64")
        }]
    });
    console.log(`Published ${consumerGwName}@${compositeVersion}`);
}

// can-i-deploy with retry
async function canIDeploy(brokerUrl, token, appName, version, toEnvironment, retryWhileUnknown, retryInterval) {
    let attempts = 0;
    while (true) {
        const url = `${brokerUrl}/matrix` +
            `?q[][pacticipant]=${encodeURIComponent(appName)}` +
            `&q[][version]=${encodeURIComponent(version)}` +
            `&latestby=cvpv&environment=${encodeURIComponent(toEnvironment)}`;
        const data = await brokerRequest(url, token);

        if (data.summary?.deployable) {
            console.log(`✅ ${appName}@${version} can be deployed to ${toEnvironment}`);
            return true;
        }

        if (data.summary?.unknown > 0 && attempts < retryWhileUnknown) {
            attempts++;
            console.log(`⏳ Unknown, retrying in ${retryInterval}s (${attempts}/${retryWhileUnknown})`);
            await new Promise(r => setTimeout(r, retryInterval * 1000));
            continue;
        }

        console.error(`❌ ${appName}@${version} cannot be deployed to ${toEnvironment}`);
        console.error(data.summary?.reason || "Unknown reason");
        return false;
    }
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const token = getInput("brokerToken");
    const consumerName = getInput("consumerName");
    const consumerVersion = getInput("consumerVersion");
    const gatewayName = getInput("gatewayName");
    const toEnvironment = getInput("toEnvironment");
    const retryWhileUnknown = parseInt(getInput("retryWhileUnknown") || "0");
    const retryInterval = parseInt(getInput("retryInterval") || "10");

    const consumerGwName = `${consumerName}->${gatewayName}`;

    // Find all Gateway->X providers (e.g. Gateway->Favorite, Gateway->Payments, ...)
    const gatewayProviders = await getGatewayProviderNames(brokerUrl, token, gatewayName);
    console.log(`Found ${gatewayProviders.length} gateway providers: ${gatewayProviders.join(", ")}`);

    const results = await Promise.all(gatewayProviders.map(async (gatewayProviderName) => {
        // Extract downstream name: "Gateway->Favorite" -> "Favorite"
        const downstreamProvider = gatewayProviderName.split("->").slice(1).join("->");

        // Get verified GW sha from pair 1
        console.log(`Getting verified GW sha for ${consumerName}@${consumerVersion} vs ${gatewayProviderName}`);
        const gwSha = await getVerifiedGwSha(brokerUrl, token, consumerName, consumerVersion, gatewayProviderName);
        const compositeVersion = `${consumerVersion}-${gwSha}`;
        console.log(`Composite version for ${downstreamProvider}: ${compositeVersion}`);

        // Fetch and republish pact for Consumer->Gateway vs downstream at composite version
        const pactContent = await fetchLatestPact(brokerUrl, token, consumerGwName, downstreamProvider);
        await publishPact(brokerUrl, token, consumerGwName, compositeVersion, pactContent);

        // can-i-deploy
        return canIDeploy(brokerUrl, token, consumerGwName, compositeVersion, toEnvironment, retryWhileUnknown, retryInterval);
    }));

    if (results.some(r => !r)) process.exit(1);
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});