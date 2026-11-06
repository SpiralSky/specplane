import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { checkFreshness } from "../commands/validate.js";
import { loadConfig } from "../config.js";
import { checkGuidance } from "../docs/freshness.js";
import { ConfigError } from "../errors.js";
import { checkStanding, decisionFramingLine, standingText, upsertBlock, withDecisionFraming } from "./standing.js";

const FRAMING = "what changes for the people using the product";
const LINE = decisionFramingLine(FRAMING);
const RULES = ".claude/rules/specplane.md";

function repo(t: { after: (fn: () => void) => void }, framing?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".specplane"));
  if (framing) setFraming(root, framing);
  return root;
}
const setFraming = (root: string, framing: string) =>
  fs.writeFileSync(path.join(root, ".specplane/config.yaml"), `agent:\n  decision_framing: ${JSON.stringify(framing)}\n`);
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const stale = (root: string) => checkFreshness(root).warnings;

test("the line holds the agreed text and sits after the Workflows line", () => {
  assert.equal(LINE, `- **Decisions**: When you need a decision from the user, frame it in terms of ${FRAMING}: what changes, the tradeoff, and your recommendation. This does not change who approves specs, plans or decisions.`);
  const lines = standingText(FRAMING).split("\n");
  assert.equal(lines.at(-1), LINE);
  assert.match(lines.at(-2)!, /^- \*\*Workflows\*\*: /);
});

test("unset framing leaves the text as it was, and text without a Workflows line is unchanged", () => {
  assert.equal(standingText(null), standingText());
  assert.doesNotMatch(standingText(), /\*\*Decisions\*\*/);
  assert.equal(withDecisionFraming("# Other\n", FRAMING), "# Other\n");
});

test("framing text with replacement patterns is inserted literally", () => {
  assert.ok(standingText("cost in $& and $1").includes("in terms of cost in $& and $1:"));
});

test("a block is current only for the framing it was written with", () => {
  const { content } = upsertBlock(null, undefined, FRAMING);
  assert.equal(checkStanding(content, FRAMING), "ok");
  assert.equal(checkStanding(content), "outdated");
  assert.equal(upsertBlock(content, undefined, FRAMING).action, "unchanged");
  assert.equal(upsertBlock(content).action, "updated");
});

test("init writes the line to AGENTS.md and the Claude rules file, and validate accepts both", (t) => {
  const root = repo(t, FRAMING);
  runInit(root, { harness: "claude" });
  assert.ok(read(root, "AGENTS.md").includes(LINE));
  assert.ok(read(root, RULES).includes(LINE));
  assert.deepEqual(stale(root), []);
  assert.ok(checkGuidance(root).every((a) => a.state === "current"), JSON.stringify(checkGuidance(root)));
});

test("changing the framing makes validate report stale text until init runs again", (t) => {
  const root = repo(t, FRAMING);
  runInit(root, { harness: "claude" });
  setFraming(root, "cost to the team");
  assert.notDeepEqual(stale(root), []);
  runInit(root, { harness: "claude" });
  assert.deepEqual(stale(root), []);
  assert.ok(read(root, RULES).includes(decisionFramingLine("cost to the team")));
  assert.ok(!read(root, RULES).includes(LINE));
});

test("without the key, init writes no line and validate stays clean", (t) => {
  const root = repo(t);
  runInit(root, { harness: "claude" });
  assert.ok(!read(root, "AGENTS.md").includes("**Decisions**"));
  assert.ok(!read(root, RULES).includes("**Decisions**"));
  assert.deepEqual(stale(root), []);
});

test("the key defaults to null and refuses multi-line or blank text", (t) => {
  const root = repo(t);
  assert.equal(loadConfig(root, { checkSpecRoots: false }).config.agent.decision_framing, null);
  for (const bad of ["a\nb", "   ", ""]) {
    setFraming(root, bad);
    assert.throws(() => loadConfig(root, { checkSpecRoots: false }), ConfigError);
  }
});
