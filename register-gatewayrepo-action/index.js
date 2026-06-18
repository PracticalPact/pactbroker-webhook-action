function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

async function run() {
    const brokerUrl = getInput("brokerUrl").replace(/\/+$/, "");
    const gatewayName = getInput("gatewayName");
    const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;

    const response = await fetch(`${brokerUrl}/pacticipants`, {
        headers: { "Accept": "application/hal+json, application/json, */*" }
    });
    const data = await response.json();

    const participants = (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}---`) || name.endsWith(`---${gatewayName}`));

    console.log(`Found ${participants.length} participants: ${participants.join(", ") || "none"}`);

    for (const name of participants) {
        const res = await fetch(`${brokerUrl}/pacticipants/${encodeURIComponent(name)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/merge-patch+json" },
            body: JSON.stringify({ repositoryUrl: repoUrl, mainBranch: "main" })
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to register ${name}: ${res.status}\n${text}`);
        }
        console.log(`Registered ${name} -> ${repoUrl}`);
    }
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});