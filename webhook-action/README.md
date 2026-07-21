# `webhook-action`

Ensures that Pact Broker webhooks exist for all consumers of a given provider.

The webhooks trigger the provider's CI pipeline whenever a consumer publishes a contract that requires verification.

## Inputs

| Input          | Required | Default | Description                                                           |
| -------------- | -------- | ------- | --------------------------------------------------------------------- |
| `brokerUrl`    | Yes      | —       | Pact Broker URL                                                       |
| `providerName` | Yes      | —       | Name of the provider application                                      |
| `githubToken`  | Yes      | —       | GitHub token with `repo` scope, used to trigger `repository_dispatch` |

## How it works

1. Fetches all pacts for `providerName` from the Pact Broker.

2. Finds each consumer that has a contract with the provider.

3. Checks whether a webhook already exists for the following event:

   ```text
   contract_requiring_verification_published
   ```

4. If no matching webhook exists, creates one.

5. The webhook sends a `POST` request to the provider's GitHub repository using a `repository_dispatch` event.

The webhook payload sent to GitHub contains:

| Field          | Description                                     |
| -------------- | ----------------------------------------------- |
| `pact_url`     | URL of the Pact contract requiring verification |
| `sha`          | Provider version number                         |
| `branch`       | Provider version branch                         |
| `github_actor` | GitHub actor who created the webhook            |

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/webhook-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    providerName: ${{ env.REPOSITORY_NAME }}
    githubToken: ${{ secrets.PACT_GITHUB_TOKEN }}
```

## Effect of the action

Ensures that the provider's CI pipeline is triggered automatically whenever a consumer publishes a changed contract that requires verification.

Without these webhooks, provider teams would need to start verification manually or run it on a schedule.

## Output

The action does not produce an output value.

It logs:

* Webhooks that already exist
* Webhooks that were created
