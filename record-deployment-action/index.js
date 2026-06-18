function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const appName = getInput("applicationName");
    const version = getInput("version");
    const environment = getInput("environment");

    const url = `${brokerUrl}/pacticipants/${encodeURIComponent(appName)}/versions/${encodeURIComponent(version)}/deployed-versions`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to record deployment: ${response.status}\n${text}`);
    }

    console.log(`✅ Recorded ${appName}@${version} to ${environment}`);
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});