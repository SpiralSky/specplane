import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { formatReport, validateProject, type Report } from "./validate.js";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { approveSpecs, reopenSpec } from "../spec/human.js";

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-validate-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  write(root, files);
  return root;
}
function write(root: string, files: Record<string, string>): void {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
}
function commit(root: string, msg = "c"): string {
  git(root, "add", "-A");
  git(root, "commit", "-qm", msg);
  return git(root, "rev-parse", "HEAD");
}
const REQ_BODY = "**R1: One**\nText\n\n**R2: Two**\nMore\n\n*R2.1: Sub*\nSub\n\nRetired IDs: `R9`.\n";
const spec = (o: { id: string; covers?: string; implements?: string; references?: string; body?: string; extra?: string }) =>
  `---\nid: ${o.id}\ntitle: T\nauthors: []\n${o.covers ? `covers: ${o.covers}\n` : ""}${o.implements ? `implements: ${o.implements}\n` : ""}references: ${o.references ?? "[]"}\n${o.extra ?? ""}---\n\n${o.body ?? "## R1: One\n\nText.\n"}`;
// A requirement file is always approved, with or without frontmatter (`file-formats` §1.2).
const REQ = spec({ id: "requirement/product-requirements", body: REQ_BODY });
const rules = (r: Report, severity?: string) => r.findings.filter((f) => !severity || f.severity === severity).map((f) => `${f.rule}:${f.message}`);

test("a clean repository with requirements and specs has no errors", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec({ id: "feature/alpha", covers: "[R1, R2]", references: "[R2.1]", body: "## R1: One\n\nSee `R2.1`.\n\n## R2: Two\n\nText.\n" }),
  });
  commit(root);
  const r = validateProject(root);
  assert.deepEqual(rules(r, "error"), []);
  assert.deepEqual(r.checked, ["feature/alpha", "requirement/product-requirements"]);
});

test("format errors: id mismatch, bad status, wrong-layer field, unknown field, missing frontmatter", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec({ id: "feature/other", implements: "[beta R1]", extra: "mystery: 1\nstatus: draft\n" }),
    "docs/specifications/features/beta.md": "# no frontmatter\n",
    "docs/specifications/architecture/gamma.md": spec({ id: "architecture/gamma", covers: "[R1]" }),
    "docs/specifications/features/INFO.md": "---\nid: feature/info\n---\n",
  });
  commit(root);
  const m = rules(validateProject(root));
  const has = (s: RegExp) => assert.ok(m.some((x) => s.test(x)), `expected ${s} in ${m.join("\n")}`);
  has(/id is "feature\/other" but the path gives feature\/alpha/);
  has(/legacy record key `status` is ignored/);
  has(/`implements` is only for architecture specs/);
  has(/`covers` is only for feature specs/);
  has(/unknown frontmatter field `mystery`/);
  has(/does not start with a `---`/);
  has(/INFO.md has frontmatter/);
});

test("cites: unresolved, missing from references, listed but unused, undeclared subproject", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec({ id: "feature/alpha", covers: "[R1]", references: "[R7, beta R5, claude:R1, R2]", body: "## R1: One\n\nCites `R2`, `beta R1`, `beta §3` and `claude:R1`.\n" }),
    "docs/specifications/features/beta.md": spec({ id: "feature/beta", covers: "[R2]", body: "## R2: Two\n\nText.\n\n## §1 Terms\n\nT.\n" }),
  });
  commit(root);
  const r = validateProject(root);
  const e = rules(r, "error");
  assert.ok(e.some((x) => /unresolved cite `R7`.*requirement not found: R7/.test(x)));
  assert.ok(e.some((x) => /unresolved cite `beta R5`.*section not found/.test(x)));
  assert.ok(e.some((x) => /unresolved cite `beta R1`/.test(x)));
  assert.ok(e.some((x) => /`beta R1` is used in the body but missing from references/.test(x)));
  assert.ok(e.some((x) => /`beta §3` is used in the body but missing from references/.test(x)));
  assert.ok(e.some((x) => /unresolved cite `claude:R1`.*subproject `claude` is not declared/.test(x)), "a subproject that is not declared is an error");
  const w = rules(r, "warning");
  assert.ok(w.some((x) => /lists `R7`, which the body never cites/.test(x)));
});

