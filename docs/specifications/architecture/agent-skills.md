---
id: architecture/agent-skills
title: Agent skills
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [harness R21.1, harness R14, harness R18, harness R19, harness R19.1, harness R19.2, harness R20, harness R20.1, harness R26, harness R26.1, harness R26.2, harness R34, harness R35, harness R35.1, harness R47, harness §2, harness §3, harness R21, harness R38, harness R38.1, steering R22, steering R23, steering R51, steering R59, steering R59.1, plan-execution R27, plan-execution R27.1, plan-execution R27.2, plan-execution R27.3, plan-execution R27.4, plan-execution R27.5, plan-execution R27.5.1, plan-execution R27.5.2, plan-execution R27.6, plan-execution R31, plan-execution §2, plan-execution §3, requests R52, requests R52.3, requests R52.4, specifications R67, verification R36.1, verification R61.2, verification R61.3, later-releases R37, later-releases R66, specifications R4, specifications R65, plans §3.2, later-releases R37.1]
references: [plan-execution R27.1.1, plan-execution R27.2.1, plan-execution R31.2, requests R52.1, requests R52.2, steering §2, roles-and-permissions R57, cli R16, cli R16.1, specifications R10, specifications R11.3, plans R28, plans R28.1, plans R30.1, plans R69, verification R12, verification R24, verification R36, verification R36.2, verification R61.1, verification R64, configuration R54, architecture/reference-cli §5.3, architecture/reference-cli §7.3, architecture/reference-cli §8, architecture/reference-cli §11.3, architecture/reference-cli §11.5, architecture/reference-cli §11.5.1, architecture/reference-cli §11.6, architecture/reference-cli §11.7, architecture/reference-cli §12.1, architecture/reference-cli §12.2, architecture/reference-cli §12.3, architecture/reference-cli §12.4, architecture/reference-cli §12.5, architecture/reference-cli §12.6, architecture/reference-cli §12.7, architecture/file-formats §5.5, architecture/file-formats §5.6, architecture/file-formats §6, architecture/file-formats §8, architecture/repository-layout §3, architecture/repository-layout §5, architecture/reference-cli §11.2, architecture/reference-cli §12, architecture/file-formats §6.1, architecture/file-formats]
---

# Agent skills

This spec says how Specplane's harness-neutral command contracts work: what a contract contains, what the standing instructions say, how command instructions and steering are assembled and delivered, how the LLM retrieves specification context, and the contract of each harness command. A contract says what the LLM and the harness do; it never repeats a mechanical operation, which the CLI core performs and the harness reaches through actions (`architecture/reference-cli §12.1`). The modules that deliver these texts are in `architecture/reference-cli §12`; where installed files live is `architecture/repository-layout §5`; file contents are in `architecture/file-formats`. Each section states which feature sections it implements. Details the feature specs leave open are marked "assumption". Later-release items are marked "later release".

## §1 Contract structure

Implements `harness R34`, `harness R35`, `harness R35.1`, `harness R18`.

A **command contract** is one markdown template per command, shared by every harness (assumption: `assets/commands/<command>.md` in the package). Core steering and docs (`§4`, `§7`) are filled into it; a harness adapter packages the result in its own format (a skill folder, a prompt file, a hook payload) and adds only invocation detail, never behaviour (`harness R34`). Every contract has these parts in this order:

1. **Purpose.** One paragraph: what the command does for the user and which feature sections it carries out.
2. **Preconditions.** What must hold before anything happens: configuration present, permissions held (mode named per action), spec or plan state. A failed precondition ends the command with the reason and no change.
3. **Steps.** Numbered, each marked `[code]` (done by an action, mechanical, no model) or `[llm]` (needs reasoning or writing). A `[code]` step is a named action of `architecture/reference-cli §12.1`; the LLM never reconstructs one by hand (`harness R47`).
4. **Permissions and requests.** For each action the permission it uses and what happens under allow, request user and deny (`§5`).
5. **Output.** What the LLM tells the user at the end, in a few sentences.

Rules every contract follows:

