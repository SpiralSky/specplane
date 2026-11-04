---
id: architecture/codex-integration
title: Codex extension implementation
status: approved
author: mixed
implements: [codex:feature/codex-integration, feature/agent-integration]
extends: [architecture/agent-skills]
based_on: { architecture/agent-skills: "7cc1d0f" }
---

<!-- Architecture reconciliation 2026-11-02: current feature contracts govern this draft revision. Stored lifecycle status and dependency pins are preserved; this edit is not approval or evidence of implementation. -->

<!-- Draft revision 2026-11-02: reconciles the user-approved optional-workflows feature text, completion assessment and shared docs. Existing lifecycle status describes prior approval, not approval or implementation of this architecture revision. -->

# Codex extension implementation

This Codex overlay packages the shared workflow contracts and core for execution inside the host. It replaces the former base-root Codex contract; references use `codex:architecture/codex-integration`. It is a target contract, not certification that native command or session APIs are implemented.

## Package and compatibility

`harnesses/codex/` contains the ecosystem manifest, bundled compatible core, workflow assets, shared/harness contract snapshots, and tests. The `codex` spec root extends `base`. An explicit `init --harness codex` installs or refreshes only this integration; plain init and `--harness none` write neutral scaffolding. The shared AGENTS.md block is always neutral. The extension identifies its host directly; no provider registration or default runtime exists.

Initially `.agents/skills/specplane/SKILL.md` supplies the existing-session reasoning workflow. Package the complete applicable procedures, including `architecture/agent-skills#plan-step`, and declare separate pins for shared and Codex contracts. Consumer installations need not contain Specplane's source specifications. Local contracts take precedence over scoped bundled snapshots, and ambiguous resolution is refused. A snapshot pin validates integrity, not behavioral conformance.

Use each target surface's verified command/tool/hook APIs. Native deterministic slash dispatch is enabled only after its complete path is verified, including result display without a model call. Otherwise report it unavailable and expose reasoning skills plus manual CLI instructions. Lifecycle hooks alone are not proof of native command dispatch. Built-in session commands remain untouched. Hook scripts must exist in the execution environment and use the host's normal trust flow; installing a package never changes sandbox or approval policy.

### Initial delivery layout

Repository delivery places the entry skill at `.agents/skills/specplane/SKILL.md`, with `scripts/workflow.mjs`, `core/` (including its CLI entry point and documentation bundle), `contracts/`, and `specplane-extension.json` beneath the same contained skill directory. The script is a Node ≥22 argument-array runner for the shared core's typed operations and JSON workflow envelopes; it has no host launcher, approval flag invented by the skill, or prompt dispatcher. The package includes the core runtime dependency inventory. Paths to these assets are relative to the installed skill, while repository paths always come from config. The skill must locate its delivered assets rather than assume Specplane's source tree exists in the consumer checkout.

The runner interface is `node <skill>/scripts/workflow.mjs serve --checkout <absolute-checkout>`. It exchanges one protocol-1 JSON object per line over stdin/stdout; diagnostics go to stderr. Input is `{id, method, params}` with method `inspect`, `prepare`, `executeTest`, `validate`, `record`, `capture`, `cancel`, or `close`; responses are `{id, result}` using the shared result envelope. Each method maps directly to the named core export and rejects unknown methods/fields. The process stays alive to own the writer lease across preparation, reasoning and recording. The existing session uses its permitted persistent-process tool channel, not a newly launched model. `close`, EOF, tool interruption or process loss cancels pending work; a surviving/unacknowledged worker requires recovery. A surface without a persistent tool channel uses the labeled manual CLI procedure instead of pretending a short-lived prepare process retained a lock.

`executeTest` maps to `executeWorkflowTest`; its `params` are exactly the shared request `{requestId, criterionIds, executable, args, reportFormat}`. It uses the preparation already held by this runner, not a second process or a new lease. After implementation edits, the session requests execution, waits for the returned test artifact and places it in the matching criterion evidence before validation/recording. Keep the transport able to receive `cancel` while execution is pending; serialize other mutating methods and refuse overlapping executions. The runner uses the host-authorized execution port and preserves its sandbox/permission behavior; if that port is unavailable, report the capability limitation and use the separately labelled manual fallback only after cancelling/releasing the prepared workflow. An ordinary shell test run is not converted into a core receipt. Test the complete protocol with a passing suite, a failing suite, stale inputs and cancellation, and verify the recorded HANDOFF summary survives without private receipt files.

