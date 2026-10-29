import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { checkAllPins, pinSpec } from "../commands/spec-pin.js";
import { runValidate } from "../commands/validate.js";
import { loadConfig } from "../config.js";
import { CONFIG, makeRepo, spec } from "../test-repo.js";
import { normalisedHash, writePins } from "./pins.js";
import { checkSkillDrift } from "./skill-drift.js";

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" }).trim();
const commit = (root: string, msg = "c") => {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", msg);
};
const fm = (id: string, extra: Record<string, unknown> = {}, body = "# T\n\n## Real section\n") =>
  spec({ id, title: "T", status: "approved", author: "user", ...extra }, body);
const config = (pinBases: string) => CONFIG.replace("specs:\n", `specs:\n  pin_bases: ${pinBases}\n`);

/** Committed repo: base `feature/alpha`, overlay `feature/beta` extending it (optionally pinned). */
function repo(opts: { pinBases?: string; overlay?: Record<string, unknown>; extra?: Record<string, string> } = {}) {
  const root = makeRepo({
    ".specplane/config.yaml": config(opts.pinBases ?? "warn"),
    "specs/features/alpha.md": fm("feature/alpha"),
    "ext-specs/features/beta.md": fm("feature/beta", { extends: "feature/alpha", ...opts.overlay }),
    ...opts.extra,
  });
  git(root, "init", "-q", "-b", "main");
  commit(root);
  return root;
}
const blob = (root: string, p: string) => git(root, "rev-parse", "--short=7", `HEAD:${p}`);
const types = (root: string) => {
  const r = runValidate(root);
  return [...r.errors, ...r.warnings].filter((f) => f.type !== "freshness").map((f) => `${f.severity}:${f.type}`);
};
const load = (root: string) => loadConfig(root).config;

test("normalisedHash ignores frontmatter status and author only", () => {
  const a = "---\nid: x\nstatus: draft\nauthor: user\n---\n# T\nstatus: keep\n";
  assert.equal(normalisedHash(a), normalisedHash(a.replace("status: draft", "status: approved").replace("author: user", "author: llm")));
  assert.notEqual(normalisedHash(a), normalisedHash(a.replace("# T", "# U")));
  assert.notEqual(normalisedHash(a), normalisedHash(a.replace("status: keep", "status: other")));
});

test("current pin: no findings; body change: base-changed with message", () => {
  const root = repo();
  const pin = blob(root, "specs/features/alpha.md");
  fs.writeFileSync(path.join(root, "ext-specs/features/beta.md"), fm("feature/beta", { extends: "feature/alpha", based_on: { "feature/alpha": pin } }));
  commit(root);
  assert.deepEqual(types(root), []);
  fs.appendFileSync(path.join(root, "specs/features/alpha.md"), "\nMore text.\n");
  commit(root);
  const w = runValidate(root).warnings.find((f) => f.type === "base-changed")!;
  const now = blob(root, "specs/features/alpha.md");
  assert.equal(w.message, `\`ext:feature/beta\` was reviewed against an older \`feature/alpha\`; review \`git diff ${pin} ${now}\` then run \`specplane spec pin ext:feature/beta\`.`);
  assert.equal(checkAllPins(load(root), root).failed, true);
});

test("frontmatter-only status/author change is not a base change", () => {
  const root = repo();
  const pin = blob(root, "specs/features/alpha.md");
  fs.writeFileSync(path.join(root, "ext-specs/features/beta.md"), fm("feature/beta", { extends: "feature/alpha", based_on: { "feature/alpha": pin } }));
  commit(root);
  fs.writeFileSync(path.join(root, "specs/features/alpha.md"), fm("feature/alpha", { status: "review", author: "mixed" }));
  commit(root);
  assert.deepEqual(types(root), []);
  assert.equal(checkAllPins(load(root), root).failed, false);
});

test("pinned blob missing from the object store: still fires, says diff unavailable", () => {
  const root = repo({ overlay: { based_on: { "feature/alpha": "abcdef1" } } });
  const w = runValidate(root).warnings.find((f) => f.type === "base-changed")!;
  assert.match(w.message, /\(diff unavailable: `abcdef1` is not in the local object store\)\.$/);
});

test("approved spec with a stale pin is an error, also under pin_bases off", () => {
  for (const mode of ["warn", "off"]) {
    const root = repo({ pinBases: mode, overlay: { based_on: { "feature/alpha": "abcdef1" } } });
    const r = runValidate(root);
    assert.ok(r.errors.some((e) => e.type === "base-changed" && e.message.startsWith("Cannot approve `ext:feature/beta`: base `feature/alpha` changed")), mode);
  }
  const draft = repo({ overlay: { status: "draft", based_on: { "feature/alpha": "abcdef1" } } });
  assert.equal(runValidate(draft).errors.length, 0);
});

test("missing pins follow specs.pin_bases", () => {
  assert.deepEqual(types(repo({ pinBases: "off" })), []);
  assert.deepEqual(types(repo({ pinBases: "warn" })), ["warning:pin"]);
  assert.deepEqual(types(repo({ pinBases: "require" })), ["error:pin"]);
  const impl = (mode: string) => repo({ pinBases: mode, extra: { "ext-specs/architecture/gamma.md": fm("architecture/gamma", { implements: ["feature/alpha"] }) } });
  assert.deepEqual(types(impl("warn")), ["warning:pin"]); // only the extends spec
  assert.deepEqual(types(impl("require")).sort(), ["error:pin", "error:pin"]);
  assert.equal(checkAllPins(load(impl("warn")), impl("warn")).failed, false);
});

