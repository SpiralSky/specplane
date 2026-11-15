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
- **U5 (user, one batched live check at the end, after U2-U4 are committed): check the dialogue** in an interactive session: `/requests` opens it, accept works, decline works, a request created by the model during the session pops up (if U4 built it). Evidence goes to `harnesses/claude/host-evidence/2.1.322-requests-dialogue.txt`, written by the main session from what the user reports. Interactive sessions and permission prompts remain unchecked until then.
- **U6 (main session): review and close.** One `reviewer` pass over the commit range against R52.1, R52.2, R52.4 and the edited specs; fix findings; hand the specs to the user for approval (the page keeps approval with the user for LLM roles).

If U4 finds no hook, R52.4 stays partly unmet on Claude Code. That is a decision for the user, not a gap to close silently.

## Progress (main session only)

| Unit | State | Commit |
|---|---|---|
| U0 | in progress (read-only worker) | — |
| U1 | not started | — |
| U2 | not started (after U0 and U1) | — |
| U3 | in progress (step-worker) | — |
| U4 | not started | — |
| U5 | not started | — |
| U6 | not started | — |

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
