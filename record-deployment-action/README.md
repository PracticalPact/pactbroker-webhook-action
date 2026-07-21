# `record-deployment-action`

Records a successfully deployed application version in a Pact Broker environment.

## Inputs

| Input             | Required | Default | Description                                                   |
| ----------------- | -------- | ------- | ------------------------------------------------------------- |
| `brokerUrl`       | Yes      | —       | Pact Broker URL                                               |
| `applicationName` | Yes      | —       | Name of the deployed application                              |
| `version`         | Yes      | —       | Application version, typically the commit SHA                 |
| `environment`     | Yes      | —       | Environment the application was deployed to, such as `town21` |

## How it works

1. Fetches all environments from the Pact Broker.
2. Finds the environment whose name matches `environment`.
3. Reads the UUID of the matched environment.
4. Records `applicationName@version` as deployed to that environment.
5. Fails if the environment cannot be found or the deployment record cannot be created.

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

Marks the specified application version as deployed in the target environment.

This information allows the Pact Broker to determine which versions are currently deployed when running `can-i-deploy` checks and selecting deployed consumer or provider versions.

The action should run only after the deployment has completed successfully. Running it before deployment could cause the Pact Broker to contain an incorrect deployment state.

## Output

The action does not produce an output value.

* Exit code `0`: The deployment was recorded successfully.
* Exit code `1`: The environment was not found or the deployment could not be recorded.

The action logs the application name, version and environment after a successful update.
