async function brokerRequest(url, method = "GET", body = null) {
    const options = {
        method,
        headers: {
            "Accept": "application/hal+json, application/json, */*",
            "Content-Type": "application/merge-patch+json"
        }
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Broker error ${response.status}: ${text}`);
    }
    return response;
}

async function run() {
    const brokerUrl = process.env.BROKER_URL.replace(/\/+$/, "");
    const gatewayName = process.env.REPOSITORY_NAME;
    const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;

    const response = await brokerRequest(`${brokerUrl}/pacticipants`);
    const data = await response.json();

    const participants = (data._embedded?.pacticipants || [])
        .map(p => p.name)
        .filter(name => name.startsWith(`${gatewayName}---`) || name.endsWith(`---${gatewayName}`));

    console.log(`Found ${participants.length} participants to register: ${participants.join(", ") || "none"}`);

    for (const name of participants) {
        await brokerRequest(
            `${brokerUrl}/pacticipants/${encodeURIComponent(name)}`,
            "PATCH",
            { repositoryUrl: repoUrl, mainBranch: "main" }
        );
        console.log(`Registered ${name} -> ${repoUrl}`);
    }
}

run().catch(e => {
    console.error(e.message);
    process.exit(1);
});