# `record-deployment-action`

Records a successful deployment of an application version to an environment in the Pact Broker.

## Inputs

| Input             | Required | Default | Description                                      |
| ----------------- | -------- | ------- | ------------------------------------------------ |
| `brokerUrl`       | Yes      | —       | Pact Broker URL                                  |
| `applicationName` | Yes      | —       | Name of the application                          |
| `version`         | Yes      | —       | Version being deployed, typically the commit SHA |
| `environment`     | Yes      | —       | Target environment, such as `town21`             |

## How it works

1. Looks up the UUID of the target environment in the Pact Broker.
2. Records `applicationName@version` as deployed to that environment.

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/record-deployment-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    applicationName: ${{ env.REPOSITORY_NAME }}
    version: ${{ github.sha }}
    environment: ${{ inputs.environment }}
```

## Effect of the action

Marks the application version as currently deployed in the target environment in the Pact Broker.

This deployment information is used by `can-i-deploy` checks to determine which application versions are currently present in each environment. It also allows the `DeployedOrReleased` consumer version selector to select the correct consumer versions.

This action should only run after the application has been deployed successfully. Otherwise, the Pact Broker could contain an incorrect deployment record.

## Output

The action does not produce an output value.

* Exit code `0`: The deployment was recorded successfully.
* Exit code `1`: The deployment could not be recorded.
