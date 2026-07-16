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
    oasUrl,
    oasServiceUrl
) {
    const url =
        `${brokerUrl}/webhooks/provider/` +
        encodeURIComponent(providerName);

    core.info(`Checking webhooks for provider: ${providerName}`);

    const collection = await getJson(url);
    const webhooks = collection?._links?.["pb:webhooks"] || [];

    for (const webhook of webhooks) {
        if (!webhook.href) continue;

        core.info(`Inspecting webhook: ${webhook.href}`);

        const details = await getJson(webhook.href);

        const hasEvent = (details.events || [])
            .some(event => event.name === "contract_content_changed");

        const hasTarget =
            details.request?.url ===
            `${oasServiceUrl}/compare-from-webhook`;

        const hasOasUrl =
            details.request?.body?.providerUrl === oasUrl;

        if (hasEvent && hasTarget && hasOasUrl) {
            core.info(`Webhook already exists for ${providerName}`);
            return true;
        }
    }

    return false;
}

async function createWebhook(
    brokerUrl,
    providerName,
    oasUrl,
    oasServiceUrl
) {
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

    core.info(`Webhook created for ${providerName}`);
}

async function run() {
    try {
        const brokerUrl = core
            .getInput("brokerUrl")
            .replace(/\/+$/, "");

        const providerName = core.getInput("providerName");

        const oasUrl = core
            .getInput("oasUrl")
            .replace(/\/+$/, "");

        const oasServiceUrl = core
            .getInput("oasServiceUrl")
            .replace(/\/+$/, "");

        const exists = await webhookExists(
            brokerUrl,
            providerName,
            oasUrl,
            oasServiceUrl
        );

        if (exists) return;

        await createWebhook(
            brokerUrl,
            providerName,
            oasUrl,
            oasServiceUrl
        );
    } catch (error) {
        core.setFailed(error?.message || "Unknown error");
    }
}

run();