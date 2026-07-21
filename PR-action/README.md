# `pr-action`

Opens a pull request in the provider repository when Pact contract verification fails.

The pull request includes the failing contract JSON, allowing developers to review the failure without needing direct access to the Pact Broker.

## Inputs

| Input                   | Required | Default                  | Description                                                       |
| ----------------------- | -------- | ------------------------ | ----------------------------------------------------------------- |
| `githubToken`           | Yes      | —                        | GitHub token with permission to create branches and pull requests |
| `providerName`          | Yes      | —                        | Name of the provider application                                  |
| `pactUrl`               | Yes      | —                        | URL of the failing contract in the Pact Broker                    |
| `consumerName`          | No       | Extracted from `pactUrl` | Name of the consumer whose contract failed                        |
| `consumerVersionBranch` | No       | `unknown-branch`         | Branch associated with the consumer version                       |
| `consumerVersionNumber` | No       | `unknown-version`        | Version number of the consumer                                    |
| `githubActor`           | No       | `unknown-actor`          | GitHub actor who triggered the verification                       |
| `baseBranch`            | No       | `main`                   | Branch that the pull request should target                        |

## How it works

1. Checks whether `baseBranch` exists.

2. If the branch does not exist, creates it from `main`.

3. Creates a new branch using the following naming format:

   ```text
   pact-failed/{consumer-name}-{timestamp}
   ```

4. Fetches the failing Pact contract from `pactUrl`.

5. Commits the contract JSON to:

   ```text
   pact-failures/{consumer-name}-contract.json
   ```

6. Opens a pull request against `baseBranch`.

7. Adds a summary table to the pull request containing:

   * Consumer name
   * Consumer branch
   * Consumer version
   * Pact URL
   * GitHub actor

## Example

```yaml
- if: failure()
  uses: PracticalPact/pactbroker-webhook-action/pr-action@main
  with:
    githubToken: ${{ secrets.PACT_GITHUB_TOKEN }}
    providerName: ${{ env.REPOSITORY_NAME }}
    pactUrl: ${{ github.event.client_payload.pact_url }}
    githubActor: ${{ github.event.client_payload.github_actor }}
    baseBranch: pact-failures
```

## Effect of the action

Creates a visible and actionable pull request in the provider repository when contract verification fails.

The pull request contains the complete failing contract JSON. This allows developers or automated agents to investigate the mismatch and make the required changes without needing access to the Pact Broker.

## Output

The action logs the URL of the created pull request.
