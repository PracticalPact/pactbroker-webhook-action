async function getEnvironmentUuid(brokerUrl, environment) {
    const response = await fetch(`${brokerUrl}/environments`, {
        headers: { "Accept": "application/hal+json, application/json, */*" }
    });
    const data = await response.json();
    const env = (data._embedded?.environments || [])
   .find(e => e.name === environment);
    if (!env) throw new Error(`Environment ${environment} not found`);
    return env.uuid;
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const appName = getInput("applicationName");
    const version = getInput("version");
    const environment = getInput("environment");

    const uuid = await getEnvironmentUuid(brokerUrl, environment);

    const url = `${brokerUrl}/pacticipants/${encodeURIComponent(appName)}/versions/${encodeURIComponent(version)}/deployed-versions/environment/${uuid}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to record deployment: ${response.status}\n${text}`);
    }

    console.log(`✅ Recorded ${appName}@${version} to ${environment}`);
} 