const SUB_CONFIG = "subprojects:\n  - {name: claude, path: sub/claude}\n  - {name: codex, path: sub/codex}\n";
const SUB_REQ = "**R1: Sub one**\nSub text\n\n**R2: Own**\nOwn text\n";

test("subprojects: cites resolve by project name, plain cites mean the own project, findings name the project", () => {
  const root = repo({
    ".specplane/config.yaml": SUB_CONFIG,
    "docs/requirements/product-requirements.md": REQ,
    "sub/claude/requirements/reqs.md": SUB_REQ,
    "sub/codex/requirements/reqs.md": SUB_REQ,
    "sub/claude/features/harness.md": spec({ id: "feature/harness", covers: "[R1]", references: "[root:R2, codex:R1]", body: "## R1: Sub one\n\nCites `root:R2` and `codex:R1`.\n" }),
    "sub/codex/features/integration.md": spec({ id: "feature/integration", references: "[R1, root:R1]", body: "## §1 Part\n\nCites `R1` and `root:R1`.\n" }),
    "docs/specifications/features/alpha.md": spec({ id: "feature/alpha", covers: "[R1]", references: "[claude:R1, claude:harness R1]", body: "## R1: One\n\nCites `claude:R1` and `claude:harness R1`.\n" }),
  });
  commit(root);
  const r = validateProject(root);
  assert.deepEqual(rules(r, "error"), []);
  assert.ok(r.checked.includes("claude:feature/harness") && r.checked.includes("codex:feature/integration"));
});

test("subprojects: a subproject without requirements relies on the root project's; unresolved cites name the project", () => {
  const root = repo({
    ".specplane/config.yaml": SUB_CONFIG,
    "docs/requirements/product-requirements.md": REQ,
    "sub/claude/requirements/reqs.md": SUB_REQ,
    "sub/claude/features/harness.md": spec({ id: "feature/harness", references: "[R7, codex:R9]", body: "## §1 Part\n\nCites `R7` and `codex:R9`.\n" }),
    "sub/codex/features/integration.md": spec({ id: "feature/integration", references: "[R2.1]", body: "## §1 Part\n\nCites `R2.1`.\n" }),
  });
  commit(root);
  const r = validateProject(root);
  const hit = (name: string) => r.findings.filter((f) => f.severity === "error" && f.project === name).map((f) => f.message);
  assert.ok(hit("claude").some((m) => /unresolved cite `R7`.*requirement not found: R7/.test(m)), "R7 is not in claude's own requirements");
  assert.ok(hit("claude").some((m) => /unresolved cite `codex:R9`.*requirement not found: R9/.test(m)));
  assert.deepEqual(hit("codex"), [], "codex has no requirements, so R2.1 is the root's");
  assert.equal(r.findings.filter((f) => f.severity === "error" && !f.project).length, 0);
  const text = formatReport(r);
  assert.match(text, /project claude, cites/);
  assert.match(text, /Project claude: 4 errors/);
});

test("subprojects: IDs are unique per project, not across projects; a root and a subproject may share an ID", () => {
  const root = repo({
    ".specplane/config.yaml": SUB_CONFIG,
    "docs/requirements/product-requirements.md": REQ,
    "sub/claude/requirements/reqs.md": "**R1: A**\nx\n\n**R1: B**\ny\n",
    "sub/codex/requirements/reqs.md": SUB_REQ,
  });
  commit(root);
  const r = validateProject(root);
  const dup = r.findings.filter((f) => /duplicate requirement ID R1/.test(f.message));
  assert.equal(dup.length, 1);
  assert.equal(dup[0].project, "claude");
  assert.equal(r.findings.filter((f) => f.severity === "error" && f.project === "codex").length, 0, "R1 in root and codex is fine");
});

