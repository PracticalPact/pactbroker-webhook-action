function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

async function check(brokerUrl, token, appName, version, toEnvironment) {
    const url = `${brokerUrl}/matrix?q[][pacticipant]=${encodeURIComponent(appName)}&q[][version]=${encodeURIComponent(version)}&latestby=cvpv&environment=${encodeURIComponent(toEnvironment)}`;
    const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/hal+json, application/json, */*" }
    });
    if (!response.ok) {
        const text = await response.text();
        console.error(`Broker error ${response.status}: ${text}`);
        process.exit(1);
    }
    return response.json();
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const token = getInput("brokerToken");
    const appName = getInput("applicationName");
    const version = getInput("version");
    const toEnvironment = getInput("toEnvironment");
    const retryWhileUnknown = parseInt(getInput("retryWhileUnknown") || "0");
    const retryInterval = parseInt(getInput("retryInterval") || "10");

    let attempts = 0;
    while (true) {
        const data = await check(brokerUrl, token, appName, version, toEnvironment);

        if (data.summary?.deployable) {
            console.log(`✅ ${appName} ${version} can be deployed to ${toEnvironment}`);
            break;
        }

        if (data.summary?.unknown > 0 && attempts < retryWhileUnknown) {
            attempts++;
            console.log(`⏳ Unknown results, retrying in ${retryInterval}s (${attempts}/${retryWhileUnknown})`);
            await new Promise(r => setTimeout(r, retryInterval * 1000));
            continue;
        }

        console.error(`❌ ${appName} ${version} cannot be deployed to ${toEnvironment}`);
        console.error(data.summary?.reason || "Unknown reason");
        process.exit(1);
    }
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});