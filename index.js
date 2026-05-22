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
        headers: {
            Accept: "application/hal+json, application/json, */*"
        }
    });

    if (!response.ok) {
        const text = await response.text();

        throw new Error(`Request failed: ${url}\nStatus: ${response.status}\n\n${text}`);
    }

    return response.json();
}

async function hasWebhookAlready(brokerUrl, providerName, consumerName) {
    const webhookCollectionUrl =
        `${brokerUrl}/webhooks/provider/` +
        `${encodeURIComponent(providerName)}` +
        `/consumer/${encodeURIComponent(consumerName)}`;

    core.info(`Checking webhooks for consumer: ${consumerName}`);

    const webhookCollection = await getJson(webhookCollectionUrl);

    const webhookLinks = webhookCollection?._links?.["pb:webhooks"] || [];

    for (const webhook of webhookLinks) {
        const href = webhook.href;

        if (!href) {
            continue;
        }

        core.info(`Inspecting webhook ${href}`);

        const webhookDetail = await getJson(href);

        const events = webhookDetail.events || [];

        const found = events.some(e => e.name === "contract_requiring_verification_published");

        if (found) {
            core.info(`Valid webhook exists for ${consumerName}`);

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
        events: [
            {
                name: "contract_requiring_verification_published"
            }
        ],

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
                    branch: "${pactbroker.providerVersionBranch}",
                    consumer_name: "${pactbroker.consumerName}",
                    consumer_version_number: "${pactbroker.consumerVersionNumber}",
                    consumer_version_branch: "${pactbroker.consumerVersionBranch}",
                    provider_version_descriptions: "${pactbroker.providerVersionDescriptions}",
                    message: "Verify changed pact for ${pactbroker.consumerName} version ${pactbroker.consumerVersionNumber} branch ${pactbroker.consumerVersionBranch} by ${pactbroker.providerVersionNumber} (${pactbroker.providerVersionDescriptions})"
                }
            }
        }
    };

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Content-Type":
                "application/json",

            Accept:
                "application/hal+json, application/json, */*"
        },

        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text =
            await response.text();

        throw new Error(
            `Webhook creation failed: ` +
            `${response.status}\n${text}`
        );
    }

    console.log(
        `Webhook created for ${consumerName}`
    );
    
}

async function run() {
    try {
        const brokerUrl = core.getInput("brokerUrl");

        const githubRepo = process.env.GITHUB_REPOSITORY;
        const githubUrl = `https://api.github.com/repos/${githubRepo}`;

        const githubToken = core.getInput("githubToken");

        const providerName = core.getInput("providerName");

        const providerUrl = `${brokerUrl}/pacts/provider/${encodeURIComponent(providerName)}`;

        core.info(`Loading pacts for provider ${providerName}`);

        const providerResponse = await getJson(providerUrl);

        const pactEntries = providerResponse?._links?.["pb:pacts"] || [];

        const uniqueConsumers = new Set();

        for (const pact of pactEntries) {
            if (pact.name) {
                uniqueConsumers.add(pact.name);
            }
        }

        core.info(`Found ${uniqueConsumers.size} consumers`);

        for (const consumerName of uniqueConsumers) {

            const exists = await hasWebhookAlready(brokerUrl, providerName, consumerName);

            if (exists) {
                continue;
            }

            await createWebhook(brokerUrl, githubUrl, providerName, consumerName, githubToken);
        }

    } catch (error) {
        core.setFailed(error?.message || "Unknown error");
    }
}

run();