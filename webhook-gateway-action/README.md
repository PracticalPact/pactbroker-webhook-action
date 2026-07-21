# `webhook-gateway-action`

Ensures that Pact Broker webhooks exist for all gateway-related participants.

The action finds participants connected to the gateway and creates missing webhooks that trigger the gateway repository's CI pipeline when a contract requires verification.

## Inputs

| Input         | Required | Default | Description                                                   |
| ------------- | -------- | ------- | ------------------------------------------------------------- |
| `brokerUrl`   | Yes      | —       | Pact Broker URL                                               |
| `githubToken` | Yes      | —       | GitHub token with permission to trigger `repository_dispatch` |
| `gatewayName` | Yes      | —       | Name of the gateway application                               |

The action reads the following values automatically from the GitHub Actions environment:

| Environment variable | Description                                 |
| -------------------- | ------------------------------------------- |
| `GITHUB_REPOSITORY`  | Repository that receives the dispatch event |
| `GITHUB_ACTOR`       | GitHub user who configured the webhook      |

## How it works

1. Fetches all participants from the Pact Broker.

2. Finds participants whose names:

   * Start with:

     ```text
     GatewayName---
     ```

   * End with:

     ```text
     ---GatewayName
     ```

3. For each matching participant, fetches all consumers that have published contracts for it.

4. Checks whether a webhook already exists for:

   ```text
   contract_requiring_verification_published
   ```

5. If no matching webhook exists, creates one that sends a `repository_dispatch` event to the gateway repository.

The webhook payload contains:

| Field          | Description                                     |
| -------------- | ----------------------------------------------- |
| `pact_url`     | URL of the Pact contract requiring verification |
| `sha`          | Provider version number                         |
| `branch`       | Provider version branch                         |
| `github_actor` | GitHub actor who created the webhook            |

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/gateway-webhook-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    githubToken: ${{ secrets.PACT_GITHUB_TOKEN }}
    gatewayName: ${{ env.REPOSITORY_NAME }}
```

## Effect of the action

Ensures that the gateway CI pipeline is triggered whenever a contract requiring verification is published for a gateway-related participant.

This allows one gateway repository to handle verification for both consumer-gateway contracts and transformed gateway-provider contracts.

## Output

The action does not produce an output value.

It logs:

* Gateway-related participants that were found
* Webhooks that already exist
* Webhooks that were created
