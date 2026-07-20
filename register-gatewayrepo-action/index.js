function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

async function getParticipants(brokerUrl, gatewayName) {
    const response = await fetch(`${brokerUrl}/pacticipants`, {
        headers: {
            Accept: "application/hal+json, application/json, */*"
        }
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get participants: ${response.status}\n` +
            `${await response.text()}`
        );
    }

    const data = await response.json();

    return (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name =>
            name.startsWith(`${gatewayName}---`) ||
            name.endsWith(`---${gatewayName}`)
        );
}

async function registerParticipant(brokerUrl, name, repoUrl) {
    const response = await fetch(
        `${brokerUrl}/pacticipants/${encodeURIComponent(name)}`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/merge-patch+json"
            },
            body: JSON.stringify({
                repositoryUrl: repoUrl,
                mainBranch: "main"
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `Failed to register ${name}: ${response.status}\n` +
            `${await response.text()}`
        );
    }

    console.log(`Registered ${name} -> ${repoUrl}`);
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const gatewayName = getInput("gatewayName");
    const repository = process.env.GITHUB_REPOSITORY;

    if (!brokerUrl) throw new Error("brokerUrl is required");
    if (!gatewayName) throw new Error("gatewayName is required");
    if (!repository) throw new Error("GITHUB_REPOSITORY is required");

    const repoUrl = `https://github.com/${repository}`;
    const participants = await getParticipants(brokerUrl, gatewayName);

    console.log(
        `Found ${participants.length} participants: ` +
        `${participants.join(", ") || "none"}`
    );

    await Promise.all(
        participants.map(name =>
            registerParticipant(brokerUrl, name, repoUrl)
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
    getParticipants,
    registerParticipant,
    run
};