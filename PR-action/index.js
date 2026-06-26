function getInput(name) {
    return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

const log = {
    info: console.log,
    setFailed: (message) => {
        console.error(message);
        process.exit(1);
    }
};

// Fetch the pact content from the broker
async function fetchPact(pactUrl) {
    const response = await fetch(pactUrl, {
        headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch pact: ${response.status}\n${text}`);
    }
    return response.text();
}

function extractConsumerNameFromPactUrl(pactUrl) {
    const match = pactUrl.match(/\/consumer\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : "unknown-consumer";
}

async function githubRequest(path, method, body, token) {
    const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    return response.json();
}

async function ensureBranch(owner, repo, branch, fallback, token) {
    try {
        await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, "GET", null, token);
    } catch {
        const fallbackRef = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${fallback}`, "GET", null, token);

        await githubRequest(`/repos/${owner}/${repo}/git/refs`, "POST", {
            ref: `refs/heads/${branch}`,
            sha: fallbackRef.object.sha
        }, token);

        log.info(`Created base branch ${branch}`);
    }
}

async function run() {
    try {
        const githubToken = getInput("githubToken");
        const pactUrl = getInput("pactUrl");

        const consumerName =
            getInput("consumerName") ||
            extractConsumerNameFromPactUrl(pactUrl);

        const consumerBranch = getInput("consumerVersionBranch") || "unknown-branch";
        const consumerVersion = getInput("consumerVersionNumber") || "unknown-version";
        const providerName = getInput("providerName") || "unknown-provider";
        const baseBranch = getInput("baseBranch") || "main";
        const githubActor = getInput("githubActor") || "unknown-actor";

        const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

        const safeName = consumerName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .replace(/^-+|-+$/g, "");

        const date = new Date()
            .toISOString()
            .replace(/[T:]/g, "-")
            .replace(/\..+/, "");

        const branchName = `pact-failed/${safeName}-${date}`;

        await ensureBranch(owner, repo, baseBranch, "main", githubToken);

        const ref = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`, "GET", null, githubToken);
        const sha = ref.object.sha;

        await githubRequest(`/repos/${owner}/${repo}/git/refs`, "POST", {
            ref: `refs/heads/${branchName}`,
            sha
        }, githubToken);

        // Fetch and store pact content
        const pactContent = await fetchPact(pactUrl);
        const pactFileContent = Buffer.from(pactContent).toString("base64");

        await githubRequest(`/repos/${owner}/${repo}/contents/pact-failures/${safeName}-contract.json`, "PUT", {
            message: `[Pact] Add contract for ${consumerName}`,
            content: pactFileContent,
            branch: branchName
        }, githubToken);

        const prBody = [
            `## Contract Verification Failed`,
            ``,
            `The contract published by **${consumerName}** could not be verified by **${providerName}**.`,
            ``,
            `| | |`,
            `|---|---|`,
            `| Consumer | ${consumerName} |`,
            `| Consumer branch | ${consumerBranch} |`,
            `| Consumer version | ${consumerVersion} |`,
            `| Pact URL | ${pactUrl} |`,
            `| Triggered by | @${githubActor} |`,
            `| Contract file | pact-failures/${safeName}-contract.json |`,
            ``,
            `Please investigate and resolve the contract mismatch before merging.`
        ].join("\n");

        const pr = await githubRequest(`/repos/${owner}/${repo}/pulls`, "POST", {
            title: `[Pact] Contract verification failed: ${consumerName}`,
            body: prBody,
            head: branchName,
            base: baseBranch
        }, githubToken);

        log.info(`PR created: ${pr.html_url}`);
    } catch (error) {
        log.setFailed(error?.message || "Unknown error");
    }
}

run();