- **Config first.** The first step of every contract except documentation lookup reads `.specplane/config.yaml` through `config.get` and resolves every path from it (`architecture/file-formats §6`); it never assumes one. In a project without configuration the contract does nothing and says Specplane is not set up (`harness §2`).
- **Typed command versus words.** A command typed with no arguments runs its `[code]` steps only and starts no model turn; with arguments it passes them with the contract to the LLM (`harness R18`). Asking the LLM in plain words runs the same contract under the LLM's role and the same checks (`harness R18`).
- **Capability check.** A contract names the capabilities it needs (`instructions-on-demand`, `subagents`, `usage-measurement`, `viewing`). An adapter that lacks one refuses the command and says which, and does not substitute a weaker path such as asking the user to run the CLI (`harness R35.1`).
- **No approval.** No contract sets a spec or plan to `approved`, or a plan to `completed` or `abandoned`, by editing a file; only the approval, finish and abandon actions do, under the role (`harness R20`).

## §2 Standing instructions

Implements `harness §2`, `harness §3`, `steering R59`.

The standing instructions are a fixed short text, the same for every harness and role. They say: Specplane is in use; read `.specplane/config.yaml` before acting on specs or plans and resolve paths from it; the LLM has a role and must look up its steering before acting (`steering R59`); do not call the Specplane CLI, use the harness actions; commits made in a Specplane workflow carry the workflow, plan, step and session trailers when set (`architecture/file-formats §8`). A harness may add a separate harness-specific part after it for invocation details such as its slash-command list; that part is not shared. The shared text contains no steering, rules or procedures, no permission modes and no secrets: those arrive with the command (`§3`). The text carries the Specplane version and the steering stamp (`§4`).

Delivery (assumption on form): an owned file in the harness's own directory when it has one, otherwise one marked block in a shared instruction file, added once and changed only between its markers (`architecture/repository-layout §5`, `architecture/reference-cli §12.6`). A project may forbid the block with `harness.install_block: off` (`architecture/file-formats §6.1`); its own instruction files are then never touched. Two harnesses share one block (`harness §3`). The block says edits inside it are overwritten. A missing or older delivery is a warning (`verification R24`).

## §3 Instruction assembly and delivery

Implements `harness R14`, `steering R22`, `steering R23`, `specifications R4`.

Each command and each permission has an **instruction text**. A text is assembled when needed, in this order:

1. The command's contract (`§1`), or for a permission its limit text (`§4`).
2. The command's documentation, which is the default instruction (`steering R22`); `harness.instructions.<command>` replaces the documentation part only (`architecture/file-formats §6`). The contract's `[code]` steps and the checks of `architecture/reference-cli §7.3` stay whatever the replacement says (`harness R14`).
3. Steering for the command and the permissions it uses (`§4`).
4. The optional separation check when the command writes specs and `harness.separation_check` is on: the LLM verifies that feature and architecture content is separated and warns per change (`specifications R4`, `harness R14`).

**When it is sent.** Via `deliver(session, key)` (`architecture/reference-cli §12.3`): on the first use of a command in a session, never twice in one compaction epoch, again after a reported compaction, and always again when the adapter cannot report its context. A harness that loads instructions on demand gets a pointer to the packaged contract instead of the text, with the same effect (`harness R14`). If the adapter cannot deliver at the command, it delivers at session start and prints a notice that it did (`harness R35.1`).

**AI-facing documentation.** `build-ai-docs` derives it from the user documentation, so the two cannot disagree (`steering R23`). The always-loaded part is the orientation, the role and limits, and the steering of commands in use, under a size limit tested in the build. Everything else is searched through `docs.search`. The essentials reach the model in two ways: the adapter sends them at session start and after a reported compaction (Claude Code: the `SessionStart` hook runs `docs essentials`), and the standing text tells the LLM to load them with the `docs.essentials` action when it did not receive them (a harness without a session-start hook, such as Codex today, relies on that line). `docs.search` and `docs.essentials` need no permission. The standing instructions and each contract tell the LLM that more documentation exists and to search it, not guess, when it lacks information (`steering R23`).

## §4 Steering assembly

