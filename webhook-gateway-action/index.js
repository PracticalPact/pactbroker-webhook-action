function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

const core = {
    getInput,
    info: console.log,
    setFailed: (message) => {
        console.error(message);
        process.exit(1);
    }
};

async function getJson(url) {
    const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/hal+json, application/json, */*" }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed: ${url}\nStatus: ${response.status}\n\n${text}`);
    }

    return response.json();
}

async function hasWebhookAlready(brokerUrl, providerName, consumerName) {
    const url =
        `${brokerUrl}/webhooks/provider/` +
        `${encodeURIComponent(providerName)}` +
        `/consumer/${encodeURIComponent(consumerName)}`;

    core.info(`Checking webhooks for consumer: ${consumerName}`);

    const webhookCollection = await getJson(url);
    const webhookLinks = webhookCollection?._links?.["pb:webhooks"] || [];

    for (const webhook of webhookLinks) {
        const href = webhook.href;
        if (!href) continue;

        core.info(`Inspecting webhook ${href}`);
        const webhookDetail = await getJson(href);
        const found = (webhookDetail.events || [])
            .some(e => e.name === "contract_requiring_verification_published");

        if (found) {
            core.info(`Valid webhook exists for ${consumerName} -> ${providerName}`);
            return true;
        }
    }

    return false;
}

async function createWebhook(brokerUrl, githubUrl, providerName, consumerName, githubToken) {
    const url =
        `${brokerUrl}/webhooks/provider/` +
        `${encodeURIComponent(providerName)}` +
        `/consumer/${encodeURIComponent(consumerName)}`;

    const payload = {
        events: [{ name: "contract_requiring_verification_published" }],
        request: {
            method: "POST",
            url: `${githubUrl}/dispatches`,
            headers: {
                "content-type": "application/json",
                "accept": "application/vnd.github+json",
                "authorization": `Bearer ${githubToken}`
            },
            body: {
                event_type: "contract_requiring_verification_published",
                client_payload: {
                    pact_url: "${pactbroker.pactUrl}",
                    sha: "${pactbroker.providerVersionNumber}",
                    branch: "${pactbroker.providerVersionBranch}"
                }
            }
        }
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/hal+json, application/json, */*"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Webhook creation failed: ${response.status}\n${text}`);
    }

    console.log(`Webhook created for ${consumerName} -> ${providerName}`);
}

async function processProvider(brokerUrl, githubUrl, providerName, githubToken) {
    core.info(`Loading pacts for provider ${providerName}`);
    const providerResponse = await getJson(`${brokerUrl}/pacts/provider/${encodeURIComponent(providerName)}`);
    const pactEntries = providerResponse?._links?.["pb:pacts"] || [];

    const uniqueConsumers = new Set();
    for (const pact of pactEntries) {
        if (pact.name) uniqueConsumers.add(pact.name);
    }

    core.info(`Found ${uniqueConsumers.size} consumers for ${providerName}`);

    for (const consumerName of uniqueConsumers) {
        const exists = await hasWebhookAlready(brokerUrl, providerName, consumerName);
        if (exists) continue;
        await createWebhook(brokerUrl, githubUrl, providerName, consumerName, githubToken);
    }
}

async function run() {
    try {
        const brokerUrl = core.getInput("brokerUrl").replace(/\/+$/, "");
        const githubRepo = process.env.GITHUB_REPOSITORY;
        const githubUrl = `https://api.github.com/repos/${githubRepo}`;
        const githubToken = core.getInput("githubToken");
        const gatewayName = core.getInput("gatewayName");

        // Discover all Gateway---X and X---Gateway participants
        const data = await getJson(`${brokerUrl}/pacticipants`);
        const providerNames = (data._embedded?.pacticipants || [])
            .map(p => p.name)
            .filter(name => name.startsWith(`${gatewayName}---`) || name.endsWith(`---${gatewayName}`));

        core.info(`Found ${providerNames.length} gateway participants: ${providerNames.join(", ") || "none"}`);

        for (const providerName of providerNames) {
            await processProvider(brokerUrl, githubUrl, providerName, githubToken);
        }

    } catch (error) {
        core.setFailed(error?.message || "Unknown error");
    }
}

run();