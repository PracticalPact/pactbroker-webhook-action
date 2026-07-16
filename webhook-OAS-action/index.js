function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

const core = {
    getInput,
    info: console.log,
    setFailed: message => {
        console.error(message);
        process.exit(1);
    }
};

async function getJson(url) {
    const response = await fetch(url, {
        headers: {
            Accept: "application/hal+json, application/json, */*"
        }
    });

    if (!response.ok) {
        throw new Error(
            `Request failed: ${response.status}\n${await response.text()}`
        );
    }

    return response.json();
}

async function webhookExists(brokerUrl, providerName, oasServiceUrl) {
    const url =
        `${brokerUrl}/webhooks/provider/` +
        encodeURIComponent(providerName);

    const collection = await getJson(url);
    const webhooks = collection?._links?.["pb:webhooks"] || [];

    for (const webhook of webhooks) {
        if (!webhook.href) continue;

        const details = await getJson(webhook.href);

        const hasEvent = (details.events || [])
            .some(event => event.name === "contract_content_changed");

        const hasTarget =
            details.request?.url ===
            `${oasServiceUrl}/compare-from-webhook`;

        if (hasEvent && hasTarget) {
            return true;
        }
    }

    return false;
}

async function createWebhook(brokerUrl, providerName, oasServiceUrl) {
    const url =
        `${brokerUrl}/webhooks/provider/` +
        encodeURIComponent(providerName);

    const payload = {
        events: [
            {
                name: "contract_content_changed"
            }
        ],
        request: {
            method: "POST",
            url: `${oasServiceUrl}/compare-from-webhook`,
            headers: {
                "content-type": "application/json",
                accept: "application/json"
            },
            body: {
                providerUrl: "${pactbroker.providerName}",
                pactUrl: "${pactbroker.pactUrl}",
                publishVerificationResult: true
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
        throw new Error(
            `Webhook creation failed: ${response.status}\n` +
            await response.text()
        );
    }

    core.info(`Webhook created for provider ${providerName}`);
}

async function run() {
    try {
        const brokerUrl = core.getInput("brokerUrl").replace(/\/+$/, "");
        const providerName = core.getInput("oasUrl").replace(/\/+$/, "");
        const oasServiceUrl = core.getInput("oasServiceUrl").replace(/\/+$/, "");

        const exists = await webhookExists(
            brokerUrl,
            providerName,
            oasServiceUrl
        );

        if (exists) {
            core.info(`Webhook already exists for ${providerName}`);
            return;
        }

        await createWebhook(
            brokerUrl,
            providerName,
            oasServiceUrl
        );
    } catch (error) {
        core.setFailed(error?.message || "Unknown error");
    }
}

run();