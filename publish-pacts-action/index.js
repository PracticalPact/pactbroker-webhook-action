const fs = require("fs");
const path = require("path");

function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`];
}

function getPactFiles() {
    const pactDir = path.resolve("./pacts");

    if (!fs.existsSync(pactDir)) {
        throw new Error(`Pact directory not found: ${pactDir}`);
    }

    const files = fs.readdirSync(pactDir)
        .filter(file => file.endsWith(".json"))
        .map(file => path.join(pactDir, file));

    if (files.length === 0) {
        throw new Error(`No Pact files found in ${pactDir}`);
    }

    return files;
}

async function publishPact(brokerUrl, pactFile, consumerVersion) {
    const pact = JSON.parse(fs.readFileSync(pactFile, "utf8"));

    const consumer = pact.consumer?.name;
    const provider = pact.provider?.name;

    if (!consumer || !provider) {
        throw new Error(
            `Missing consumer or provider name in ${path.basename(pactFile)}`
        );
    }

    const url =
        `${brokerUrl}/pacts/provider/${encodeURIComponent(provider)}` +
        `/consumer/${encodeURIComponent(consumer)}` +
        `/version/${encodeURIComponent(consumerVersion)}`;

    console.log(`Publishing ${consumer} -> ${provider}`);
    console.log(`PUT ${url}`);

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            Accept: "application/hal+json, application/json, */*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(pact)
    });

    const text = await response.text();

    console.log(`Status: ${response.status}`);
    if (text) console.log(text);

    if (!response.ok) {
        throw new Error(
            `Failed to publish ${path.basename(pactFile)}: ` +
            `${response.status}\n${text}`
        );
    }

    return consumer;
}

async function registerBranch(
    brokerUrl,
    consumer,
    consumerVersion,
    branch
) {
    const url =
        `${brokerUrl}/pacticipants/${encodeURIComponent(consumer)}` +
        `/branches/${encodeURIComponent(branch)}` +
        `/versions/${encodeURIComponent(consumerVersion)}`;

    console.log(`Registering branch ${branch} for ${consumer}@${consumerVersion}`);
    console.log(`PUT ${url}`);

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            Accept: "application/hal+json, application/json, */*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });

    const text = await response.text();

    console.log(`Status: ${response.status}`);
    if (text) console.log(text);

    if (!response.ok) {
        throw new Error(
            `Failed to register branch for ${consumer}: ` +
            `${response.status}\n${text}`
        );
    }
}

async function run() {
    const brokerUrl = getInput("brokerUrl")?.replace(/\/+$/, "");
    const consumerVersion = getInput("consumerVersion");
    const branch = getInput("branch");

    if (!brokerUrl) {
        throw new Error("brokerUrl is required");
    }

    if (!consumerVersion) {
        throw new Error("consumerVersion is required");
    }

    if (!branch) {
        throw new Error("branch is required");
    }

    const pactFiles = getPactFiles();
    const consumers = new Set();

    for (const pactFile of pactFiles) {
        const consumer = await publishPact(
            brokerUrl,
            pactFile,
            consumerVersion
        );

        consumers.add(consumer);
    }

    for (const consumer of consumers) {
        await registerBranch(
            brokerUrl,
            consumer,
            consumerVersion,
            branch
        );
    }

    console.log(`Published ${pactFiles.length} Pact contract(s)`);
}

run().catch(error => {
    console.error(error.message);
    process.exit(1);
});