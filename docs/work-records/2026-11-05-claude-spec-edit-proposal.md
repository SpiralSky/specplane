# Proposal: combined Claude architecture-spec edit (and feature-spec suggestions)

Date 2026-11-05. Status: proposal, not applied. Nothing in this file edits an approved spec.
Targets: `harnesses/claude/specifications/architecture/claude-integration.md` (`architecture/claude-integration`, approved, `llm_role: draft`) and `harnesses/claude/specifications/features/claude-integration.md` (`feature/claude-integration`, approved, `llm_role: assist`).
Built against branch `overnight/specplane-20261102T144630Z` at `46bf791`. A later session builds offline from this file once the user approves it.

## Decisions needed from the user

Approval itself is yours: nothing here is applied until you approve the wording, and applying the architecture edit does not approve the spec (use `/approve`).

1. **Approve or amend the architecture edits A1 to A12.** They carry D17 option A, D16 option A, the new server surface, the D23 and D24 behavior, and the corrected stale text.
2. **D17 A field (TEMPORARY choice).** `record` gains an optional `confirmation` field holding the core's `ConfirmationResponse` (`challengeId`, `decision`, `interactionId`), delivered in a second `record` call after the server parks the challenge. Alternative: one parked call with a separate `confirm` tool. Section A6.
3. **D16 A command source (TEMPORARY choice).** The host-fixed command comes from a suite table bundled in the extension package, keyed by `suiteId`, and the model asks for a run through a mod-registered tool `specplane_run_tests` that takes only `requestId`. Alternatives: a new repository config key (needs a base configuration spec change), or reuse `plans.test_command` (a shell string, so unsuitable). Section A8.
4. **D20 item 6 CLI shape (TEMPORARY choice).** `specplane workflow list` and `specplane workflow recover <request-id>`, with a typed terminal confirmation and no `--yes`. This needs a matching edit to the approved reference CLI spec, which this proposal does not draft. Section A9.
5. **Feature-spec suggestions F1 to F4** need your approved wording because the feature spec's `llm_role` is `assist`. I wrote candidate text; I will not apply it unless you approve each exact change.
6. **D11 carried over.** Under `allowManagedHooksOnly` a user-tier plugin loads no hooks. A3 states the risk as accepted (TEMPORARY, from the coordinator). Alternative: require managed shipping.
7. **A correction to HANDOFF.** The architecture spec never says "in-process" (grep finds no match). It is silent on where the runner and lease live, and the plugin manifest, MCP server, `.claude/specplane` root, `types/` and the origin gate are all absent. So the fix is additions plus the corrections in the table below, not a rewording of an in-process claim.

## Verification of the stale text (line by line)

Line numbers refer to the architecture spec unless marked F (feature spec).

| Where | What the spec says | What is true now | Verdict | Edit |
| --- | --- | --- | --- | --- |
| L29 | Package contains "a mod, the compatible shared core, ..., reasoning skills, and policy hooks"; `harnesses/claude/plugin/` is the primary package | Also contains a plugin MCP server that owns the writer lease (D11). The installed package is the `.claude/specplane` root | Incomplete | A1 |
| L33-48 | Install tree has `.claude/skills`, `rules`, `hooks`, `settings.json`, `AGENTS.md` only | Installer also stages `.claude/specplane/` (manifest, `hooks/`, `types/`, `core/`) and a `.gitignore` entry (`claude.ts` `installClaudePlugin`, `installClaudePackage`, `installHostIgnore`; constants `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PACKAGE_DIR`) | Missing `.claude/specplane` root, `types/`, `.gitignore` | A1 |
| L68 | `plugin/  # primary extension: mod, bundled core, reasoning assets; optional UI` | Source dir holds `.claude-plugin/plugin.json`, `hooks/` (`hooks.json`, `register.tsx`, `commands.ts`, `handlers.ts`), `types/index.d.ts`, tests. The bundled core is not in it; the build copies it from `packages/cli` | Stale | A2 |
| L411-414 | `init` writes skills, rules, hooks, settings | Also writes the plugin root, the bundled core and the `.gitignore` entry | Incomplete | A10 |
| L439 | Plugin tests: mode switching, denials, pane rows | Also `claude-mcp.test`, `claude-handlers.test`, `claude-package.test`, `harness.test` gitignore case | Incomplete | A11 |
| L445 | `hooks/hooks.json` with `modules: ["./register.js"]`, `hooks/register.js`; "ships `specplane-extension.json`" | `hooks.json` names `./register.tsx`; `specplane-extension.json` is at the bundled core root (`.claude/specplane/core/`); the plugin manifest declares an MCP server | Stale | A4 |
| L447-451 | Mod calls "the bundled core"; "retain request/lease state"; "registered completion tool" | Core and lease live in the plugin MCP server, not the mod; completion tool is `specplane_result`; prompt carries a result template; attempts are limited | Silent / incomplete | A3, A5 |
| L453 | Interaction port `$.ui.ask` "with the core challenge's exact payload" | Right in intent, but the core confirms inside the server process, so the response must cross the server boundary. No field exists for it | Gap (D17 A) | A6 |
| L455 | "`PreToolUse`/mod tool hooks enforce policy around agent tools" | The mod's `tool.check` is also an origin gate: `allow` for the mod's own server call, `deny` for any other | Missing | A7 |
| L459 | "No source citation certifies an active dispatcher." | Live evidence now exists under `harnesses/claude/host-evidence/2.1.317/` (D13, D18) | Missing | A12 |
| L186-320 (shell hooks) | Pre-commit, policy guard, session context, status line | Unchanged and accurate. HANDOFF's "hooks section (about line 445)" is the dispatch section, not this one | No change | none |
| D18 | Not mentioned | Interactive check resolved it: lease held across calls by the server | Missing | A3, A12 |
| F L52-64 rows 54-58 | spec-assist "(without authoring it)"; plan-finish "Run the finish flow ...; without the CLI, prints the manual merge sequence" | `assist` role writes the finalised body after approval (F Scenario 6a); native `plan-finish` refuses and stays manual (D15 B) | Stale for two rows | F1, F2 |
| F L46-50 | "Skills deliver reasoning phases"; approval commands collect human decision directly | Fine, but nothing says finalised workflow content is confirmed by the user | Gap | F3 |

