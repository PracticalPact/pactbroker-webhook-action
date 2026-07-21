# `can-i-deploy-gateway-action`

Checks whether a gateway is safe to deploy by verifying all downstream provider contracts and consumer-gateway contracts. This action is used in the gateway's CD pipeline.

## Inputs

| Input               | Required | Default | Description                                     |
| ------------------- | -------- | ------- | ----------------------------------------------- |
| `brokerUrl`         | Yes      | —       | Pact Broker URL                                 |
| `brokerToken`       | Yes      | —       | Pact Broker authentication token                |
| `applicationName`   | Yes      | —       | Name of the gateway application                 |
| `toEnvironment`     | Yes      | —       | Target environment (e.g. `town21`)              |
| `retryWhileUnknown` | No       | `0`     | Number of retries while verification is unknown |
| `retryInterval`     | No       | `10`    | Seconds between retries                         |

## How it works

1. Discovers all downstream participants named `GatewayName---X`, representing transformed gateway-provider pairs.
2. Discovers all consumer participants named `X---GatewayName`, representing consumer-gateway pairs.
3. Runs `can-i-deploy` using the latest version of each discovered participant against `toEnvironment`.
4. Fails if any participant cannot be safely deployed.

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/can-i-deploy-gateway-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    brokerToken: ${{ secrets.PACT_BROKER_TOKEN }}
    applicationName: ${{ env.REPOSITORY_NAME }}
    toEnvironment: ${{ inputs.environment }}
    retryWhileUnknown: 10
    retryInterval: 20
```

## Effect of the action

Blocks the gateway deployment if any downstream gateway-provider pair or consumer-gateway pair cannot be safely deployed.

This ensures that the gateway version being deployed remains compatible with all connected consumers and downstream providers.

## Output

The action does not produce an output value.

* Exit code `0`: All checks pass and the gateway is safe to deploy.
* Exit code `1`: One or more checks fail, or a result remains unknown after all retries.
