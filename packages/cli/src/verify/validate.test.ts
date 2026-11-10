import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { validateProject, type Report } from "./validate.js";
import { specFingerprint } from "../spec/fingerprint.js";

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-validate-"));
  git(root, "init", "-q", "-b", "main");
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
const spec = (o: { id: string; status?: string; approval?: string; covers?: string; implements?: string; references?: string; body?: string; extra?: string }) =>
  `---\nid: ${o.id}\ntitle: T\nstatus: ${o.status ?? "awaiting-review"}\n${o.approval ?? ""}authors: []\n${o.covers ? `covers: ${o.covers}\n` : ""}${o.implements ? `implements: ${o.implements}\n` : ""}references: ${o.references ?? "[]"}\n${o.extra ?? ""}---\n\n${o.body ?? "## R1: One\n\nText.\n"}`;
// These status tests require an approved dependency; plain files are tested separately.
const reqDraft = spec({ id: "requirement/product-requirements", body: REQ_BODY });
const REQ = spec({ id: "requirement/product-requirements", body: REQ_BODY, status: "approved",
  approval: `approval:\n  by: {human: p}\n  date: 2026-11-09\n  commit: ${"a".repeat(40)}\n  fingerprint: ${specFingerprint(reqDraft)}\n  cited: {}\n` });
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
    "docs/specifications/features/alpha.md": spec({ id: "feature/other", status: "draft", implements: "[beta R1]", extra: "mystery: 1\n" }),
    "docs/specifications/features/beta.md": "# no frontmatter\n",
    "docs/specifications/architecture/gamma.md": spec({ id: "architecture/gamma", covers: "[R1]" }),
    "docs/specifications/features/INFO.md": "---\nid: feature/info\n---\n",
  });
  commit(root);
  const m = rules(validateProject(root));
  const has = (s: RegExp) => assert.ok(m.some((x) => s.test(x)), `expected ${s} in ${m.join("\n")}`);
  has(/id is "feature\/other" but the path gives feature\/alpha/);
  has(/status must be `awaiting-review` or `approved`/);
  has(/`implements` is only for architecture specs/);
  has(/`covers` is only for feature specs/);
  has(/unknown frontmatter field `mystery`/);
  has(/does not start with a `---`/);
  has(/INFO.md has frontmatter/);
});

