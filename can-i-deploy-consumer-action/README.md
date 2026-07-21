# `can-i-deploy-consumer-action`

Checks whether a consumer is safe to deploy by verifying both its direct contracts and any gateway-transformed contracts. The action automatically discovers connected gateways through the Pact Broker.

## Inputs

| Input               | Required | Default | Description                                             |
| ------------------- | -------- | ------- | ------------------------------------------------------- |
| `brokerUrl`         | Yes      | —       | URL of the Pact Broker                                  |
| `brokerToken`       | Yes      | —       | Authentication token for the Pact Broker                |
| `consumerName`      | Yes      | —       | Name of the consumer application                        |
| `consumerVersion`   | Yes      | —       | Consumer version, typically the commit SHA              |
| `toEnvironment`     | Yes      | —       | Target environment, such as `town21`                    |
| `retryWhileUnknown` | No       | `0`     | Number of retries when the deployment result is unknown |
| `retryInterval`     | No       | `10`    | Number of seconds between retries                       |

## How it works

1. Checks `consumerName@consumerVersion` directly against `toEnvironment`. This is **pair 1**, which covers the consumer's direct contracts.

2. Discovers connected gateways by finding Pact Broker participants that follow this naming format:

   ```text
   consumerName---GatewayName
   ```

3. For each discovered gateway, the action:

   * Finds its downstream providers using participants named:

     ```text
     GatewayName---ProviderName
     ```

   * Looks up the verified gateway SHA from pair 1.

   * Creates the following composite consumer version:

     ```text
     consumerVersion-gatewaySha
     ```

   * Fetches the latest transformed pact between `Consumer---Gateway` and the downstream provider.

   * Publishes the transformed pact under the composite version. This is **pair 2**.

   * Runs `can-i-deploy` for the composite version against `toEnvironment`.

4. The action fails if any pair 1 or pair 2 check fails.

If no gateways are found, only the direct pair 1 check runs. The action can therefore be used for both traditional consumers and consumers connected through a gateway.

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/can-i-deploy-consumer-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    brokerToken: ${{ secrets.PACT_BROKER_TOKEN }}
    consumerName: ${{ env.REPOSITORY_NAME }}
    consumerVersion: ${{ github.sha }}
    toEnvironment: ${{ inputs.environment }}
    retryWhileUnknown: 10
    retryInterval: 15
```

## Effect of the action

The action blocks the CD pipeline from continuing to the deployment step if either:

* The consumer's direct contracts are not safe to deploy.
* One or more gateway-transformed contracts are not safe to deploy.

This ensures that a consumer change is validated against the downstream providers behind the gateway, rather than only against the gateway itself.

## Output

The action does not produce an output value.

* Exit code `0`: All checks pass, and the consumer is safe to deploy.
* Exit code `1`: One or more checks fail, or a result remains unknown after all retries.