## Architecture-spec edits

Each edit gives the section, the current text copied from the file, and the exact proposed text.

### A1. Files produced: package description and install tree

Section: `## Files produced` (L29 and L33-48).

Current L29:

````markdown
The extension package is a Claude plugin containing a mod, the compatible shared core, shared workflow procedures/contract snapshots, reasoning skills, and policy hooks. `harnesses/claude/plugin/` is the primary package, not merely an optional pane. Repository files below are supporting assets and reasoning fallbacks; a mechanical workflow must not also install a prompt skill under its native command's name. Detect and report legacy name collisions during explicit upgrade rather than silently shadowing one implementation.
````

Proposed L29:

````markdown
The extension package is a Claude plugin containing a mod, a bundled copy of the compatible shared core, a plugin MCP server that owns the writer lease (`## Workflow server and writer lease`), shared workflow procedures/contract snapshots, reasoning skills, and policy hooks. `harnesses/claude/plugin/` is the source of the plugin root, not merely an optional pane; `specplane init --harness claude` installs it as `.claude/specplane/`. Repository files below are supporting assets and reasoning fallbacks; a mechanical workflow must not also install a prompt skill under its native command's name. Detect and report legacy name collisions during explicit upgrade rather than silently shadowing one implementation.
````

Current L33-48:

````markdown
```
.claude/
  skills/
    specplane-reason-<workflow>/SKILL.md  # reasoning only; distinct from public commands
  rules/
    specplane.md                  # standing instructions (Specplane-owned; overwritten on update)
  hooks/
    specplane-pre-commit.sh       # registered by default
    specplane-policy-guard.sh     # registered by default
    specplane-session-context.sh  # registered by default
    specplane-statusline.sh       # registered only if no status line is configured
    specplane-handoff-check.sh    # optional; installed, not registered
    specplane-generate.sh         # optional; installed, not registered
  settings.json                   # hook and status line registration (merged into any existing settings)
AGENTS.md                         # managed block written by base `specplane init`
```
````

Proposed L33-48 (adds the plugin root and the ignore entry; the rest is unchanged):

````markdown
```
.claude/
  skills/
    specplane-reason-<workflow>/SKILL.md  # reasoning only; distinct from public commands
  rules/
    specplane.md                  # standing instructions (Specplane-owned; overwritten on update)
  hooks/
    specplane-pre-commit.sh       # registered by default
    specplane-policy-guard.sh     # registered by default
    specplane-session-context.sh  # registered by default
    specplane-statusline.sh       # registered only if no status line is configured
    specplane-handoff-check.sh    # optional; installed, not registered
    specplane-generate.sh         # optional; installed, not registered
  specplane/                      # the plugin root; the host loads it as plugin `specplane`
    .claude-plugin/plugin.json    # host manifest; declares the `specplane` MCP server
    hooks/                        # the mod: hooks.json, register.tsx, commands.ts, handlers.ts
    types/index.d.ts              # the host mod declarations the mod is written against
    core/                         # bundled compatible core: specplane-extension.json, inventory,
                                  #   host-evidence/claude-code.json, dist/ (incl. harness/claude-mcp-main.js)
    tsconfig.json                 # written by the host when it loads the plugin; never shipped (see below)
  settings.json                   # hook and status line registration (merged into any existing settings)
.gitignore                        # gains one line, `.claude/specplane/tsconfig.json` (added once; existing lines kept)
AGENTS.md                         # managed block written by base `specplane init`
```
````