test("subprojects: a missing folder is an error; a subproject requirement that restates a root requirement differently warns that the root wins", () => {
  const root = repo({
    ".specplane/config.yaml": SUB_CONFIG,
    "docs/requirements/product-requirements.md": REQ,
    "sub/claude/requirements/reqs.md": "**R5: One**\nDifferent text\n\n**R6: Unrelated**\nMore\n",
  });
  commit(root);
  const r = validateProject(root);
  assert.ok(r.findings.some((f) => f.severity === "error" && f.rule === "subprojects" && /subproject `codex` has no folder sub\/codex/.test(f.message)));
  const w = r.findings.filter((f) => f.rule === "subprojects" && f.severity === "warning");
  assert.equal(w.length, 1, "R6 has no root counterpart, only R5 differs");
  assert.match(w[0].message, /R5 "One".*root requirement R1.*root requirement wins/s);
  assert.equal(w[0].project, "claude");
});

test("requirement ID rules surface through validate", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": "**R1: A**\n\n**R1: B**\n\n*R4.2: C*\n\nRetired IDs: `R1`.\n",
  });
  commit(root);
  const e = rules(validateProject(root), "error").join("\n");
  assert.match(e, /duplicate requirement ID R1/);
  assert.match(e, /R1 is on the retired list/);
  assert.match(e, /R4.2 has no parent R4/);
});

const approveAs = async (root: string, ids: string[], n: number) => {
  const r = await approveSpecs({ root, actor: { role: "standard-user", kind: "human", name: "p" }, preset: DEFAULT_PRESET, now: new Date(Date.parse("2026-11-09T00:00:00Z") + n * 1000) }, ids, { yes: true });
  assert.ok(r.ok, r.reasons.join());
};

test("approval by record: stays approved until a cited part changes; edits and unapproved dependencies reopen", async () => {
  const dep = (text: string) => spec({ id: "feature/dep", covers: "[R2]", body: `## R2: Two\n\n${text}\n\n## §1 Other\n\nOther.\n` });
  const root = repo({ "docs/requirements/product-requirements.md": REQ, "docs/specifications/features/dep.md": dep("Original.") });
  const specBody = "## R1: One\n\nCites `dep R2`.\n";
  write(root, { "docs/specifications/features/user.md": spec({ id: "feature/user", covers: "[R1]", references: "[dep R2]", body: specBody }) });
  commit(root, "content");
  await approveAs(root, ["feature/dep"], 1);
  await approveAs(root, ["feature/user"], 2);
  let r = validateProject(root);
  const st = (id: string) => r.statuses.find((s) => s.id === id)!;
  assert.deepEqual(rules(r, "error"), []);
  assert.equal(st("feature/user").effective, "approved", JSON.stringify(st("feature/user")));
  assert.equal(st("feature/dep").effective, "approved");

  // A change elsewhere in the cited spec does not matter (R11.2).
  write(root, { "docs/specifications/features/dep.md": dep("Original.").replace("Other.", "Changed elsewhere.") });
  commit(root, "elsewhere");
  r = validateProject(root);
  assert.equal(st("feature/user").effective, "approved");
  assert.equal(st("feature/dep").effective, "awaiting-review", "its own content changed");
  assert.deepEqual(st("feature/dep").reasons, ["edited"]);

  // A change inside the cited part marks the citing spec outdated.
  write(root, { "docs/specifications/features/dep.md": dep("Changed in cited part.") });
  commit(root, "cited part");
  r = validateProject(root);
  assert.deepEqual(st("feature/user").reasons, ["outdated: dep R2"]);

  // A cited spec that was never approved gives unapproved-dependency (the approval below is by record, as an override leaves it).
  const fresh = spec({ id: "feature/fresh", covers: "[R1]", body: "## §1 Fresh\n\nText.\n" });
  const late = spec({ id: "feature/late", covers: "[R1]", references: "[fresh §1]", body: "## R1: One\n\nCites `fresh §1`.\n" });
  write(root, { "docs/specifications/features/fresh.md": fresh, "docs/specifications/features/late.md": late });
  commit(root, "late");
  const { specFingerprint } = await import("../spec/fingerprint.js");
  const { appendRecords, makeRecord } = await import("../spec/notes.js");
  appendRecords(root, "HEAD", [makeRecord("approval", "feature/late", specFingerprint(late)!, { by: { human: "p" }, date: "2026-11-09", cited: {} })]);
  r = validateProject(root);
  assert.deepEqual(st("feature/late").reasons, ["unapproved-dependency: fresh §1"]);

  // A reopened dependency does too.
  const ctxOf = (n: number) => ({ root, actor: { role: "standard-user" as const, kind: "human" as const, name: "p" }, preset: DEFAULT_PRESET, now: new Date(Date.parse("2026-11-09T02:00:00Z") + n * 1000) });
  await approveSpecs(ctxOf(1), ["feature/fresh"], { yes: true });
  r = validateProject(root);
  assert.deepEqual(st("feature/late").reasons, []);
  assert.ok(reopenSpec(ctxOf(2), "feature/fresh").ok);
  r = validateProject(root);
  assert.deepEqual(st("feature/late").reasons, ["unapproved-dependency: fresh §1"]);
});

