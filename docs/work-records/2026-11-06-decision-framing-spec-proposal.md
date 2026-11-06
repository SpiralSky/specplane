# Decision framing spec proposal (2026-11-06)

Built on local branch `decision-framing-20261106`. Every spec below is approved, so none is edited yet. After the reopen, apply these edits, refresh the packaged snapshots, and the one failing test (`DEFAULT_CONFIG equals the defaults table in feature/configuration`) passes.

The handoff listed five specs. `architecture/agent-skills` is a sixth: it holds the canonical standing text.

The standing-text version does not advance: with the key unset the text is unchanged.

## Feature text for the user to finalise

### `feature/configuration`

Add to the block under `## Full schema with defaults`, after `decisions`:

```yaml
# ── Agent guidance ────────────────────────────────────────────────────────────
agent:
  decision_framing: null      # how the agent frames decisions, e.g. what changes for the people using the product
```

Add under `## Key reference`, after `decisions.dir`:

> ### `agent.decision_framing`
>
> **Type**: string or null
> **Default**: `null`
>
> One line of text naming what decisions should be framed around, for example `what changes for the people using the product`. When set, `specplane init` adds it to the standing instructions, and `specplane validate` reports them as out of date until `specplane init` runs again after a change. It does not change who approves specs, plans or decisions.

### `feature/agent-integration`

In the standing instructions list under the two-part description, after item 5:

> 6. **Decisions**: when `agent.decision_framing` is set, how to frame a decision for the user.

The sentence the agent receives:

> When you need a decision from the user, frame it in terms of {text}: what changes, the tradeoff, and your recommendation. This does not change who approves specs, plans or decisions.

## Architecture edits

### `architecture/agent-skills`, § Standing instructions, after the paragraph beginning `The shared AGENTS.md block always uses`

> When `agent.decision_framing` is set, this line follows the Workflows line in the block and in any harness file that carries the shared Workflows line: `- **Decisions**: When you need a decision from the user, frame it in terms of {text}: what changes, the tradeoff, and your recommendation. This does not change who approves specs, plans or decisions.` With the key unset, the text is the canonical text above.

### `architecture/file-formats`, § 7.1, after the `decisions` property

```json
"agent": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "decision_framing": { "type": ["string", "null"], "pattern": "^[^\\r\\n]*\\S[^\\r\\n]*$" }
  }
}
```

### `architecture/reference-cli`, § Standing instructions

Before:

> Its freshness check is a byte-compare with the bundled template; a difference is a `freshness` warning with the same message.

After:

> Its freshness check compares it with the bundled template plus any `agent.decision_framing` line; a difference is a `freshness` warning with the same message. `standingText`, `upsertBlock` and `checkStanding` take the configured framing, so a block written for another value is out of date.

### `claude:architecture/claude-integration`, § Standing instructions

Add after the fenced example:

> When `agent.decision_framing` is set, the installed file also carries the Decisions line from `architecture/agent-skills`, so it differs from the template by that line alone.
