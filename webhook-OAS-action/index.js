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

function getWebhookUrl(
    brokerUrl,
    providerName,
    consumerName
) {
    return (
        `${brokerUrl}/webhooks/provider/` +
        `${encodeURIComponent(providerName)}/consumer/` +
        encodeURIComponent(consumerName)
    );
}

async function getJson(url) {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/hal+json, application/json, */*"
        }
    });

    if (!response.ok) {
        const text = await response.text();

        throw new Error(
            `Request failed: ${url}\n` +
            `Status: ${response.status}\n\n${text}`
        );
    }

    return response.json();
}

async function webhookExists(
    brokerUrl,
    providerName,
    consumerName,
    oasUrl,
    targetUrl
) {
    const url = getWebhookUrl(
        brokerUrl,
        providerName,
        consumerName
    );

    core.info(
        `Checking webhooks for ${consumerName} -> ${providerName}`
    );

    const collection = await getJson(url);
    const webhookLinks =
        collection?._links?.["pb:webhooks"] || [];

    for (const webhook of webhookLinks) {
        if (!webhook.href) continue;

        core.info(`Inspecting webhook: ${webhook.href}`);

        const details = await getJson(webhook.href);

        const hasEvent = (details.events || []).some(
            event =>
                event.name === "contract_content_changed"
        );

        const hasTarget =
            details.request?.url === targetUrl;

        const hasOasUrl =
            details.request?.body?.providerUrl === oasUrl;

        if (hasEvent && hasTarget && hasOasUrl) {
            core.info(
                `Webhook already exists for ${consumerName} -> ${providerName}`
            );

            return true;
        }
    }

    return false;
}

async function createWebhook(
    brokerUrl,
    providerName,
    consumerName,
    oasUrl,
    targetUrl
) {
    const url = getWebhookUrl(
        brokerUrl,
        providerName,
        consumerName
    );

    const payload = {
        events: [
            {
                name: "contract_content_changed"
            }
        ],
        request: {
            method: "POST",
            url: targetUrl,
            headers: {
                "content-type": "application/json",
                accept: "application/json"
            },
            body: {
                providerUrl: oasUrl,
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
        const text = await response.text();

        throw new Error(
            `Webhook creation failed: ${response.status}\n${text}`
        );
    }

    core.info(
        `Webhook created for ${consumerName} -> ${providerName}`
    );
}

async function run() {
    try {
        const brokerUrl = core
            .getInput("brokerUrl")
            .replace(/\/+$/, "");

        const providerName =
            core.getInput("providerName");

        const oasUrl =
            core.getInput("oasUrl");

        const oasServiceUrl = core
            .getInput("oasServiceUrl")
            .replace(/\/+$/, "");

        const consumerName =
            process.env.REPOSITORY_NAME;

        if (!brokerUrl) {
            throw new Error("brokerUrl is required");
        }

        if (!providerName) {
            throw new Error("providerName is required");
        }

        if (!oasUrl) {
            throw new Error("oasUrl is required");
        }

        if (!oasServiceUrl) {
            throw new Error("oasServiceUrl is required");
        }

        if (!consumerName) {
            throw new Error(
                "REPOSITORY_NAME environment variable is required"
            );
        }

        const targetUrl =
            `${oasServiceUrl}/compare-from-webhook`;

        const exists = await webhookExists(
            brokerUrl,
            providerName,
            consumerName,
            oasUrl,
            targetUrl
        );

        if (exists) return;

        await createWebhook(
            brokerUrl,
            providerName,
            consumerName,
            oasUrl,
            targetUrl
        );
    } catch (error) {
        core.setFailed(
            error?.message || "Unknown error"
        );
    }
}

run();