Add after the paragraph "**User-owned files are not edited.** ..." (L52), as a new sentence at its end:

````markdown
The host rewrites `.claude/specplane/tsconfig.json` each time it loads the plugin. The installer therefore does not ship that file and adds it to the repository's `.gitignore`, so the host's rewrite cannot dirty the checkout baseline that workflow requests are bound to. `.gitignore` is otherwise user-owned: the installer appends its one line when missing and reports `Updated .gitignore (ignores .claude/specplane/tsconfig.json)`.
````

### A2. Template source: plugin directory

Section: `### Template source` (L68).

Current:

````markdown
  plugin/                         # primary extension: mod, bundled core, reasoning assets; optional UI
````

Proposed:

````markdown
  plugin/                         # source of the installed plugin root (`.claude/specplane/`)
    .claude-plugin/plugin.json    #   host manifest and MCP server declaration
    hooks/                        #   the mod (hooks.json, register.tsx, commands.ts, handlers.ts)
    types/index.d.ts              #   host mod declarations
                                  #   The bundled core is not stored here: the CLI build copies it from
                                  #   `packages/cli` into the package it stages as `.claude/specplane/core/`.
````

### A3. New section: Workflow server and writer lease

Insert a new `##` section immediately before `## Claude session adapter (extension-owned)` (L461). No current text.

Proposed text:

````markdown
## Workflow server and writer lease

The plugin manifest declares one MCP server, `specplane`. The host starts it from the bundled core with `node ${CLAUDE_PLUGIN_ROOT}/core/dist/harness/claude-mcp-main.js`, and lists it as `plugin:specplane:specplane`. Its tools appear to the model as `mcp__plugin_specplane_specplane__<tool>`. The server hosts one persistent protocol-1 workflow runner (`architecture/reference-cli`). **The runner, not the mod and not the model, owns the writer lease** from `prepare` until the request is recorded, cancelled or closed. The lease is held across tool calls for the life of the server process; the mod never takes, adopts or releases a lease itself.

The checkout is `SPECPLANE_CHECKOUT` when set, else the working directory, and must be an absolute path. Compatibility comes only from the installed package: its `specplane-extension.json` and `host-evidence/claude-code.json`. If either is missing or unreadable, every `prepare` is refused as incompatible and the manual CLI remains available.

**Binding.** The mod generates a nonce of at least 16 characters and calls `bind` once per session. Every other tool call repeats it; a second `bind`, a missing nonce or a mismatching nonce is refused. The nonce is a second check behind the origin gate (`## Deterministic command dispatch`, origin gate), never the only one.

**Tools.** Every tool except `bind` needs the nonce.

| Tool | Effect |
| --- | --- |
| `bind` | Binds the session once. |
| `inspect` | Reports a prepared or recorded request. |
| `prepare` | Prepares a request and takes the writer lease. The reply is compact: `requestId`, `workflow`, `status`, `detailChars`. The full request stays in the server. |
| `detail` | Returns one page of the prepared request, selected by `requestId` and `offset`. A page is at most 2048 characters of the serialized request; the reply gives `total`, `next` and `done`. |
| `executeTest` | Runs the reviewed suite for a prepared request with a host-fixed command (`### Reviewed test suites`). |
| `validate` | Takes `requestId` and the `WorkflowResult`. The server validates against the request it holds for that id; the request is never sent back. A request that is not open is refused. |
| `record` | Records a validated result. When the core needs the user's confirmation, see `### Confirming finalised content`. |
| `capture` | Captures a proposed contribution. |
| `cancel` | Cancels one request by `requestId` and releases its lease when the workers are proven stopped. |
| `close` | With `requestId`, releases that request's lease. Without it, closes every open request of the session and reports `closed` and `failed` ids; none is dropped silently. |

**Reply bound.** No reply exceeds 16 KB, the host's MCP result limit. A reply that would is not delivered; for `prepare` the server also cancels the request and releases its lease, because nobody could close a request they never received.

**Closing.** `close` releases the lease. The mod closes a request when the result is recorded, when the result or a later refusal ends the request, when the prepare reply or its `detail` pages cannot be read, and when the completion result cannot be read. A request ended by an `INVALID_EVIDENCE` refusal that is still correctable stays open (`## Deterministic command dispatch`, attempt limit). A released request leaves no lease behind, which a live run confirmed for a blocked result (host evidence, `origin-gate-check.txt`, "Recording check").

**Session end.** On disconnect the server cancels pending work and releases every lease it can prove released. A worker that is not proven stopped keeps its lease and the server exits non-zero. That state needs `### Recovering a lease left by an ended session`.

**Plugin hooks and managed settings (D11).** Under `allowManagedHooksOnly` a user-tier plugin loads no hooks, so the mod would not run. The accepted position is that the plugin ships at user tier and that this limitation is documented rather than worked around. TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review). Alternative: ship as a managed plugin.

