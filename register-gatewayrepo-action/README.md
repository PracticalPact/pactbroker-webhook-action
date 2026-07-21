# `register-gatewayrepo-action`

Registers the gateway's GitHub repository URL for all gateway-related participants in the Pact Broker.

The action automatically reads `GITHUB_REPOSITORY` from the GitHub Actions environment to determine the repository URL.

## Inputs

| Input         | Required | Default | Description                     |
| ------------- | -------- | ------- | ------------------------------- |
| `brokerUrl`   | Yes      | —       | Pact Broker URL                 |
| `gatewayName` | Yes      | —       | Name of the gateway application |

## How it works

1. Reads `GITHUB_REPOSITORY` from the environment.

2. Builds the GitHub repository URL from that value.

3. Fetches all participants from the Pact Broker.

4. Filters participants whose names:

   * Start with:

     ```text
     GatewayName---
     ```

   * End with:

     ```text
     ---GatewayName
     ```

5. Updates each matching participant with:

   * The gateway's GitHub repository URL
   * `mainBranch` set to `main`

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/register-gatewayrepo-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    gatewayName: ${{ env.REPOSITORY_NAME }}
```

## Effect of the action

Links all gateway-related participants in the Pact Broker to the gateway's GitHub repository.

This allows users to navigate directly from the Pact Broker UI to the gateway source code. It also gives transformed participants the correct repository context.

## Output

The action does not produce an output value.

It logs each participant that was successfully registered.
