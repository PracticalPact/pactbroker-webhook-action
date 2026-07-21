# `can-i-deploy-action`

Checks whether a specific version of an application is safe to deploy to a target environment by querying the Pact Broker matrix.

## Inputs

| Input               | Required | Default | Description                                             |
| ------------------- | -------: | ------: | ------------------------------------------------------- |
| `brokerUrl`         |      Yes |       — | URL of the Pact Broker                                  |
| `brokerToken`       |      Yes |       — | Authentication token for the Pact Broker                |
| `applicationName`   |      Yes |       — | Name of the application                                 |
| `version`           |      Yes |       — | Application version, typically the commit SHA           |
| `toEnvironment`     |      Yes |       — | Target environment, such as `town21`                    |
| `retryWhileUnknown` |       No |     `0` | Number of retries when the deployment result is unknown |
| `retryInterval`     |       No |    `10` | Number of seconds between retries                       |

## How it works

1. Queries the Pact Broker matrix for `applicationName@version` against `toEnvironment`.
2. If the application version is safe to deploy, the action exits successfully.
3. If the result is unknown and retries remain, the action waits for `retryInterval` seconds and tries again.
4. If the result is still unknown or not deployable after all retries, the action exits with code `1`.

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/can-i-deploy-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    brokerToken: ${{ secrets.PACT_BROKER_TOKEN }}
    applicationName: ${{ env.REPOSITORY_NAME }}
    version: ${{ github.sha }}
    toEnvironment: ${{ inputs.environment }}
    retryWhileUnknown: 10
    retryInterval: 15
```

## Effect of the action

The action blocks the CD pipeline from continuing to the deployment step when the Pact Broker indicates that the application version is not safe to deploy to the target environment.

This decision is based on the verification results of contracts between the application version and the provider versions currently deployed in that environment.

## Output

The action does not produce an output value.

* Exit code `0`: The application version is safe to deploy.
* Exit code `1`: The application version is not safe to deploy, or the result remains unknown after all retries.
