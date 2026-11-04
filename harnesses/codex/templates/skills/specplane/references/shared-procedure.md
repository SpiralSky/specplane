# Specplane shared procedure and fallback (Codex)

This file ships inside the installed skill. Everything it points to is in this skill directory: the shared workflow contracts and documentation are under `docs/`, the runtime under `dist/`, and `specplane-extension.json` plus `core/inventory.json` describe and hash the package. No Specplane source repository is needed.

## Offline documentation and completion

- Read `docs/orientation.md` and `docs/manifest.json` for the bundled concepts, completion, plan workflow and command topics. `specplane docs [topic]` and `specplane docs search <text>` serve the same bundle when the CLI is available.
- Procedure contracts for `plan-step`, `plan-create`, `spec-assist`, `spec-draft-architecture`, `decision-new` and `validate` are bundled from `docs/sources/` (see `procedures` in `specplane-extension.json`). Follow them in place of any copy you remember.
- Completion is a declaration of implementation state: record it with `specplane spec complete` / `specplane spec implementation`. Matching a content fingerprint does not prove the code is correct. When the declared state is stale, ask for reassessment instead of re-declaring.
- Optional workflows (plans, decision records, architecture drafts) are used only when the repository or the user asks for them; ordinary work needs none of them.

## Persistent runner

When the Codex surface keeps a process tool channel open, start `node scripts/workflow.mjs serve --checkout <absolute-checkout>` from this skill directory and speak protocol-1 NDJSON (`inspect`, `prepare`, `executeTest`, `validate`, `record`, `capture`, `cancel`, `close`). One process holds the writer lease across preparation, reasoning and recording. The embedding session reports host identity and probes through `SPECPLANE_HOST_EVIDENCE` (JSON); without it preparation is refused. Do not invent host identity.

## Manual fallback

Without a persistent channel there is no retained lease. Label the session `Manual CLI fallback` and use the `specplane` CLI directly. Supply the recording manifest as `--recording-set FILE` for `plan step-done`: `{protocol:1,head,branch,changes:[{path,beforeDigest,afterDigest,purpose}]}`, with `"missing"` for added or deleted files. Report unsupported identity as unknown: never invent a model, provider, session or host version. Capture facts only from what the session actually exposes.

## Capability flags

This package declares `nativeCommands: false` and `backgroundSessions: false`. No native Codex command, background launcher or host-version claim is made without recorded host evidence; the installed manifest records only that files were observed on disk, not that Codex loaded them.
