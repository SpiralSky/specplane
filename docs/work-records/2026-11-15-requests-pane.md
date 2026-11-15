# Requests pane and dialogue (R52.1, R52.4) — approach and handoffs

Created 2026-11-15. Owner of the record: the main session (Opus 5.5). Workers do not edit the "Progress" or "Session handoffs" sections.

## Objective

In Claude Code, a person can open an interactive requests view and accept or decline a pending request as themselves (R52.1), and a request sent in an active session opens a dialogue showing the diff from the last approved spec in git-diff style (R52.4). The page's wording is authoritative; do not change it.

Observed 2026-11-15 (live, plugin loaded via `--plugin-dir`): `/requests` prints a static text list (`specplane: <id> <state> <role> <action> <reason>`, `0 warnings`) and opens nothing. Without the plugin, `/specplane-requests` is only a skill, so its text reaches the model, which says it cannot accept. Cause for the first: `harnesses/claude/plugin/hooks/commands.ts` `dispatch` runs `harness run --adapter claude requests` and returns its stdout.

## Approach chosen

**Level 1, methods considered**

| Method | Verdict |
|---|---|
| A. `$.ui.ask` (the engine's own AskUserQuestion dialog) from the `/requests` command hook | **Adopt first.** No rendering code; the question text can carry the summary and diff; options Accept / Decline / Skip. |
| B. Custom pane: `$.ui.open` plus a `ui.render` hook for `{component: "Pane"}` | **Defer.** Full control (green/red diff colours) but a React render path, layout rules (placed from 110 columns when asked), and no precedent in this plugin. Reopen if A cannot show a spec diff readably or the user wants a persistent pane. |
| C. Keep the text list, improve it | **Reject.** Does not meet R52.1. |

**Level 2, what selects the method.** The host's type declarations (`~/.claude/dev-mods/*/specplane/.claude-plugin/types/claude-code/index.d.ts`, written by 2.1.312; host is 2.1.322) are the primary evidence for what a plugin may do; no published comparison of plugin UI routes exists, so external research would not discriminate. What would change the choice are three host facts only a run can show. They are the first thing the work checks, cheapest first:

1. Does `$.ui.ask` work when called from a `command.run` hook, and does the dialog return before the hook's turn ends? (The declaration says it rejects in a `-p` run and when dismissed.)
2. Does `requests accept <id>` run through `bundledCore` act as the person? The `/requests` listing ran through the same path, but accept is the first write. The `!` shell route is known to carry the LLM marker, so this must be observed, not assumed.
3. Is there a hook point where a `request.send` result is visible to the plugin, so R52.4 can open the dialogue on arrival? Not yet read; it may not exist.

Not investigated beyond naming: how other Claude Code plugins present approval queues. Reason: the decision turns on this host's API, which the declarations answer. Level 3 (criteria and effort allocation) is not warranted: the choice is reversible and local to one plugin.

**Provisional.** Everything above is a decision from the declarations and one live observation, not from a measured comparison.

## Units

Run one at a time. Main session coordinates; `step-worker` (Sonnet) per unit; one `reviewer` over the whole range at the end. Every worker brief carries: the unit text, `npx tsc --noEmit -p .` in `packages/cli` before every build, then `npm test`; `sh harnesses/claude/tests/check-sync.sh`; commit conventions (`file-formats` §8, stage specific paths, trailers); a 15-line report limit. Edit templates under `harnesses/` and copy to `.claude/`, never the reverse. A failed `npm run build` leaves `dist` half-built and blocks the guard hook, so type-check first.

- **U0 (revised 2026-11-15, read-only worker, no user test).** The user prefers that work proceeds without their live test first. Answer the three host facts from code instead, and design around what cannot be known: (1) read the declarations for `ui.ask` limits when called from a `command.run` hook; (2) read how the core decides the actor (`cliActor`, `SPECPLANE_ACTOR`, the env the host passes to `process.run`) and whether `requests accept` run through `bundledCore` can count as the LLM; (3) find the hook that sees a tool result for `request.send` (this is U4's question; answer it here). Report in 15 lines with `path:line` evidence. The remaining uncertainty is handled by the design: if `ui.ask` rejects or is unavailable, `/requests` falls back to today's text list plus the line "answer with `/requests accept <id>`"; accept and decline run through the same core path as the listing.
- **U1 (worker, spec): decide and write the spec text.** Change `agent-skills` §7 and `claude-integration` §3 to say: `/requests` with no arguments opens the host's dialogue listing pending requests, each answerable Accept / Decline / Skip as the person; a request touching a spec shows the diff from last approval; the plain `specplane-requests` skill, when the plugin is absent, tells the user to load the plugin and starts no model work. Show proposed text as a diff first per the draft-as-diff rule; the spec is not approved by the worker. One separate review before approval.
- **U2 (worker, code): `/requests` dialogue (method A).** In `harnesses/claude/plugin/hooks/commands.ts` and `handlers.ts`, keep `dispatch` host-independent: add a port for asking (`ask(question, options)`), a function that turns the core's pending-request listing into questions, and the accept/decline call through `CorePort`. Check first whether `requests list` has a machine-readable form (`--json`); if not, add one in `packages/cli/src/commands/requests.ts` rather than parsing the text. Tests in the Bun suite for the pure parts (`claude-plugin-commands.test.ts`). `/requests accept <id>` and `/requests decline <id>` with arguments keep working as today.
- **U3 (worker, small): the plain skill fallback.** `harnesses/claude/templates/skills/specplane-requests/SKILL.md`: without the plugin the body must make the model say "load the plugin" and do nothing else (it currently implies an adapter pane that does not exist there). Copy to `.claude/`, run check-sync. Same unit: add to the `plan-step` contract that `plan.step-done` is called before the commit, because the pre-commit hook rejected two commits in live check 2 until it was.
- **U4 (investigate, then worker): arrival dialogue (R52.4).** Read the declarations for a hook that sees a tool result (`tool.result` or similar) for the Specplane `request.send` call and for how the plugin's session-server channel reports it. If one exists, open the same dialogue on arrival (with a spec diff from the core for spec-related requests). If none exists, write that finding in the spec as a known limitation and tell the user; do not build a polling workaround without asking.
- **U5 (main session drives the TUI itself; the user checks only afterwards if they want).** The user authorized, 2026-11-15, overriding the environment variable that marks a session as LLM-made for this purpose: the marker is not a security boundary (an LLM can edit files directly anyway). Method: `tmux` and `python3` are installed. Start a detached tmux session in `~/projects/temp/specplane-fixture` with the `SPECPLANE_*` variables stripped (`env -u` each, or a Python launcher that builds a clean environment) running `ANTHROPIC_MODEL=haiku claude --plugin-dir <repo>/packages/cli/dist/plugin`; send keys with `tmux send-keys`, read the screen with `tmux capture-pane -p`. Check: `/requests` opens the dialogue, Accept and Decline act as the person (audit/request state, not the model's say-so), and the fixture's pending request is answered. Create a fresh pending request first (a model turn asking for a `plan start`), then answer it from the dialogue. Scope of the authorization: stripping the marker variables for this fixture run only. Do not edit `.specplane/config.yaml` guard settings without the user's agreement for the session, do not commit any override, and if the guard hook blocks a command, stop and report instead of working around the hook. Evidence goes to `harnesses/claude/host-evidence/2.1.322-requests-dialogue.txt`. A launcher script that holds the run belongs in the scratchpad, not the repo. The earlier handoff warns the permission classifier may refuse `claude` on a Bash command line; if so use a Python launcher file.
- **U6 (main session): review and close.** One `reviewer` pass over the commit range against R52.1, R52.2, R52.4 and the edited specs; fix findings; hand the specs to the user for approval (the page keeps approval with the user for LLM roles).

If U4 finds no hook, R52.4 stays partly unmet on Claude Code. That is a decision for the user, not a gap to close silently.

## Progress (main session only)

| Unit | State | Commit |
|---|---|---|
| U0 | done (findings below) | — |
| U1 | done | fd4d4f0 |
| U2 | done | 3023abe |
| U3 | done | 018d665 |
| U4 | done (with U2; widened in 5bc8e3b, MCP route and answer note in 2a06663) | 3023abe, 5bc8e3b, 2a06663 |
| U5 | done by the main session through tmux; evidence file `harnesses/claude/host-evidence/2.1.322-requests-dialogue.txt` | 239b2f8, 3a3867d |
| U6 | review done (reviewer, 5 defects), fixed | c5d6427 |

U0 and U3 run first, together (U0 reads only).

## Session handoffs

Append one entry per session boundary, newest last: goal, repository state (branch, last commit), decisions made, units done with commits, test results as passed/failed/not run, open questions, next action.

### Handoff 1 — 2026-11-15 (planning only)

- Branch `spec-edits-20261106`, last commit before this record `6abb03e`. No code or spec changed; this file and a pointer in `HANDOFF.md` are the only additions.
- Facts established: the `/requests` text-only behaviour above; the host exposes `ui.ask` and `ui.open` panes; `harnesses/claude/plugin/hooks/` is the plugin source and `packages/cli/dist/plugin` is its build.
- Not established: U0's answers; whether a request-arrival hook exists.
- Next action: ask the user for the U0 result; meanwhile run U3.

### Handoff 2 — 2026-11-15 (approach revised)

- The user asked for as much work as possible before any user test. U0 became a read-only investigation; the only user step is U5, once, at the end. Insight: the interactive behaviour (`ui.ask` in an interactive session, accept running as the person) cannot be observed headless (`ui.ask` rejects in `-p`), so U5 stays a user check; U2/U4 are built defensively so a wrong guess degrades to the text list, never to a wrong action.
- Next action: collect U0 and U3 results, then U1, U2, U4, U6 in that order.

### U0 findings (read-only Sonnet worker, 2026-11-15; DTS = `packages/cli/dist/plugin/.claude-plugin/types/claude-code/index.d.ts`)

- **`$.ui.ask`** (DTS:2472-2481, AskOptions DTS:692-705): options are 2-4 labels (fewer than two are padded with Yes/No), `header` at most 12 characters, `multiSelect` returns comma-joined labels, no question-length limit declared, rejects when dismissed and in a `-p` run. Nothing forbids calling it from a `command.run` hook, and nothing says it works there: **untested**, so U2 must catch a rejection and fall back to the text list. `asUser` exists only on `$.prompt.submit`.
- **Actor of `requests accept` through `process.run`: the person, about 85% sure (inference, not run).** `handlers.ts:12` passes no `env`; the child inherits the host's environment (DTS:3722, 3827). `cliActor` (`packages/cli/src/perm/permissions.ts:199-205`) is `llm` only when `SPECPLANE_ACTOR=llm` and `bypass_guards.llm_marker` is on; `ops.ts:145` refuses only an LLM actor. The plugin sets the marker only on its session-server child. It changes if Claude Code itself is started with `SPECPLANE_ACTOR=llm` in its environment. U5 observes this directly.
- **Arrival hook (R52.4): feasible.** No `tool.result` event, but the plugin already handles `tool.call` for its own tools (`channel.ts:68-95`) and sees the reply at `channel.ts:92-94`; a hook after `forward()` can inspect it, or register `classic.PostToolUse` (DTS:1295; fields `tool_name`, `tool_input`, `tool_response`). Tool name is `mcp__specplane__<name>`. Not inspecting the reply today.
- **Machine-readable list exists:** `requests list|show|accept|decline` take `--json` (`cli.ts:121-124`); `harness run` also takes `--json` (`commands/harness.ts`), which the plugin does not pass (`commands.ts:68`). Record fields (`requests/store.ts:13-29`): `id`, `state`, `created`, `from{role,model,session}`, `permissions[]`, `action{command,params}`, `reason`, `base{branch,commit}`, `diff` (string or null), `plan`, `checkout`, `blocking`, `answer`. So the diff for a spec request is already in the record.
- Effect on units: U2 uses `--json` (no text parsing, no new CLI work) and the record's `diff`; U4 is buildable (hook after `forward()` for the request-sending action).

### Handoff 3 — 2026-11-15 (built, live-checked, reviewed; waiting on the user)

- Branch `spec-edits-20261106`, last commit `c5d6427` plus the evidence/handoff commit after it. `npm test` 669 pass / 0 fail; plugin test files under Bun 37 pass; hooks 209 pass; check-sync OK. Not pushed or merged.
- Live (tmux, Claude Code 2.1.322, Haiku, `SPECPLANE_*` stripped by the user's authorization for the fixture run only): `/requests` dialogue, Accept, Decline and Skip as the person, Esc fallback, arrival dialogue on both routes (plugin-served and `.mcp.json`-served), answer note to the model. Details and blemishes in the evidence file.
- Left as is: `test.record` holding several requests opens a dialogue only for the first (low). Not checked live: a spec-diff request and the Warning line, `-p` fallback, two requests answered in one `/requests` run. The fixture still holds two pending requests (`...071110Z-04a2`, `...072820Z-8fe1`).
- `docs/user/harnesses.md` is not yet updated to say the arrival popup needs the plugin (works with `.mcp.json` too since 2a06663) — small docs unit left.
- The user's remaining steps: approve the edited specs (`claude-integration`, `agent-skills`, and the earlier ones in `HANDOFF.md`), then merge or push; optionally decline the two fixture requests.