test("based_on key not in extends/implements is an error; qualified keys match", () => {
  const bad = repo({ overlay: { based_on: { "feature/zzz": "abcdef1" } } });
  assert.ok(runValidate(bad).errors.some((e) => e.type === "pin" && /not listed in `extends` or `implements`/.test(e.message)));
  const root = repo();
  const pin = blob(root, "specs/features/alpha.md");
  fs.writeFileSync(path.join(root, "ext-specs/features/beta.md"), fm("feature/beta", { extends: "feature/alpha", based_on: { "base:feature/alpha": pin } }));
  commit(root);
  assert.deepEqual(types(root), []);
});

test("body anchors: unmatched slug warns; prose form and code fences are not checked", () => {
  const body = "# T\n\nSee feature/alpha#real-section and feature/alpha#renamed.\nProse: feature/alpha § Nothing.\n\n```\nfeature/alpha#in-fence\n```\n";
  const root = repo({ pinBases: "off", extra: { "ext-specs/features/gamma.md": fm("feature/gamma", {}, body) } });
  const a = runValidate(root).warnings.filter((w) => w.type === "anchor");
  assert.equal(a.length, 1);
  assert.equal(a[0].message, "`feature/alpha#renamed` does not match a heading in `feature/alpha`.");
});

test("writePins: only based_on changes; insertion after extends; round trip", () => {
  const root = repo();
  const file = path.join(root, "ext-specs/features/beta.md");
  const before = fs.readFileSync(file, "utf8");
  const lines = before.split("\n");
  writePins(file, { "feature/alpha": "abcdef1" });
  const after = fs.readFileSync(file, "utf8").split("\n");
  const i = after.findIndex((l) => l.startsWith("based_on"));
  assert.equal(i, after.findIndex((l) => l.startsWith("extends")) + 1);
  assert.deepEqual(after.filter((_, j) => j !== i), lines);
  writePins(file, { "feature/alpha": "1234567", "base:feature/x": "7654321" });
  assert.deepEqual(fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("based_on")), lines);
  assert.match(fs.readFileSync(file, "utf8"), /based_on: \{ feature\/alpha: "1234567", "base:feature\/x": "7654321" \}/);
  writePins(file, {});
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("spec pin writes pins, prints lines, validate is then clean; refuses uncommitted base", () => {
  const root = repo();
  const cfg = load(root);
  const lines = pinSpec(cfg, root, "ext:feature/beta", []);
  const pin = blob(root, "specs/features/alpha.md");
  assert.deepEqual(lines, [`pinned feature/alpha ${pin}`]);
  commit(root);
  assert.deepEqual(types(root), []);
  fs.appendFileSync(path.join(root, "specs/features/alpha.md"), "\nEdit.\n");
  assert.throws(() => pinSpec(cfg, root, "ext:feature/beta", []), /Commit or stash changes to `specs\/features\/alpha.md` first\./);
  assert.throws(() => pinSpec(cfg, root, "ext:feature/beta", ["feature/nope"]), /is not extended or implemented by/);
  assert.throws(() => pinSpec(cfg, root, "feature/missing", []), /not found/);
  commit(root);
  assert.equal(checkAllPins(cfg, root).failed, true);
  pinSpec(cfg, root, "ext:feature/beta", ["feature/alpha"]);
  commit(root);
  assert.equal(checkAllPins(cfg, root).failed, false);
});

test("skill drift: stale pin, unresolved anchor, missing comment", () => {
  const root = repo({ extra: { "specs/architecture/agent-skills.md": fm("architecture/agent-skills", {}, "# A\n\n## Plan step\n") } });
  const pin = blob(root, "specs/architecture/agent-skills.md");
  const skill = (name: string, comment: string) => {
    fs.mkdirSync(path.join(root, ".claude/skills", name), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude/skills", name, "SKILL.md"), `---\nname: ${name}\n---\n${comment}\n# ${name}\n`);
  };
  skill("good", `<!-- specplane-contract: architecture/agent-skills#plan-step@${pin} -->`);
  skill("stale", "<!-- specplane-contract: architecture/agent-skills#plan-step@abcdef1 -->");
  skill("anchor", `<!-- specplane-contract: architecture/agent-skills#gone@${pin} -->`);
  skill("none", "");
  const found = checkSkillDrift(load(root), root);
  assert.deepEqual(found.map((f) => `${f.type}/${f.severity}/${f.file}`), [
    "skill-drift/warning/.claude/skills/anchor/SKILL.md",
    "skill-drift/warning/.claude/skills/none/SKILL.md",
    "skill-drift/warning/.claude/skills/stale/SKILL.md",
  ]);
  assert.match(found[0].message, /contract anchor `architecture\/agent-skills#gone` does not match a heading/);
  assert.match(found[1].message, /has no `specplane-contract` comment/);
  assert.match(found[2].message, /pinned at `abcdef1`, which has changed/);
});

test("skill drift: scans harness templates and registry dirs, only for installed harnesses", () => {
  const root = repo({});
  const mk = (base: string) => {
    fs.mkdirSync(path.join(root, base, "x"), { recursive: true });
    fs.writeFileSync(path.join(root, base, "x", "SKILL.md"), "---\nname: x\n---\n# x\n");
  };
  mk(".claude/skills");
  mk("harnesses/claude/templates/skills");
  const files = (reg?: Parameters<typeof checkSkillDrift>[2]) => checkSkillDrift(load(root), root, reg).map((f) => f.file);
  assert.deepEqual(files(), [".claude/skills/x/SKILL.md", "harnesses/claude/templates/skills/x/SKILL.md"]);
  assert.deepEqual(files([]), ["harnesses/claude/templates/skills/x/SKILL.md"]); // no installed harness
});
