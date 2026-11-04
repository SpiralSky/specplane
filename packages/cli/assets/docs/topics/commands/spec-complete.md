# Declare a specification complete

`spec complete` aliases `spec implementation --status complete` for an existing specification. The command changes implementation metadata, preserving body text and review state.

```sh
specplane spec complete feature/example --dry-run --json
```

Use `--root` to select a configured root when necessary. Replace the example identifier with your specification. Dry-run computes the proposed record without changing files. JSON reports implementation status, assessment status and reasons, fingerprint, changed file, changed and dry-run fields.

An unchanged repeated declaration is a no-op. Invalid metadata, unresolved requirements, ambiguous IDs and unsafe shared YAML anchors refuse before replacement. Review the reported assessment rather than treating a complete declaration as test execution evidence.

To record partial work use `spec implementation` with `--status partial`. Explicit completion writes remain uncommitted until you choose to commit them through your ordinary Git or selected managed workflow.