Implements `steering R59`, `steering R59.1`, `steering R51`, `specifications R65`.

Steering is generated, never written by the model (`architecture/reference-cli §12.4`). Inputs: the acting role, the mode of each permission under the active preset, the command list, and the templates in `assets/steering/`. Outputs, three layers:

- **Role steering** (short, in the standing delivery of `§2`): the role, what it may do in a line each, that Specplane's checks and not steering decide, that a denial is final, no bypass by another tool, rephrased action, another role, side route or direct file edit, no CLI, keep credentials out of summaries (`steering R59`, `verification R61.3`).
- **Permission steering** (sent with the command that uses the permission): the limit in the role's mode, and the no-bypass statement (`steering R51`). The same text is the permission's documentation (`configuration R54`) and the body of a refusal reply naming the permission.
- **Case steering**, attached to commands: the five cases (below), blocking choice, spec-change check, contradiction rule.

The five cases a contract relies on, with their wording fixed in the templates:

| Mode or situation | The LLM is told to |
|---|---|
| `request-user` | send a request naming the one action, do not do it first |
| `deny` | not do it, not look for another way, tell the user, leave the move to them |
| user-run command (a person's approval) | ask the user to run it and say what it will do; the LLM's own approval follows its `spec.approve` mode (allow, request user, deny) as the rows above |
| `allow` | act directly unless custom steering says otherwise; steering does not guarantee the LLM asks first |
| blocked in a plan run | continue unblocked work with a non-blocking request, else soft stop (`§5.3`) |

Further case texts: if a plan points at an older commit of a referenced spec than the latest, check what changed first (`plan-execution R27`, `plans R28.1`); a spec the LLM writes starts awaiting-review and cannot be approved by the LLM without the approval permission: allow acts without additional confirmation, request-user waits for acceptance, and deny refuses (`roles-and-permissions R57`); specs at different layers that contradict: follow the higher layer and report it (`specifications R65`); specs at the same layer that contradict: report and do not implement the contradicted behaviour (assumption beyond the page, as `steering R59` marks it); work one plan step at a time and record gaps in the plan record (`plans R28`).

**Custom steering** comes from `steering.custom` items `{permission|command, scope, text}` (`architecture/file-formats §6`). It is appended after the generated text of the same permission or command, general before specific and each labelled, with the line "on conflict the more specific wins"; it never replaces role or permission steering and cannot widen or narrow a permission (`steering R59.1`). The complete text an LLM receives for a command or permission is shown by `specplane steering` (`steering R59.1`).

**Stamp and staleness.** Generated text and delivered files carry the stamp of `architecture/reference-cli §12.4`. When roles, presets or custom steering change, the steering and installed files are regenerated; if regeneration fails, delivery is replaced by a notice that the text cannot be trusted and a warning is raised (`steering R59`, `steering §2`). Steering and permission disagreeing is reported, and the permission wins (`steering §2`).

**Test T1 (assumption, deterministic).** For every permission kind in the default presets the generated permission steering is non-empty and contains the no-bypass statement (`steering R51`).

## §5 Permissions, requests and soft stop in contracts

Implements `requests R52`, `requests R52.3`, `requests R52.4`, `plan-execution R27.3`, `plan-execution R27.5`, `plan-execution R27.5.1`, `plan-execution R27.5.2`, `plan-execution R27.1`, `steering R59`.

### §5.1 Every action is checked

Each `[code]` step is an action whose handler calls the guard (`architecture/reference-cli §7.3`). The contract does not decide the outcome; it handles each reply:

- **Done.** Continue.
- **Request sent** (mode `request-user`). The reply says a request was stored and nothing was done. The LLM tells the user what it asked for and does not retry the action, do part of it, or go round it (`requests R52`, `requests R52.3`). In a plan run it goes to `§5.3`.
- **Refused** (mode `deny`). The reply names the permission. The LLM tells the user, and does not propose an alternative with the same effect. No request exists for a denied action (`requests R52.3`).
- **Allowed but steered to ask.** If custom steering says to send a request or ask the user first, the LLM calls `request.send` with the permission the action would need (`architecture/reference-cli §8`) and waits for the user.

The LLM has no action that accepts or declines a request, or that switches role (`architecture/reference-cli §12.1`). The request pane and dialogue belong to the user (`requests R52.1`, `requests R52.4`).

### §5.2 Requests outside a plan

A request is sent and the contract ends with an output line saying a request is pending and how to answer it in the pane. The LLM does not wait in the session (`requests R52`).

### §5.3 Requests and blocks inside a plan run

- **Blocking.** The LLM sets `blocking: true` when the next work depends on the action or building on a refused change would be waste; it prefers blocking when unsure (`steering R59`). The action soft-stops the plan with reason `waiting for request <id>`; the contract then writes the handoff entry and ends the run (`plan-execution R27.5.1`, `architecture/reference-cli §11.3`).
- **Non-blocking.** The LLM sends the request, records it in the step's handoff "Open issues" section (`architecture/file-formats §5.5`) and continues with work that does not depend on the answer without doing what was requested (`plan-execution R27.5.2`).
- **Block that is not a request** (a forbidden tool, a missing file): if other steps do not depend on it the LLM sends a non-blocking request and continues; if nothing useful remains, or the block affects the whole plan, it calls `plan.softstop` with a reason and what must change. A block is never turned into a skipped step (`plan-execution R27.3`).
- **Budget soft stop.** When the adapter reports a soft stop, the contract tells the LLM to reach a safe point, commit, write the partial handoff entry and call `plan.softstop`; the adapter ends the session by force at the hard stop (`plan-execution R27.1`, `architecture/reference-cli §11.3`).
- **No waiting.** A run never waits open for an answer; waiting is a stopped plan (`plan-execution R27.5`).

## §6 Context retrieval

Implements `harness R26`, `harness R26.1`, `harness R26.2`, `harness R21`, `harness R38`.

- **Action.** `spec.retrieve` takes one or several spec IDs and `include_references` (default `harness.retrieval_include_references`). The reply names each spec, then each cited section with its source cite, the section and its subsections only, deduplicated; an unresolved cite is returned as `not found`; effectively awaiting-review specs and parts are marked; text comes from the working tree and status from HEAD, with a note when they differ (`architecture/reference-cli §12.5`).
- **Use by contracts.** Every contract that touches a spec starts with one `spec.retrieve` per working set instead of reading referenced files, and reads a file directly only for a part retrieval did not return. `plan-step` retrieves the step's `context` cites; `spec-assist` and `spec-draft-architecture` retrieve the spec and the cited higher-layer parts (`§7`).
- **Permission.** `info.retrieve`, mode allow by default; a role with deny is told so and the contract stops (`harness R26.2`). Retrieval does not depend on the permission to edit, so a role that cannot write a spec still reads it.
- **Other reads.** `spec.review-context` returns a spec with its coverage, warnings and recorded results for review; `warnings`, `coverage` and `audit.read` are read-only actions under the same permission (`architecture/reference-cli §12.1`).
- **Viewing.** `spec-view` (`harness R21`, `§7.9`) is a user-only command with no model. It reads through the same retrieval and status routines, not an LLM action, and needs the adapter's `viewing` capability.
- **Spec review.** Spec review (`harness R38`, command `spec-review`, `§7.12`) is a contract that uses `spec.retrieve` and `spec.review-context`. Review is read-only: feedback goes to the user in conversation, and a change that follows is a separate edit under `harness R19.2`. When decision records are on the LLM may store the user's decision (`§7.11`) under the decision permissions (`later-releases R37.1`).

## §7 Command contracts

Implements `harness R19`, `harness R19.1`, `harness R19.2`, `harness R20`, `harness R20.1`, `plan-execution R31`, `plan-execution R27`, `plan-execution R27.2`, `plan-execution R27.4`, `plan-execution R27.6`, `plan-execution §2`, `plan-execution §3`, `plans §3.2`, `specifications R67`, `verification R36.1`, `verification R61.2`, `verification R61.3`, `later-releases R37`, `later-releases R37.1`, `later-releases R66`. Command names are those installed for Claude Code (`harness R18`); another harness may spell them differently but keeps the contract. A command marked "user only" is run by the person and is never offered to the LLM.

### §7.1 spec-assist

Purpose: write or edit a feature or architecture spec with the user (`harness R19`). Preconditions: config read; `spec.create.<type>` or `spec.edit.<type>` for the spec's type is not `deny` (`harness R19.2`).

1. `[code]` `config.get`; `spec.retrieve` of the spec being changed (if any) with its cited parts, and of related specs the user names.
2. `[llm]` Discuss and refine the content with the user until they finalise it. Apply the separation check (`§3`). Do not invent requirements; ask.
3. `[code]` `spec.create` (new spec, ID from the path, cites in `covers` or `implements`) or `spec.edit` (section or whole file). Under request-user the edit becomes a request holding a patch and nothing is written; the LLM stops at `§5.1` (`harness R19.2`).
4. `[code]` The action appends the LLM as author with a contribution at the granularity of the change when `authorship.record_llm` is on, using the model the adapter reports (`harness R19.1`, `specifications R10`). It rejects any `approved` status or `approval` block in supplied text (`architecture/reference-cli §12.1`).
5. `[code]` `validate` scoped to the spec; report its findings.

Output: what changed, that the spec is awaiting-review, and that approval is a separate action under the approving actor's permission (`specifications R11.3`, `harness R20`).

### §7.2 spec-draft-architecture

Purpose: generate an architecture spec from feature specs, or a feature spec from requirements (`specifications R67`). Preconditions: the source specs exist; the create permission is not `deny`; the sources need not be approved, and the output says when they are not.

1. `[code]` `spec.retrieve` of the sources with referenced parts.
2. `[llm]` Draft the spec: topics, not feature sections; each section cites the source parts it implements in its frontmatter and states them in the body; unclear or contradictory source parts are listed as questions for the user, not decided; detail the sources leave open is marked "assumption".
3. `[code]` `spec.create` as in `§7.1` step 3 to 5.
4. `[llm]` Report coverage of the sources: `coverage` shows source parts nothing covers (`verification R64`).

Output: the new spec, its source cites, uncovered source parts, open questions. The draft is awaiting-review with the LLM as author; it may be a plan step (`plans R30.1`).

### §7.3 plan-create

Purpose: create a plan, optionally (`plans R69`). Preconditions: `plan.create` not `deny`.

1. `[code]` `config.get`; `spec.retrieve` of the specs the user names and those they cite.
2. `[llm]` Propose goal, acceptance criteria, ordered steps (small enough for one session, `plans §3.2`), the specs each step implements, referenced plans and context cites. Show the proposal to the user as text and adjust.
3. `[code]` `plan.create` writes the folder from the template: ID from today's date and two to four words, no status (a plan starts with no approval record), empty progress `not-started`, step files (`architecture/reference-cli §11.5`).
4. `[code]` `validate` scoped to the plan.

Output: plan ID and path, steps, that nothing runs and that the plan is approved like a spec (`plan-execution R31`). `plan.edit` is the same flow for later changes, refused for a step that has started (`architecture/reference-cli §11.5`).

### §7.4 plan-start

Purpose: start a plan in its own worktree and branch (`plan-execution R27`, `plan-execution R27.6`). Preconditions: `plan.start` not `deny`; the plan and the specs it implements and references approved when `plans.start_conditions` is on. Wholly `[code]`:

1. `plan.start` with the target (user's, else current branch) and any named dependencies to force, which the handoff records (`architecture/reference-cli §11.3`).
2. On refusal print each unapproved plan or spec, or the missing permission.

Output: the plan ID, branch `plan/<id>`, the worktree path (`architecture/repository-layout §3`), and that the harness integration launched the plan's session in the worktree through its session adapter (`plan-execution R27`, `harness R35.1`; Claude Code: the `claude -p` route of the existing session adapter design; Codex: `codex exec`). Only when the adapter reports the capability `session opening` unavailable is the exact command that opens a session there printed instead, shown as an error naming why the session was not launched. The project directory stays on its branch. The `plan.start` action behaves the same when the LLM calls it: when the MCP server was started with an adapter (`SPECPLANE_ADAPTER`, `architecture/reference-cli §12.1`) it opens the session through that adapter and returns its ID; without one it only starts the plan and says that no session was opened. A refused launch is a failed result that names the plan's already-started state and the manual command.

### §7.5 plan-step

Purpose: do the next step, or several, of one plan, in its checkout (`plan-execution R27`, `plan-execution R27.4`). Preconditions: the session is in the plan's worktree on `plan/<id>`, which the plan session launched by the harness integration (`§7.4`) guarantees; if it is elsewhere the command names the checkout and stops (assumption beyond `plan-execution R27`). Typed with no arguments, the command makes no LLM call (`harness R18`): it shows the plan's next step and how to run it, and a step is run by the launched plan session or by the command with arguments; `plan.next` reports a ready step (a waiting step names the unapproved spec it needs and the run stops with a soft stop, `plans R30.1`); the selection starts at the next step.

1. `[code]` `plan.next` for the selection; a selection starting later is denied naming the step that comes first. If the plan is `stopped`, resume first (`§7.9`).
2. `[code]` `spec.retrieve` of the step's `context` cites and `implements` specs, and the earlier handoff entries. If a referenced spec changed since the plan's recorded commit, the LLM checks what changed before going on (`§4`).
3. `[llm]` Implement the tasks, one step only (parallel task groups follow `§7.11`, parallelism), never needing the user: a gap or assumption goes to `spec-gaps.md` as a new entry (`architecture/file-formats §5.6`), a needed spec change goes through `spec.edit` under its permission, a missing thing becomes a request or soft stop (`§5.3`). Precedence: requirements over features over architecture; contradictions across layers follow the higher layer and are reported, same-layer contradictions stop the step (`steering R59`).
4. `[code]` Declared tests of the step run with `test.run`, results with `test.record` (`§7.8`).
5. `[llm]` Write the handoff entry sections (`architecture/file-formats §5.5`), with the outcome `done` or `partial`.
6. `[code]` `plan.step-done` with the outcome: requires the handoff entry and a commit since the step began, makes an entry-only commit if there is none, advances progress and commits it (`architecture/reference-cli §11.3`, `architecture/file-formats §8`). A stopped partial step commits partial work and entry (`plan-execution R27.4`). Where a harness records the step itself, the LLM does not call this action.
7. `[code]` If more steps are selected, repeat from 1; stop on a soft stop or a blocking request.

Output: outcome, files changed, gaps by ID, open issues, requests sent, next step. After the last step the contract opens the final review through `§7.6` rather than completing the plan (`plan-execution §2`).

### §7.6 plan-finish

Purpose: the final review and decision (`plan-execution §2`, `plans R28`, `plans R28.1`). Preconditions: `plan.review` is read-only and always allowed; the decision needs `plan.complete`.

1. `[code]` `plan.review`: per-step outcomes, open gaps, unrun steps, pending requests of the plan, referenced specs changed on the target since the start, plan-branch spec changes (`architecture/reference-cli §11.6`).
2. `[llm]` For each acceptance criterion state met or not met with the evidence. Do not decide.
3. Show the user the review. The decision is the user's: `plan.finish` with `--complete` or `--back <reason>` under `plan.complete`. With request-user the decision is a request; with deny the LLM stops after the review (`§5.1`).
4. `[code]` On complete: archive the plan in the plan branch's last commit. On back: set in-progress with the reason; the LLM proposes added or changed steps through `plan.edit`.
5. Merging is separate: the LLM offers the `plan.merge` action (guarded by `plan.complete`) as a pull request or local merge, and never resolves conflicts; they are shown to the user (`plan-execution §2`, `architecture/reference-cli §11.6`). If the target moved since the review began, the review is shown again first.

Output: the review, the decision or the pending request, and the merge options.

### §7.7 plan-status

Wholly `[code]`, no model turn when typed without arguments. `plan.list` with live status reads each running plan's checkout; a run marker with no live session is shown as stopped, "session ended unexpectedly" (`architecture/reference-cli §11.2`). Output: each plan with status, stop reason, next step and what is waiting (a spec to approve, a request to answer).

### §7.8 validate and verify

**validate** (`verification R12`): `[code]` `validate`, then `warnings` and `coverage`; `[llm]` summarise findings by severity and name the fix for each; the LLM never edits to silence a finding without the user's say. Without arguments the harness prints the CLI output and starts no model turn.

**verify** (assumption: command name `verify`; implements `verification R36.1`): judges an architecture spec against its implementation.

1. `[code]` `spec.review-context` for the spec; the declared tests and which sections declare none.
2. `[code]` `test.run` for each declared test; run on committed state with a note when the tree is dirty (`verification R36.2`).
3. `[llm]` For each section declaring none, or declaring intelligent judgement, read the section and the implementation and decide met or not, with reasons of a few lines, keeping credentials and private data out of the summary (`verification R61.3`, `steering R59`).
4. `[code]` `test.record` for each result: allow records; request-user records after the user accepts, and records nothing if the commit or content changed meanwhile; deny shows the outcome as not recorded (`verification R61.2`). Result belongs to the checked spec (`verification R61.1`).
5. `[code]` When all pass and the permission and `architecture.llm_may_mark_implemented` allow, `spec.implement` (`verification R36`); a failed result refuses it, naming the test.

Output: per-section result, what was recorded, and the implemented status.

### §7.9 approve and request handling

**approve** (user only, no model, `cli R16`, `harness R20`): the user runs it with one or more IDs; the adapter runs the user-command runner as `standard-user` (`architecture/reference-cli §12.2`) which applies the checks of `architecture/reference-cli §5.3`, including group approval with the listed warning and confirmation. The command never interprets words. When the user asks the LLM in words to approve, the LLM identifies the spec, then calls `spec.approve` under its own permission: allow approves, request-user sends a request, deny refuses (`harness R20`, `harness R20.1`, `cli R16.1`). The contract states that a role with allow approves without further question and that steering does not guarantee the LLM asks first (`harness R20.1`). The LLM never accepts a request and never approves by editing a file (`§1`).

**spec-view** (user only, `harness R21`, `harness R21.1`): the adapter runs the user-command runner as `standard-user`. With an ID it prints the spec's status, authors and approval, then the change since the last approval as a highlighted unified diff of the last approved text (the note's commit) against the working-tree text, then the text. A spec never approved prints no diff; a requirement file is diffed against HEAD because it has no approval record. With no ID it lists the specs and their status. It uses `info.retrieve` (`harness R26.2`) and has no permission of its own; the LLM has no viewing action.

**requests** (user only): opens the pane (`requests R52.1`, `requests R52.2`); no model. **plan resume** and **plan budget** are `[code]` actions: `plan.resume` returns the resume context (next step, handoff, answered requests; the earlier session log only after a hard stop or unexpected end, `plan-execution R27.2`) and the contract continues with `§7.5`; `plan.budget` sets `{resource, soft, hard}` and refuses an unmeasurable resource (`plan-execution R27.1`, `plan-execution R27.1.1`, `plan-execution R27.2.1`).

### §7.10 plan-abandon

Purpose: end a plan that will not be done (`plan-execution §3`). Preconditions: `plan.abandon` not `deny`. Steps: `[code]` show the plan, its run state and the worktree status, and ask the user to confirm; `plan.abandon` stops the run, archives the plan as abandoned and removes the worktree unless it has uncommitted changes, when the user chooses to force or leave it; the branch is kept (`architecture/reference-cli §11.7`). Output: the result, the kept branch, and plans that reference it and can no longer start. `plan.delete` follows the same flow under `plan.delete`.

### §7.11 Decision records and later releases

- **decision-new** (built; `later-releases R37`, only when `decisions.enabled`): `[code] decision.retrieve` for the topic, `[llm]` writes the title, decision, context, reasons and concerns from the user's description or the decision the user has just made (it asks when the user has not yet decided, and never records its own suggestion), `[code] decision.add`. The contract is `assets/commands/decision-new.md`; steering covers `decision.retrieve` and `decision.add`. The LLM also retrieves matching records before a related choice through `decision.retrieve` and says when one applies. Permissions are in `later-releases R37.1`. With decisions off nothing is stored or searched.
- **migrate** (built; `later-releases R66`): the prompt is a configurable instruction (`harness R14`): the contract `assets/commands/migrate.md` plus the command documentation, replaceable through `harness.instructions.migrate`; the separation check applies because the command writes specifications. It is a different command from `specplane migrate status` (reference-cli section 5.7), which moves legacy approval frontmatter into the notes store and is not a harness action. Preconditions: configuration present; when every `spec.create.*` permission is deny the LLM proposes and tells the user what to create, and under request-user it sends requests. Steps: `[code] config.get`, `[code] info.retrieve` to list existing specs (this is how a later run recognises earlier output; `spec.create` never overwrites), `[llm]` read the named sources, show findings and the proposal, ask when unsure, `[code] spec.create.<layer>` for each (new specs are Awaiting Review whatever the old status, because status lives in the notes store and no approval is written), `[code] decision.add` only when decisions are on and the user chose to keep an old record. Steering covers `info.retrieve`, `spec.create.requirement|feature|architecture` and `decision.add`. Output lists migrated, left and uncertain items. Claude Code installs `/migrate` (model-invocable skill) and Codex a contract; with no arguments the typed command asks what to migrate from and starts no model turn.
- **parallelism** (built; `plan-execution R31.2`): `plan.next` returns the next step's `tasks` (groups of `[parallel]` tasks, `concurrency`, a `note`). The plan-step contract (`§7.5`) tells the LLM to run each parallel group through subagents, at most `concurrency` at a time, each with only its own task, and to run everything else itself in order; subagents never write the handoff, the progress or call `plan.*` actions, and the session records the step once. Without subagents, or with the setting at one, tasks run one after another and the user is told the `note` (`architecture/reference-cli §11.5.1`).

### §7.12 spec-review

Implements `harness R38`, `harness R38.1`. Purpose: review specifications read-only and discuss the result. Preconditions: configuration at HEAD and `info.retrieve` not deny; edit permissions are not needed. Steps: `[code] config.get`; `[code] spec.list` when no ID was named or `all`; `[code] spec.retrieve` for the working set with its cited parts, then `spec.review-context`; `[llm]` review (problems and gaps in feature and architecture specifications, numbered questions for the user on requirement files, grammar, wording and unclear instructions everywhere, each with its section and a suggested wording); `[llm]` discuss; `[code] decision.retrieve` and `decision.add` only when `decisions.enabled` and the user states a decision (`§7.11`). The contract is `assets/commands/spec-review.md`; steering covers `info.retrieve`, `decision.retrieve` and `decision.add` and never a spec write or approval permission. The separation check, when on, adds a review variant that asks for layer mixing to be reported as a finding. No action, permission or record is added: review state is not stored, because `harness R38` makes review read-only. Claude Code installs `/spec-review` (model-invocable skill) and Codex a contract; with no arguments the typed command asks which specs to review and starts no model turn.

## §8 Keeping the LLM off the CLI

Implements `harness R47`.

Contracts name only harness actions, never `specplane` commands, and the standing instructions say not to call the CLI (`§2`). Enforcement is the adapter's shell hook (`architecture/reference-cli §12.7`); a harness without one says so at setup (`harness R35.1`). When an action is missing for something the LLM needs, the contract tells the user to run the human command, and that is a gap to fix, not a pattern.

## §9 Keeping contracts in step with specs

Implements `harness R34`, `harness R35.1`.

- Every contract is a package asset and carries a version header; the installed copy is compared with the CLI's by validation, and an older or missing copy is a warning (`architecture/reference-cli §12.6`).
- A change to a contract that alters preconditions, order of steps or permissions is a change to this spec first; the templates are then regenerated, and the harness copies are rewritten by setup. Contracts and steering are never hand-edited in a project.
- Harness specifications may add invocation detail and must cite the contract section they package; they must not remove or reorder a step (`harness R34`).
- The user documentation lists, for each harness, which commands and capabilities it supports (`steering R22`, `harness R35.1`).
