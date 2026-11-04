# Working with managed plans

A managed plan has explicit readiness, dependency and checkout requirements. Use the configured plans directory. Human readiness, approval and merge decisions remain distinct.

```sh
specplane plan list --live --no-fetch
specplane plan next 2026-01-01-example --json
```

The example plan ID must be replaced with an existing plan. Live listing can refuse inconsistent historical configuration rather than silently reinterpret paths. `plan next` inspects the next step and does not start a worker.

After a human readies the plan and its dependencies are satisfied, an explicit `plan start` prepares its managed checkout. Execute only the selected step. Recording requires an exact reviewed recording set; unrelated staged or working edits and partial staging refuse. Only the recording operation generates step status and HANDOFF changes. A manual recording manifest does not claim private workflow test receipts.

Specplane is agent-agnostic: the standalone CLI prepares and records plans but has no command that runs them or launches an agent session. Running steps belongs to an agent integration, and extension-owned conductor integration is unfinished. The shared conductor (`runConductor` in `specplane/core`) runs only with an adapter an extension supplies explicitly, never one chosen from installed files or registry order. Native launch, background capability and human-confirmation ports require separate host evidence. Managed finish, rebase and merge decisions must not be inferred from a successful test.
