function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

async function getEnvironmentUuid(brokerUrl, environment) {
    const response = await fetch(`${brokerUrl}/environments`, {
        headers: {
            Accept: "application/hal+json, application/json, */*"
        }
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get environments: ${response.status}\n` +
            `${await response.text()}`
        );
    }

    const data = await response.json();
    const env = (data._embedded?.environments || [])
        .find(e => e.name === environment);

    if (!env) {
        throw new Error(`Environment ${environment} not found`);
    }

    return env.uuid;
}

async function recordDeployment(
    brokerUrl,
    appName,
    version,
    environmentUuid,
    environment
) {
    const url =
        `${brokerUrl}/pacticipants/${encodeURIComponent(appName)}` +
        `/versions/${encodeURIComponent(version)}` +
        `/deployed-versions/environment/${environmentUuid}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(
            `Failed to record deployment: ${response.status}\n${text}`
        );
    }

    console.log(`Recorded ${appName}@${version} to ${environment}`);
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const appName = getInput("applicationName");
    const version = getInput("version");
    const environment = getInput("environment");

    if (!brokerUrl) throw new Error("brokerUrl is required");
    if (!appName) throw new Error("applicationName is required");
    if (!version) throw new Error("version is required");
    if (!environment) throw new Error("environment is required");

    const uuid = await getEnvironmentUuid(
        brokerUrl,
        environment
    );

    await recordDeployment(
        brokerUrl,
        appName,
        version,
        uuid,
        environment
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
    getEnvironmentUuid,
    recordDeployment,
    run
};