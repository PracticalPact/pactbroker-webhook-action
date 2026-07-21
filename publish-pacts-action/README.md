# `publish-pacts-action`

Publishes Pact contract files to the Pact Broker and associates the published consumer version with a branch.

## Inputs

| Input             | Required | Default | Description                                 |
| ----------------- | -------- | ------- | ------------------------------------------- |
| `brokerUrl`       | Yes      | —       | Pact Broker URL                             |
| `consumerVersion` | Yes      | —       | Consumer version, typically the commit SHA  |
| `branch`          | Yes      | —       | Branch associated with the consumer version |

The action expects Pact files to exist in:

```text
./pacts
```

## How it works

1. Finds all `.json` files in the `./pacts` directory.
2. Fails if the directory does not exist or contains no Pact files.
3. Reads the consumer and provider names from each Pact file.
4. Publishes each contract to the Pact Broker under `consumerVersion`.
5. Collects the unique consumer names from the published contracts.
6. Registers `consumerVersion` as belonging to `branch` for each consumer.
7. Logs the number of contracts that were published.

## Example

```yaml
- uses: PracticalPact/pactbroker-webhook-action/publish-pacts-action@main
  with:
    brokerUrl: ${{ vars.BROKER_URL }}
    consumerVersion: ${{ github.sha }}
    branch: ${{ github.ref_name }}
```

## Effect of the action

Publishes the generated contracts so they can be verified by providers and used in Pact Broker compatibility checks.

Registering the branch allows the Pact Broker to associate the consumer version with its source branch. This is required for branch-based selectors and pending Pact workflows.

## Output

The action does not produce an output value.

* Exit code `0`: All Pact files were published and their branches were registered.
* Exit code `1`: The Pact directory was missing, no Pact files were found, or publishing failed.

The action logs each published consumer-provider pair and the total number of contracts published.