test("cites: unresolved, missing from references, listed but unused, subproject later release", () => {
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
  assert.ok(!e.some((x) => /claude:R1/.test(x)), "subproject cites are not errors");
  const w = rules(r, "warning");
  assert.ok(w.some((x) => /subproject `claude`.*later release/.test(x)));
  assert.ok(w.some((x) => /lists `R7`, which the body never cites/.test(x)));
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

test("hand-format approval: stays approved until a cited part changes; edits and unapproved dependencies reopen", () => {
  const dep = (text: string) => spec({ id: "feature/dep", covers: "[R2]", body: `## R2: Two\n\n${text}\n\n## §1 Other\n\nOther.\n`, status: "approved", approval: "approval:\n  by: {llm: m, delegated-by: u}\n  date: 2026-11-09\n  commit: COMMIT\n" });
  const root = repo({ "docs/requirements/product-requirements.md": REQ, "docs/specifications/features/dep.md": dep("Original.").replace("COMMIT", "0".repeat(40)) });
  const first = commit(root, "dep content");
  // The hand-written approvals name the commit that holds the approved content.
  const approve = (id: string, body: string, refs: string, c: string) => spec({ id: `feature/${id}`, covers: "[R1]", references: refs, body, status: "approved", approval: `approval:\n  by: {llm: m, delegated-by: u}\n  date: 2026-11-09\n  commit: ${c}\n` });
  const specBody = "## R1: One\n\nCites `dep R2`.\n";
  write(root, { "docs/specifications/features/user.md": approve("user", specBody, "[dep R2]", "COMMIT") });
  const userFirst = commit(root, "user content");
  write(root, { "docs/specifications/features/user.md": approve("user", specBody, "[dep R2]", userFirst) });
  write(root, { "docs/specifications/features/dep.md": dep("Original.").replace("COMMIT", first) });
  commit(root, "approve by hand");
  let r = validateProject(root);
  const st = (id: string) => r.statuses.find((s) => s.id === id)!;
  assert.deepEqual(rules(r, "error"), []);
  assert.equal(st("feature/user").effective, "approved", JSON.stringify(st("feature/user")));
  assert.equal(st("feature/dep").effective, "approved");

  // A change elsewhere in the cited spec does not matter (R11.2).
  write(root, { "docs/specifications/features/dep.md": dep("Original.").replace("COMMIT", first).replace("Other.", "Changed elsewhere.") });
  commit(root, "elsewhere");
  r = validateProject(root);
  assert.equal(st("feature/user").effective, "approved");
  assert.equal(st("feature/dep").effective, "awaiting-review", "its own content changed");
  assert.deepEqual(st("feature/dep").reasons, ["edited"]);
  assert.ok(rules(r, "warning").some((x) => /stored status is approved but the effective status is awaiting-review/.test(x)));

  // A change inside the cited part marks the citing spec outdated.
  write(root, { "docs/specifications/features/dep.md": dep("Changed in cited part.").replace("COMMIT", first) });
  commit(root, "cited part");
  r = validateProject(root);
  assert.deepEqual(st("feature/user").reasons, ["outdated: dep R2"]);

  // A cited spec without an approval block gives unapproved-dependency.
  write(root, { "docs/specifications/features/dep.md": spec({ id: "feature/dep", covers: "[R2]", body: "## R2: Two\n\nOriginal.\n\n## §1 Other\n\nOther.\n" }) });
  commit(root, "dep reopened");
  r = validateProject(root);
  assert.ok(st("feature/user").reasons.includes("unapproved-dependency: dep R2"));
});

test("approval with a stored fingerprint and cited map does not need its commit", () => {
  const root = repo({ "docs/requirements/product-requirements.md": REQ });
  const text = spec({ id: "feature/solo", covers: "[R1]", body: "## R1: One\n\nText.\n" });
  write(root, { "docs/specifications/features/solo.md": text });
  commit(root);
  // Compute the fingerprints the way approval would.
  return import("../spec/fingerprint.js").then(({ specFingerprint, partFingerprint }) => {
    const fp = specFingerprint(text)!;
    const req = partFingerprint("**R1: One**\nText");
    const approved = spec({ id: "feature/solo", covers: "[R1]", body: "## R1: One\n\nText.\n", status: "approved", approval: `approval:\n  by: {human: p}\n  date: 2026-11-09\n  commit: ${"1".repeat(40)}\n  fingerprint: ${fp}\n  cited: {"R1": "${req}"}\n` });
    write(root, { "docs/specifications/features/solo.md": approved });
    commit(root, "approve");
    const r = validateProject(root);
    assert.equal(r.statuses[0].effective, "approved", JSON.stringify(r.statuses));
    write(root, { "docs/requirements/product-requirements.md": REQ.replace("Text\n", "Changed\n") });
    commit(root, "requirement changed");
    assert.deepEqual(validateProject(root).statuses[0].reasons, ["outdated: R1"]);
  });
});

test("approval whose commit is unreachable cannot be checked: awaiting-review with a warning", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/solo.md": spec({ id: "feature/solo", covers: "[R1]", status: "approved", approval: `approval:\n  by: {human: p}\n  date: 2026-11-09\n  commit: ${"f".repeat(40)}\n` }),
  });
  commit(root);
  const r = validateProject(root);
  assert.deepEqual(r.statuses[0].reasons, ["edited"]);
  assert.ok(rules(r, "warning").some((x) => /approval cannot be checked/.test(x)));
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
