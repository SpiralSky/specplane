# Verification method (2026-11-06)

Decided by the coordinator under the user's delegation, 2026-11-06.

The user describes a task. The agent runs it in a throwaway repository with the extension installed, in a fresh `claude -p` process, never in the working session.

1. Write the pass condition before the launch.
2. Run once. A failed run is a result, not a reason to retry without a new approval.
3. Save the full transcript under `harnesses/claude/host-evidence/<version>/`, with home paths redacted.
4. Say "verified" only as "observed on this version". Anything the run did not show is listed beside it.

First use: `harnesses/claude/host-evidence/2.1.317/usage-capture.txt` on branch `usage-percent-limit-20261106`.
