# `webhook-oas-action`

Ensures that a Pact Broker webhook exists for validating a consumer contract against a provider's OpenAPI Specification.

The webhook calls the OAS validation service whenever the contract content changes.

## Inputs

| Input           | Required | Default | Description                                       |
| --------------- | -------- | ------- | ------------------------------------------------- |
| `brokerUrl`     | Yes      | —       | Pact Broker URL                                   |
| `providerName`  | Yes      | —       | Provider participant name used in the Pact Broker |
| `oasUrl`        | Yes      | —       | URL of the provider's OpenAPI Specification       |
| `oasServiceUrl` | Yes      | —       | Base URL of the OAS validation service            |

The action reads `REPOSITORY_NAME` from the environment automatically and uses it as the consumer name.

## How it works

1. Reads the consumer name from `REPOSITORY_NAME`.

2. Builds the OAS service endpoint:

   ```text
   {oasServiceUrl}/compare-from-webhook
   ```

3. Fetches existing webhooks for the consumer-provider pair.

4. Checks whether a webhook already exists with:

   * The event `contract_content_changed`
   * The configured OAS service endpoint
   * The configured `oasUrl`

5. If no matching webhook exists, creates one.

6. The webhook sends the following request body to the OAS service:

   ```json
   {
     "providerUrl": "OAS_URL",
     "pactUrl": "${pactbroker.pactUrl}",
     "publishVerificationResult": true
   }
   ```

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/webhook-OAS-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    providerName: dli-favorite.town21.dsservice.eu-swagger-v1-swagger.json
    oasUrl: https://dli-favorite.town21.dsservice.eu/swagger/v1/swagger.json
    oasServiceUrl: https://ds-platform-cdct-oas-service.dsservice.eu
```

## Effect of the action

Ensures that contracts using an OpenAPI Specification as the provider are verified automatically whenever their content changes.

The OAS service compares the Pact contract with the provider specification and publishes the verification result back to the Pact Broker.

## Output

The action does not produce an output value.

It logs whether the webhook already exists or was created.
