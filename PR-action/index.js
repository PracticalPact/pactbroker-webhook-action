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

async function fetchPact(pactUrl) {
    const response = await fetch(pactUrl, {
        headers: { Accept: "application/json" }
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
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
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

async function ensureBranch(owner, repo, branch, fallbackBranch, token) {
    try {
        await githubRequest(
            `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
            "GET",
            null,
            token
        );

        log.info(`Branch ${branch} already exists`);
    } catch {
        const fallbackRef = await githubRequest(
            `/repos/${owner}/${repo}/git/refs/heads/${fallbackBranch}`,
            "GET",
            null,
            token
        );

        await githubRequest(
            `/repos/${owner}/${repo}/git/refs`,
            "POST",
            {
                ref: `refs/heads/${branch}`,
                sha: fallbackRef.object.sha
            },
            token
        );

        log.info(`Created branch ${branch} from ${fallbackBranch}`);
    }
}

async function getBranchSha(owner, repo, branch, token) {
    const ref = await githubRequest(
        `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        "GET",
        null,
        token
    );

    return ref.object.sha;
}

async function createBranch(owner, repo, branch, sha, token) {
    await githubRequest(
        `/repos/${owner}/${repo}/git/refs`,
        "POST",
        {
            ref: `refs/heads/${branch}`,
            sha
        },
        token
    );

    log.info(`Created branch ${branch}`);
}

async function getFileSha(owner, repo, path, branch, token) {
    try {
        const file = await githubRequest(
            `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
            "GET",
            null,
            token
        );

        return file.sha;
    } catch {
        return null;
    }
}

async function createOrUpdateFile(owner, repo, path, branch, content, message, token) {
    const existingSha = await getFileSha(owner, repo, path, branch, token);

    const body = {
        message,
        content: Buffer.from(content).toString("base64"),
        branch
    };

    if (existingSha) {
        body.sha = existingSha;
    }

    await githubRequest(
        `/repos/${owner}/${repo}/contents/${path}`,
        "PUT",
        body,
        token
    );

    log.info(existingSha ? `Updated ${path}` : `Created ${path}`);
}

async function run() {
    try {
        const githubToken = getInput("githubToken");
        const pactUrl = getInput("pactUrl");

        if (!githubToken) throw new Error("Missing required input: githubToken");
        if (!pactUrl) throw new Error("Missing required input: pactUrl");

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
        const filePath = `pact-failures/${safeName}-contract.json`;

        await ensureBranch(owner, repo, baseBranch, "main", githubToken);

        const baseSha = await getBranchSha(owner, repo, baseBranch, githubToken);

        await createBranch(owner, repo, branchName, baseSha, githubToken);

        const pactContent = await fetchPact(pactUrl);

        await createOrUpdateFile(
            owner,
            repo,
            filePath,
            branchName,
            pactContent,
            `[Pact] Add contract for ${consumerName}`,
            githubToken
        );

        const prBody = [
            "## Contract Verification Failed",
            "",
            `The contract published by **${consumerName}** could not be verified by **${providerName}**.`,
            "",
            "| | |",
            "|---|---|",
            `| Consumer | ${consumerName} |`,
            `| Consumer branch | ${consumerBranch} |`,
            `| Consumer version | ${consumerVersion} |`,
            `| Pact URL | ${pactUrl} |`,
            `| Triggered by | @${githubActor} |`,
            `| Contract file | ${filePath} |`,
            "",
            "Please investigate and resolve the contract mismatch before merging."
        ].join("\n");

        const pr = await githubRequest(
            `/repos/${owner}/${repo}/pulls`,
            "POST",
            {
                title: `[Pact] Contract verification failed: ${consumerName}`,
                body: prBody,
                head: branchName,
                base: baseBranch
            },
            githubToken
        );

        log.info(`PR created: ${pr.html_url}`);
    } catch (error) {
        log.setFailed(error?.message || "Unknown error");
    }
}

run();