test("legacy frontmatter status and approval are ignored with a warning", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/solo.md": spec({ id: "feature/solo", covers: "[R1]", extra: "status: approved\napproval:\n  by: {human: p}\n  date: 2026-11-09\n  commit: " + "f".repeat(40) + "\nreview-reason: edited\n" }),
  });
  commit(root);
  const r = validateProject(root);
  assert.deepEqual(r.statuses.find((s) => s.id === "feature/solo")!.reasons, ["never-approved"]);
  for (const k of ["status", "approval", "review-reason"]) assert.ok(rules(r, "warning").some((x) => x.includes(`legacy record key \`${k}\` is ignored`)), k);
});

test("a record with a fingerprint and cited map applies without its commit being reachable; a cited requirement change outdates it", async () => {
  const root = repo({ "docs/requirements/product-requirements.md": REQ });
  const text = spec({ id: "feature/solo", covers: "[R1]", body: "## R1: One\n\nText.\n" });
  write(root, { "docs/specifications/features/solo.md": text });
  commit(root);
  const { specFingerprint, partFingerprint } = await import("../spec/fingerprint.js");
  const { appendRecords, makeRecord } = await import("../spec/notes.js");
  appendRecords(root, "HEAD", [makeRecord("approval", "feature/solo", specFingerprint(text)!, { by: { human: "p" }, date: "2026-11-09", cited: { R1: partFingerprint("**R1: One**\nText") } })]);
  git(root, "commit", "-q", "--amend", "-m", "amended");
  assert.equal(validateProject(root).statuses.find((s) => s.id === "feature/solo")!.effective, "approved");
  write(root, { "docs/requirements/product-requirements.md": REQ.replace("Text\n", "Changed\n") });
  commit(root, "requirement changed");
  assert.deepEqual(validateProject(root).statuses.find((s) => s.id === "feature/solo")!.reasons, ["outdated: R1"]);
});

test("uncommitted edits are ignored by status and reported as a note; scope limits the specs checked", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec({ id: "feature/alpha", covers: "[R1]" }),
    "docs/specifications/features/beta.md": spec({ id: "feature/beta", covers: "[R2]", body: "## R2: Two\n\nT.\n" }),
  });
  commit(root);
  write(root, { "docs/specifications/features/alpha.md": spec({ id: "feature/alpha", covers: "[R1]", body: "## R1: One\n\nEdited.\n" }) });
  const r = validateProject(root, { ids: ["feature/alpha"] });
  assert.deepEqual(r.checked, ["feature/alpha"]);
  assert.ok(r.findings.some((f) => f.severity === "note" && /uncommitted changes are ignored/.test(f.message)));
});