Repository skill discovery and explicit invocation through `/skills` or `$specplane` follow the host's skill mechanism, which supplies agent instructions rather than native deterministic dispatch. The host scans `.agents/skills` from the current directory through the repository root; duplicate skill names are not merged. [Build skills](https://learn.chatgpt.com/docs/build-skills), inspected 2026-11-01.

Optional plugin distribution packages that same skill subtree under `harnesses/codex/plugin/skills/specplane/`. Target root `plugin.json` contains:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "specplane",
  "version": "0.1.0",
  "description": "Specplane reasoning workflows and manual lifecycle support"
}
```

The portable package uses root `skills/`; no MCP server, hook, or native command component is required initially. Official packaging documentation also supports `.codex-plugin/plugin.json` as a compatibility fallback; choose one canonical metadata source rather than merge divergent manifests. This target uses the portable format. [Package your plugin](https://developers.openai.com/plugins/build/plugins), inspected 2026-11-01.

Host package operations remain separate from `init`: documented CLI interfaces include `codex plugin marketplace add <source>`, `codex plugin add <plugin[@marketplace]>`, and `codex plugin list --json`. Report the actual package/version/enabled state from the host, with its trust flow. Do not run these as a repository-install side effect or create a fictitious published marketplace. Source registration alone is not installation. [Developer commands](https://learn.chatgpt.com/docs/developer-commands), inspected 2026-11-01. No local plugin was installed or enabled as part of this design review.

### Supported surface matrix

| Surface | Initial scope | Required evidence before use |
|---------|---------------|------------------------------|
| Local Codex CLI session | Existing-session reasoning skill and shell access to the manual CLI/bundled runner | Skill discovered in this checkout; Node/core/procedures available; exact plan checkout and permitted shell tools |
| Codex IDE or desktop local session | Same reasoning workflow when skill discovery and shell tools are available | Verify discovery, paths and execution environment on that particular surface; do not inherit CLI certification |
| Cloud or remote Codex session | Same single-step procedure only when its assets and tools are provisioned there | Verify checkout, package/runner availability, Node, required remote authentication, and publication capability in the actual environment |
| Native deterministic Specplane commands | Unavailable initially on every surface | Complete registration → direct handler → core → direct result path without a model call, plus collisions and direct-human confirmation |
| Background Codex adapter | Unavailable initially on every surface | Complete launch/observe/resume/identity/cancellation/budget protocol against named versions |

This is the supported design scope, not a tested-version matrix. Published skill and plugin documentation supports packaging reasoning assets, but does not establish the complete native dispatcher needed here. An MCP tool, slash entry loading a prompt, lifecycle hook, or host built-in command does not prove that path. In particular the host's `/approve` is not Specplane approval; use `specplane spec approve`, `plan approve`, or `decision accept` manually. [Skills](https://developers.openai.com/plugins/concepts/skills), [Developer commands](https://learn.chatgpt.com/docs/developer-commands). Host version and capability evidence remain absent until integration verification; flags in the Specplane manifest for native commands/background sessions stay false.

## Installation containment

Preserve customized skills with an actionable notice. Never write Codex configuration, Claude settings, credentials, or persistent permissions as a side effect. Inspect each existing path component with `lstat`, including dangling final links; refuse symlinked installation paths before creating directories or writing files. Validate package destinations and common initializer outputs separately. This requirement is not satisfied by `existsSync` followed by `realpath` on existing targets only.

Apply `architecture/reference-cli#explicit-upgrade-transaction` to the complete skill subtree, not just `SKILL.md`. Preserve customized legacy skills and report their exact migration diff; install no competing copy while discovery could select stale bytes. A plugin skill and repository fallback with the same entry name require explicit resolution of discovery precedence or removal of the recognized obsolete copy. Do not assume whichever was installed last wins. Installed manifests and pins describe the bytes actually delivered, never the source spec's intended future behavior.

## Workflow contract

1. Read current user instructions. For repository workflows resolve configured paths and verify the bundled core's version and contract compatibility before mutation. For product docs use the bundled CLI docs entry point without `--checkout`, config or Git discovery; no workflow lease is needed.
2. Only when managed plan execution is requested, use the complete shared `plan-step` procedure: synchronize an existing remote plan branch and refuse divergence; resolve the earliest unfinished step; read named context and HANDOFF; record context expansion and numbered gaps with required fields.
3. Delegate implementation and acceptance reasoning to the existing Codex session in the authorized isolated checkout. Validate structured outcomes and repository evidence before recording the permitted step through the core. Inspect staging before committing. Publish the plan branch when the shared procedure requires it, respecting explicit user constraints.
4. Record runtime-reported model identity at contribution time. Model A and B in one session are separate contributors; later model C adds a third rather than replacing either. Do not fabricate native session IDs or infer a model from the product label.
5. Human approval and finish/merge remain explicit user actions; unattended orchestration never performs them. A user-authorized experimental exception is recorded with scope and base, without changing global policy or inventing approval.

