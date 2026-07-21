# `gateway-record-deployment-action`

Records deployments for all gateway-related participants in the Pact Broker. This includes both downstream gateway-provider pairs and consumer-gateway composite pairs.

## Inputs

| Input             | Required | Default | Description                                              |
| ----------------- | -------- | ------- | -------------------------------------------------------- |
| `brokerUrl`       | Yes      | —       | Pact Broker URL                                          |
| `brokerToken`     | Yes      | —       | Pact Broker authentication token                         |
| `applicationName` | Yes      | —       | Name of the gateway application                          |
| `version`         | Yes      | —       | Gateway version being deployed, typically the commit SHA |
| `environment`     | Yes      | —       | Target environment, such as `town21`                     |

## How it works

1. Looks up the UUID of the target environment.

2. Fetches all Pact Broker participants.

3. For each downstream participant named:

   ```text
   GatewayName---ProviderName
   ```

   the action records the gateway SHA directly as deployed.

4. For each consumer-gateway participant named:

   ```text
   ConsumerName---GatewayName
   ```

   the action:

   * Fetches the consumer's latest version.

   * Checks its `pb:deployed-environments` link to determine whether the consumer is currently deployed to the target environment.

   * Skips the pair if the consumer is not deployed.

   * Finds the matching composite version:

     ```text
     consumerSha-gatewaySha
     ```

   * Records the composite version as deployed to the target environment.

Skipped consumer-gateway pairs do not cause the action to fail.

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/gateway-record-deployment-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    brokerToken: ${{ secrets.PACT_BROKER_TOKEN }}
    applicationName: ${{ env.REPOSITORY_NAME }}
    version: ${{ github.sha }}
    environment: ${{ inputs.environment }}
```

## Effect of the action

Ensures that the Pact Broker correctly records which versions of all gateway-related participants are deployed in each environment.

This allows `can-i-deploy` checks to use the correct versions for:

* Consumer-gateway contracts
* Gateway-provider transformed contracts
* Consumers and providers connected through the gateway

The action should only run after the gateway has been deployed successfully. Otherwise, the Pact Broker may contain incorrect deployment information.

## Output

The action does not produce an output value.

* Exit code `0`: All required deployment records were created successfully.
* Exit code `1`: One or more deployment records could not be created.
* Skipped consumer-gateway pairs do not cause failure.