### Reviewed test suites

A plan step whose criteria carry `testRequirements` needs the reviewed suite to run. The server never runs an executable or arguments that the model, or any text from a prepared request, supplies. `executeTest` takes only `requestId` and `criterionIds`. The server resolves each required `suiteId` to a command in a suite table bundled in the extension package and installed with the core (`.claude/specplane/core/`), runs it with the checkout as working directory and without a shell, and passes the report back to the core for assertion matching exactly as `architecture/reference-cli` defines. An unknown `suiteId` is refused, and the request is cancelled and its lease released.

The model starts a run through the mod-registered tool `specplane_run_tests`, whose only input is `requestId`. The mod calls `executeTest` and returns the receipt reference for the model to cite in `criterionEvidence[].artifacts`. A receipt the core did not produce is not evidence.

Until this path is delivered and live-checked, the server cancels a prepared `plan-step` whose criteria carry `testRequirements`, releases its lease, and says to run the step through the managed plan-step flow.

TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review): the bundled suite table and the `specplane_run_tests` tool. Alternatives: a new config key naming each suite's command (needs a base configuration spec change), or reuse `plans.test_command` (a shell string, so it cannot name one suite).

### Recovering a lease left by an ended session

If a Claude session ends while a request is open (the terminal is closed, the host is killed, the model never calls the completion tool and `close` does not run), the writer lease stays held with host-worker evidence. Nothing releases it silently: the core reclaims such a lease only after trusted proof that the prior worker stopped, and a dead owner process is a necessary condition, not that proof.

Recovery is an explicit user operation on the CLI, which has no model turn:

```
specplane workflow list [--json]
specplane workflow recover <request-id> [--dry-run] [--json]
```

- `workflow list` is read-only. For each lease retained with host-worker evidence in this repository it prints the request id, workflow, checkout, owner process id and whether that process is alive, the lease age, and the recovery state. It never mutates.
- `workflow recover` refuses unless the owner process is dead and the retained records match the lease set recorded for that request. It then prints what it will do and asks the user, on the terminal, to type the request id to confirm that the Claude session that held the request has ended. With no terminal it refuses with `CONFIRMATION_REQUIRED`; there is no `--yes`. On confirmation it adopts the lease through the core's host-recovery path, restores any recognised core-generated recording files from the durable record if recording had begun, and releases the lease. It never deletes lease records by hand, and it leaves the model's working-tree edits untouched and says to inspect `git status`.
- A later `prepare` that meets such a lease reports the request id and this command in its refusal.
- `--dry-run` runs every check and prints the plan without confirming or changing anything.

TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review): the command names and the typed-id attestation as stopped-worker proof. Alternatives: (B) reclaim automatically at the next `prepare` when the owner process is dead (rejected: no proof the worker stopped), (C) document manual deletion of the lease files (rejected: bypasses the core's checks). The CLI half belongs in `architecture/reference-cli`, which needs a matching approved edit.
````

### A4. Deterministic command dispatch: package files

Section: `## Deterministic command dispatch`, first paragraph (L445).

Current:

````markdown
The target package includes `.claude-plugin/plugin.json`, `hooks/hooks.json` with `modules: ["./register.js"]`, and `hooks/register.js` exporting `register(on, options)`. It also ships `specplane-extension.json`, the bundled core build inventory and snapshots. The host manifest identifies the plugin; the separate Specplane manifest validates core/procedure compatibility before registration. Host installation/enablement is an explicit plugin operation; repository initialization reports prepared assets and remaining host steps instead of claiming the mod is loaded.
````

Proposed:

````markdown
The installed plugin root (`.claude/specplane/`) contains `.claude-plugin/plugin.json`, `hooks/hooks.json` with `modules: ["./register.tsx"]`, and `hooks/register.tsx` exporting `register(on, options)`, plus `types/` with the host mod declarations. The manifest also declares the `specplane` MCP server (`## Workflow server and writer lease`). The bundled core at `.claude/specplane/core/` carries `specplane-extension.json`, its build inventory and the procedure and contract snapshots. The host manifest identifies the plugin; the separate Specplane manifest validates core/procedure compatibility before registration. Host installation/enablement is an explicit plugin operation; repository initialization reports prepared assets and remaining host steps instead of claiming the mod is loaded.
````

### A5. Deterministic command dispatch: delegation, completion tool, result template, attempt limit

Section: same, the two paragraphs at L449 and L451.

Current L449:

````markdown
Reasoning commands prepare the exact step/context through the core and explicitly invoke the installed reasoning procedure through the verified host turn/tool mechanism. After agent work, core validators check the structured outcome and actual repository state before step recording. Human approvals use the host's explicit user interaction and the core's approval transition; model-generated text is never approval evidence. Agent-invoked tools call the same validated operations but cannot manufacture a user command or an approval.
````

Proposed L449:

````markdown
Reasoning commands call the server's `prepare` through the mod, read the request in `detail` pages, and explicitly invoke the installed reasoning procedure through the verified host turn/tool mechanism. The commands are registered only when the native reasoning path is enabled; while it is disabled, the reasoning commands and the completion tool are not registered and the legacy reasoning skills keep their names. After agent work, core validators check the structured outcome and actual repository state before step recording. Human approvals use the host's explicit user interaction and the core's approval transition; model-generated text is never approval evidence. Agent-invoked tools call the same validated operations but cannot manufacture a user command or an approval.
````

Current L451:

````markdown
The target delegation path is `$.prompt.submit({text})` with the prepared request and the internal reasoning asset's path, followed by a registered completion tool accepting `WorkflowResult`. Never use `asUser: true`: extension-origin input must retain its origin and cannot confer human authorization. Do not await submission while a host turn is active; retain request/lease state and validate the matching result when the turn completes. A refused submission, abandoned event, or missing completion capability cancels/refuses the workflow rather than falling through to the default prompt handler. Wire `next.signal` and host interruption to shared cancellation; stop unacknowledged workers before releasing locks. Exact tool registration and prompt/result signatures are compiled against the installed declarations and tested per surface before enabling this path.
````

Proposed L451 (replaces it; the first part keeps the existing wording):

````markdown
The delegation path is `$.prompt.submit({text})` with the prepared request and the internal reasoning asset's path, followed by the mod-registered completion tool `specplane_result`, which accepts `{requestId, result}` with `WorkflowResult`. Never use `asUser: true`: extension-origin input must retain its origin and cannot confer human authorization. The command hook schedules the submit with `$.clock.after`, with `turn.complete` as a backstop, because a hook cannot submit and a command that raises no model turn raises no `turn.complete`; the procedure therefore starts from the command alone. Do not await submission while a host turn is active; retain request state and validate the matching result when the turn completes. A refused submission, abandoned event, or missing completion capability closes the request and its lease rather than falling through to the default prompt handler. Wire `next.signal` and host interruption to shared cancellation; stop unacknowledged workers before releasing locks. Exact tool registration and prompt/result signatures are compiled against the installed declarations and tested per surface before enabling this path.

**The prompt.** The prompt is extension-origin text, not an approval. It carries the prepared request and the completion tool's name. It also carries a schema-valid `WorkflowResult` built from the request: its `requestId`, `baseDigest` and one `criterionEvidence` entry per criterion filled in, `outcome: "blocked"` and every assessment `unmet`, so a template sent back unchanged claims nothing. It tells the model to replace the template's text, to give a `BLOCKED:` line in `openIssues` for a blocked outcome, and to call the completion tool even when it cannot finish, so the request always closes. The core's schema refusal names the first failing field and never echoes its value.

**Interim rule for workflows that would write text.** While finalised content cannot be confirmed through the mod (`### Confirming finalised content` is not delivered and live-checked), the prompts for `spec-assist`, `spec-draft-architecture`, `plan-create` and `decision-new` carry this rule, and this overrides any procedure step that returns a body: *"This request cannot create a file or bind finalized text, and this overrides any procedure step that returns a body: leave out `creation` and `finalizedEdits`, give the user the approved text in your reply, report `blocked`, and name the manual command."* The implementation constant is `MANUAL_WRITE_RULE`. The rule is removed when the confirmation path lands.

**Attempt limit.** A request accepts at most 3 result submissions. A refusal with code `INVALID_EVIDENCE` is correctable and changes nothing in the core, so the request stays open and the reply says how many attempts are left. Any other refusal, a lost call, a `record` refusal, or the third `INVALID_EVIDENCE` ends the request, releases its lease, and tells the model to rerun the command. The completion tool's reply says the requests were closed only when `close` succeeded.

**Recording.** `record` is live-checked for a blocked result only: validate, record, receipt and lease release ran. A `done` result, a commit and a written spec have not been run live.
````

### A6. Confirming finalised content (D17 option A)

Section: `## Deterministic command dispatch`, paragraph at L453, plus a new subsection under `## Workflow server and writer lease`.

Current L453:

````markdown
The interaction port uses a verified direct human UI operation (target `$.ui.ask`) with the core challenge's exact payload. If that operation is unavailable, mechanical read-only commands still work and confirmation-requiring transitions refuse with manual CLI instructions. Agent tool calls cannot submit confirmation responses. Query the command inventory before registering; if a built-in or customized prompt owns a name (including `/approve` on any surface where it is host-owned), leave that Specplane handler unavailable and report the manual command. Catch each registration failure separately so one collision does not skip unrelated registrations. Do not silently introduce aliases or shadow built-ins.
````

Proposed L453:

````markdown
The interaction port is the mod's direct human UI operation, `$.ui.ask` with the core challenge's exact summary and the choices `Confirm` and `Cancel`. If that operation is unavailable, or the ask is dismissed or rejected (for example under `claude -p`, where no one can answer), mechanical read-only commands still work, confirmation-requiring transitions refuse with manual CLI instructions, and a request that needs confirmation ends as `blocked`. Agent tool calls cannot submit confirmation responses: the server accepts a confirmation only through the mod's authenticated, origin-checked call. Query the command inventory before registering; if a built-in or customized prompt owns a name (including `/approve` on any surface where it is host-owned), leave that Specplane handler unavailable and report the manual command. Catch each registration failure separately so one collision does not skip unrelated registrations. Do not silently introduce aliases or shadow built-ins. The full confirmation protocol is in `### Confirming finalised content`.
````

New subsection, placed after `### Reviewed test suites`:

````markdown
### Confirming finalised content

A result that carries `finalizedEdits` or `creation` needs the user's confirmation before the core writes anything. The core confirms inside the server process, which has no screen, so the response crosses the server boundary through one protocol field.

- **Field.** `record` accepts an optional `confirmation`: the core's `ConfirmationResponse`, exactly `{challengeId, decision, interactionId}` with `decision` either `confirm` or `decline` and `interactionId` a fresh identifier the mod generates for each dialog. No other tool accepts it.
- **Flow.** The mod calls `record` with the validated proposal. The core builds its challenge; the server parks the core call at its interaction port and replies to the mod with `ok: false`, code `CONFIRMATION_REQUIRED`, and the challenge (`challengeId`, `targets`, `summary`, digests, `expiresAt`) in `error.details.challenge`. The mod shows `challenge.summary` unmodified in `$.ui.ask(summary, ['Confirm', 'Cancel'])`. The mod then calls `record` again with the same proposal and `confirmation`. The server matches `challengeId` to the parked challenge, hands the response to the core, and the core finishes or refuses.
- **Rules.** The server accepts `confirmation` only for a challenge it has parked for that `requestId`, once, and only until the challenge's `expiresAt`. A `decline`, a dismissed or rejected dialog, an expired challenge, a mismatched `challengeId`, a `cancel` or a `close` ends the parked call as a refusal; nothing is written and the request is closed. The mod never answers its own dialog; the model's text is never a response.
- **Trust.** The response is trusted as direct-human only because it arrives through the nonce-bound, origin-checked mod call (`## Deterministic command dispatch`, origin gate). Removing the nonce later needs a server protocol change, so the nonce stays.
- **After confirmation** the interim rule in `## Deterministic command dispatch` is removed, and the four writing workflows may return `creation` and `finalizedEdits`. Lifecycle approval remains a separate operation: this confirmation never approves a spec.

TEMPORARY (coordinator, 2026-11-05, user offline; awaiting user review): the field name `confirmation` and the two-call flow. Alternative: keep one parked `record` call and add a `confirm` tool that carries the response.
````

### A7. Origin gate

Section: `## Deterministic command dispatch`, paragraph at L455.

Current:

````markdown
`PreToolUse`/mod tool hooks enforce policy around agent tools; they are not command dispatchers. Direct user slash commands and agent Skill invocations have different paths and are tested independently. Capture model identity at each contributing action, preserving all models across switches instead of attributing all edits to the final model.
````

Proposed:

````markdown
`PreToolUse`/mod tool hooks enforce policy around agent tools; they are not command dispatchers. Direct user slash commands and agent Skill invocations have different paths and are tested independently. Capture model identity at each contributing action, preserving all models across switches instead of attributing all edits to the final model.

**Origin gate.** The mod's `tool.check` handler is the gate for the workflow server's tools. It answers `allow` for a call the host reports as originating from this plugin (`next.origin.plugin` is `specplane`) and `deny` for every other caller, even one that holds the nonce, with the reason that Specplane workflow tools are reserved for Specplane commands. A model's call reads `engine`/`core` origin. The completion tool `specplane_result` is the model's and passes through to the host's normal permission handling. The gate fails closed: a throwing check refuses. Answering `allow` itself also avoids two host behaviors seen live: under auto mode the classifier refused the mod's own call with no verdict, and in default mode every mod call showed a permission prompt carrying all arguments, including the nonce.
````

### A8, A9

A8 (reviewed test suites) and A9 (lease recovery) are the two subsections inside A3 above; they are listed separately in "Decisions needed" because each has its own TEMPORARY choice.

### A10. `specplane init` output

Section: `## \`specplane init\` output for Claude Code` (L411-414).

Current:

````markdown
- Internal reasoning skills, `.claude/rules/specplane.md`, and `.claude/hooks/*.sh` (mode `0755`). Refresh uses `architecture/reference-cli#explicit-upgrade-transaction`: replace unmodified owned assets, preserve customized files, and retire recognized legacy public prompt skills only when the replacement is ready. Conflicts are reported with exact paths and disable the affected native name until resolved.
- The registrations via § Settings merge.

It never creates or edits `CLAUDE.md`. It prints one `Created`/`Updated`/`Skipped` line per file (as base `init` does), followed by "Claude Code integration files written to `.claude/`."
````

Proposed:

````markdown
- Internal reasoning skills, `.claude/rules/specplane.md`, and `.claude/hooks/*.sh` (mode `0755`). Refresh uses `architecture/reference-cli#explicit-upgrade-transaction`: replace unmodified owned assets, preserve customized files, and retire recognized legacy public prompt skills only when the replacement is ready. Conflicts are reported with exact paths and disable the affected native name until resolved.
- The plugin root `.claude/specplane/` (manifest, `hooks/`, `types/`) and the bundled core at `.claude/specplane/core/`, staged through the same transaction. Preserved core files that no longer match the package inventory make the MCP server refuse preparation until they are reconciled; the manual CLI remains available.
- The `.claude/specplane/tsconfig.json` line in `.gitignore` (`### Files produced`).
- The registrations via § Settings merge.

It never creates or edits `CLAUDE.md`. It prints one `Created`/`Updated`/`Skipped` line per file (as base `init` does), followed by "Claude Code integration files written to `.claude/`."
````

### A11. Testing

Section: `## Testing` (L439), add after that bullet.

Current:

````markdown
- The plugin has its own tests (`harnesses/claude/plugin/`, run with `claude plugin test`): mode switching, the `step`-mode edit denials, and pane rows built from a fixture `plan list --json` output.
````

Proposed addition (new bullets after L439):

````markdown
- The workflow server is tested without a host: `claude-mcp.test` (bind and nonce rules; compact `prepare`; `detail` paging; `validate` by `requestId`; `close` with and without `requestId`; the 16 KB bound asserted per reply on a realistic fixture; cancellation of an undeliverable `prepare`; the test-requirement refusal), `claude-handlers.test` (origin gate allow and deny; completion tool attempt limit; result template validates against `workflowResultSchema`; the interim rule appears only for the four writing workflows; close on lost prepare, unreadable detail or unreadable result; the `close` wording), `claude-package.test` and `harness.test` (plugin root staging; the `.gitignore` entry). Added with D17 A: parked-challenge confirmation cases (confirm, decline, dismissed, expired, mismatched id, replay). Added with D16 A: unknown `suiteId` refusal, and a check that no model-supplied executable reaches the runner. Added with the recovery command: dead and live owner, mismatched records, no terminal, `--dry-run`.
- Live checks are separate from these tests and each needs the user's fresh approval (`### Host evidence`).
````

### A12. Host evidence

Section: end of `## Deterministic command dispatch`, after L459.

Current:

````markdown
Design sources inspected 2026-11-01: [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [Add a command](https://code.claude.com/docs/en/plugins/mods/api#add-a-command), and [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference). These sources informed the target mod design; current host support still requires the installed-declaration and live-version checks above. No source citation certifies an active dispatcher.
````

Proposed addition after L459:

````markdown
**Host evidence.** Recorded runs against Claude Code 2.1.317 are under `harnesses/claude/host-evidence/2.1.317/`: the plugin loaded and its server started from `.claude/specplane/core` with `${CLAUDE_PLUGIN_ROOT}` expanded; an interactive check showed the lease held across calls by the server and released by `close`; the origin gate ran `bind`, `prepare` and `detail` in auto and default mode with no classifier refusal and no prompt; a blocked result was validated, recorded and closed. Not shown live: a `done` result, a commit, a written spec (D17), the D24 prompt, and native macOS or Windows. Each live run is a separate, user-approved operation and is never retried.
````

## Feature-spec suggestions (not applied; they need the user's approved wording)

`feature/claude-integration` has `llm_role: assist`, so these are suggestions only. The feature spec forbids architecture detail (leak guard), so none of this names a server, a protocol or a tool. Each change below is a candidate; reply with the exact wording you want or "approved as written".

### F1. `/spec-assist` row

Current (L54):

````markdown
| `/spec-assist` | `spec-assist` | Help the user write a feature spec (without authoring it) |
````

Suggested:

````markdown
| `/spec-assist` | `spec-assist` | Help the user write a feature spec; under `assist` the agent writes the body only after the user approves the finalised content |
````

Reason: "(without authoring it)" contradicts `assist` and Scenario 6a.

### F2. `/plan-finish` row

Current (L58):

````markdown
| `/plan-finish` | `plan-finish` | Run the finish flow for the current plan; without the CLI, prints the manual merge sequence |
````

Suggested:

````markdown
| `/plan-finish` | `plan-finish` | Assess whether the current plan is ready to finish and explain gaps; the finish itself is run by the user through the CLI, and the command says so |
````

Reason: D15 option B, native `plan-finish` refuses and stays manual.

### F3. Confirmation of workflow-written content

Current (L48, the last sentence of the paragraph; nothing else changes):

````markdown
Each workflow references and pins every applicable shared procedure and its Claude-specific contract. The extension packages these procedures for consumers and adds host invocation details without redefining policy. Mechanical commands parse arguments, invoke validated core operations, and display results without a model turn. Reasoning workflows invoke agent work only after deterministic preparation; final recording and policy checks run through the core. Approval commands collect the human decision directly and never use model output as authorization.
````

Suggested sentence, added after "Approval commands collect the human decision directly and never use model output as authorization.":

````markdown
When a workflow would create a file or bind finalised spec text, the user sees the exact content in a confirmation dialog and confirms it there; the agent's text is never the confirmation, and confirming does not approve a spec. Where no dialog is available the workflow reports the manual command instead.
````

### F4. Lease left by an ended session

Current: no text. Suggested new paragraph at the end of `## Sessions in worktrees and the cloud` (after L103):

````markdown
If a session ends while a workflow request is still open, the repository stays protected against other writers until the user releases it with an explicit command; nothing releases it silently, and the command first checks that the previous session's work has stopped.
````

## What a build session does after approval

1. Apply A1 to A12 to the architecture spec in one commit (`docs(claude-integration): ...`), then F1 to F4 only as the user approved them. Re-pin per `specplane spec pin`; do not set any status.
2. Build D17 A: `confirmation` field on `record` in `packages/cli/src/harness/claude-mcp.ts`, a parked interaction port per request, the mod's two-call flow in `harnesses/claude/plugin/hooks/handlers.ts` and `commands.ts`; remove `MANUAL_WRITE_RULE`. Offline tests as listed in A11. Do not flip `reasoning`.
3. Build D16 A: bundled suite table, `executeTest` taking only `requestId` and `criterionIds`, `specplane_run_tests`; remove the D16 C refusal only when the tests pass.
4. Build the recovery command. Check first whether the core has a lease-only recovery path: the existing callers of `recoverHostLease` (`core/pending-recovery.ts`, `core/recording-recovery.ts`) need a durable recording record, and a request that never began recording may have none. If not, a small core function is needed that reads the host marker and adopts the lease under the same stopped-worker rule.
Build note, D17 A (PROVISIONAL, built offline on 2026-11-05 before approval; revert with its two commits): the proposal is implementable as written, with these findings to fold into A6 if approved.
- The core calls its interaction port with no request id, so the server finds the calling `record` through async context and parks the challenge under that request. The runner takes the port in its context (`interaction`), so every prepared request in the server now has a confirmation port; with `MANUAL_WRITE_RULE` active the model sends no finalized content, so D17 B still holds in practice.
- The server also ends the parked call and closes the request when the second call repeats a different proposal, is malformed, answers a different challenge, arrives after `expiresAt`, repeats a second `record` without `confirmation`, or when `close` or `cancel` arrives. A declined or refused answer also closes the request on the server (the mod closes it again, which is harmless).
- Limit: `challenge.summary` carries the full before and after text of each file. A summary over the 16 KB reply bound cannot be delivered, so the server ends the call and the user must use the manual command. Paging the summary through `detail` is a possible later addition; A6 does not cover it and the user may want to decide.
- Not shown live: the dialog under auto and default mode, and `$.ui.ask` at tool-call time (the completion tool runs inside a model turn).
Build note, D16 A (PROVISIONAL, built offline on 2026-11-05 before approval; revert with its commit): implementable as written, with these findings to fold into A8 if approved.
- The table lives in `packages/cli/src/harness/claude-suites.ts` (`BUNDLED_SUITES`, shipped with the core). It is empty: no reviewed suite was invented, so with the bundled table every `suiteId` is unknown. The user must add reviewed entries (`executable`, `args`, `format`); `executable: 'node'` means the running Node binary.
- The existing server `executeTest` tool already forwarded model-supplied `executable` and `args` to the runner. It now takes only `requestId` and the nonce (any other key, including `criterionIds`, is refused before anything runs), and is unavailable unless the server is given a table. A8 says `executeTest` takes `requestId` and `criterionIds`; the build derives the criteria from the held request instead, so the model cannot narrow or widen them. Fold this into A8.
- Without a table the D16 C refusal is unchanged. `claude-mcp-main.ts` passes no table, so the installed server still refuses. The refusal is lifted only for a server constructed with `suites` (tests, or a later entry change). The proposal says to remove C "only when the tests pass" but not where the table is wired; wiring the entry is left for approval.
- With a table, `prepare` refuses a plan-step naming a suite outside it (cancel, lease released); `executeTest` also refuses a table format that differs from the required one. One run per suite; a criterion needing two suites gets two receipts.
- The mod tool `specplane_run_tests` is registered only when `reasoning` is true. The delegation prompt does not yet mention it. Not live-checked.

5. Sync templates and run `check-sync.sh`, `hooks.test.sh`, the focused suites and the full suite through `scripts/test.sh`.