The existing session calls `prepareWorkflow` through the bundled runner, executes only the returned reasoning scope, and returns `WorkflowResult` to validation/recording. Output is JSON protocol 1 with structured errors and a commit receipt; prose cannot substitute for evidence. The skill must not independently edit step status/HANDOFF or commit before the core records it. In an explicitly labeled standalone CLI fallback it instead uses the shared `plan step-done` procedure and reports which boundary was used. A direct human performs lifecycle confirmations through the manual CLI; a model cannot claim that typing a tool command or summarizing user intent consumed a confirmation challenge.

Contribution observations follow `architecture/file-formats#capture-and-event-transport`. Capture runtime identity only from fields actually exposed for each action; unsupported identity fields stay omitted. A session's visible model label or a later `/model` selection cannot identify earlier edits. Supported subagent work returns separate action/revision evidence and reported identities, with parent linkage kept separate. If the surface exposes no action-time observation, preserve unknown contributors and an incomplete-capture notice rather than deriving identity from assistant text. The runner validates/deduplicates events and preserves prior model/human summaries and repeated trailers.

Cancellation follows the shared lease/worker protocol. A disconnected host is not proof its worker stopped; refuse a concurrent recorder until state is reconciled. Missing package, shell, synchronization or publication capability yields an explicit limitation; do not silently call another host or report a complete published step.

## Background-session limitation

There is initially no supported background Codex adapter. Refuse automation before plan preparation rather than using Claude flags or silently substituting hosts. Future background support must supply the shared adapter explicitly and verify launch, observation, resume, identity mapping, recovery instructions, and requested budget enforcement against named runtime versions. Executable presence or help text alone is insufficient.

## Verification

Test explicit/neutral initialization, coexistence and repeated initialization in both orders, customized files, dangling file links and escaping directory links, packaged core/procedures, and refusal without side effects. Test a normal permitted step against a temporary remote, including synchronization, acceptance checks, outcome recording, and publication. Keep experimental draft-worktree fixtures separately labeled.

Remove inherited `NODE_TEST_CONTEXT` from nested Node test environments, assert expected tests actually ran, and confirm a deliberately broken implementation fails the outer fixture. Fake adapters do not certify native command or live model compatibility. Verification records must state which tests executed and which host capabilities remain unverified.

Exercise same-session A/B contributions, later C edits, noncontributing model switches, unknown action identities, subagent deduplication, stale request/result bytes, stale confirmation refusal, cancellation during editing/recording/publication, and interrupted skill upgrades. Each enabled host/surface capability requires a report named by the compatibility manifest; documentation citations alone keep the tested-version matrix empty.

## Shared documentation delivery and completion interface

Package the compatible core's documentation bundle and manifest alongside its runtime inventory. Initial delivery uses `node <skill>/core/cli.js docs [<topic>]` or `docs search <text>` with optional `--json`; the build inventory identifies this actual CLI asset. This path works offline outside a repository and does not open the persistent workflow runner or acquire a lease. Completion uses that bundled CLI's `spec complete`/`spec implementation` commands in the selected checkout. These are manual command surfaces, not native dispatch. If a later certified surface enables native commands, register read-only documentation index/topic/search handlers through verified native dispatch, using the same typed docs operations as the CLI. The adapter returns shared topic bytes unchanged and can add host-specific invocation/capability notices separately. Query the host command inventory first; on name collision retain the host command and advertise the available documentation entry point rather than shadowing it. A host lacking native dispatch still exposes the bundled CLI docs through its established manual path.

Managed instruction assets contain the shared release orientation and documentation/contract versions. Resolve documentation relative to the installed package, not the product source checkout or an unrelated global executable. Installation verifies topic and manifest hashes. Explicit upgrade preserves custom/user-owned content under the shared upgrade transaction; ordinary docs lookup never installs, refreshes or accesses the network.

Completion handlers call shared `spec.complete`/`spec.implementation` operations, preserving separate review state and the current checkout's declared dependencies. They neither require a plan nor manufacture evidence. Completion guidance and manual edits remain valid outside managed plan workflows. Test docs/version parity with that bundled core, offline consumer usage, collision handling, stale guidance, and the ordinary-work/no-plan cases separately from live native-host certification.
