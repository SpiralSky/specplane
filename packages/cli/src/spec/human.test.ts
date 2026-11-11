import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";
import { guard, PRESETS, mode, DEFAULT_PRESET, type Actor } from "../perm/permissions.js";
import { editKeys } from "./fm-edit.js";
import { approveSpecs, metaGet, metaSet, overrideSpec, reopenSpec, type Ctx } from "./human.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject } from "./project.js";
import { readNotes } from "./notes.js";
import { computeStatus, StatusCtx } from "./status.js";
import { committedSource } from "./source.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" };
const sh = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

const F = "docs/specifications/features";
const fm = (id: string, extra = "", title = id) =>
  `---\nid: feature/${id}\ntitle: ${title}\nauthors:\n  - human: someone\ncovers: []\n${extra}---\n\n# ${title}\n\n## R9: Part\n\nText of ${id}.\n`;
const refs = (...r: string[]) => `references: [${r.join(", ")}]\n`;

/** Temp git repository with the given specs committed. */
function repo(specs: Record<string, string>): string {
  const files: Record<string, string> = {};
  for (const [id, text] of Object.entries(specs)) files[`${F}/${id}.md`] = text;
  const root = makeRepo(files);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Pat Person");
  sh(root, "config", "user.email", "pat@example.com");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  return root;
}
// A clock that moves on at every command, so records of one spec are ordered by `at` (`file-formats` §13.2).
let tick = 0;
const ctx = (root: string, role: Actor["role"] = "standard-user", preset = DEFAULT_PRESET): Ctx => ({ root, actor: { role, kind: "human", name: "Pat Person" }, preset, now: new Date(Date.parse("2026-11-10T12:00:00Z") + 1000 * tick++) });
const records = (root: string, id: string) => (readNotes(root).bySpec.get(`feature/${id}`) ?? []).map((s) => s.rec);
const read = (root: string, id: string) => fs.readFileSync(path.join(root, F, `${id}.md`), "utf8");
const audit = (root: string): Record<string, any>[] => {
  const dir = sh(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return fs.readFileSync(path.join(dir, "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
};
const effective = (root: string, id: string) => {
  const head = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
  return computeStatus(head, head.specs.get(`feature/${id}`)!, new StatusCtx(root, head));
};
const count = (root: string) => Number(sh(root, "rev-list", "--count", "HEAD"));

test("approve: records approver, fingerprint and cited map in the notes store; no branch commit, no file edit", async () => {
  const root = repo({ b: fm("b"), a: fm("a", refs("b R9")) });
  fs.writeFileSync(path.join(root, "unrelated.txt"), "x");
  const before = count(root);
  const r1 = await approveSpecs(ctx(root), ["feature/b"]);
  assert.ok(r1.ok, r1.reasons.join());
  const r2 = await approveSpecs(ctx(root), ["feature/a"]);
  assert.ok(r2.ok, r2.reasons.join());
  assert.equal(read(root, "a"), fm("a", refs("b R9")), "spec file untouched");
  assert.equal(count(root), before, "no commit on the branch");
  const [rec] = records(root, "a");
  assert.equal(rec.kind, "approval");
  assert.deepEqual(rec.by, { human: "Pat Person" });
  assert.equal(rec.date, "2026-11-10");
  assert.match(rec.fingerprint, /^spec-v3:sha256:[0-9a-f]{64}$/);
  assert.match(rec.cited!["b R9"], /^sec-v1:sha256:[0-9a-f]{64}$/);
  assert.match(rec.rid, /^[0-9a-f]{32}$/);
  assert.equal(readNotes(root).bySpec.get("feature/a")![0].commit, sh(root, "rev-parse", "HEAD"), "attached to HEAD");
  assert.equal(effective(root, "a").status, "approved");
  assert.ok(sh(root, "status", "--porcelain").includes("unrelated.txt"), "unrelated file stays untouched");
  const entries = audit(root).filter((e) => e.outcome === "done");
  assert.deepEqual(entries.map((e) => e.args), [["feature/b"], ["feature/a"]]);
  assert.equal(entries[0].actor.name, "Pat Person");
  assert.equal(entries[0].permission, "spec.approve");
});

test("approve: an unapproved reference fails and names it with its status", async () => {
  const root = repo({ b: fm("b"), a: fm("a", refs("b R9")) });
  const before = count(root);
  const r = await approveSpecs(ctx(root), ["feature/a"]);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join("\n"), /feature\/b.*awaiting-review/);
  assert.equal(count(root), before);
  assert.equal(effective(root, "a").status, "awaiting-review");
  assert.equal(audit(root).at(-1)!.outcome, "refused");
});

test("approve: a two-spec cycle is approved together with the same approver, after confirmation", async () => {
  const root = repo({ a: fm("a", refs("b R9")), b: fm("b", refs("a R9")), c: fm("c", refs("a R9")) });
  const noYes = await approveSpecs(ctx(root), ["feature/a"]);
  assert.equal(noYes.ok, false, "no terminal and no --yes");
  assert.match(noYes.reasons.join(), /feature\/a, feature\/b/);
  const declined = await approveSpecs(ctx(root), ["feature/a"], { interactive: true, ask: async () => false });
  assert.equal(declined.ok, false);
  assert.equal(audit(root).at(-1)!.outcome, "cancelled");
  let asked: string[] = [];
  const r = await approveSpecs(ctx(root), ["feature/a"], { interactive: true, ask: async (m) => { asked = m; return true; } });
  assert.ok(r.ok, r.reasons.join());
  assert.deepEqual(asked, ["feature/a", "feature/b"], "c cites the cycle but is not in the group");
  assert.deepEqual(r.written, ["feature/a", "feature/b"]);
  for (const id of ["a", "b"]) assert.equal(effective(root, id).status, "approved");
  assert.equal(effective(root, "c").status, "awaiting-review");
  const [ra, rb] = [records(root, "a")[0], records(root, "b")[0]];
  assert.deepEqual([ra.by, ra.date], [rb.by, rb.date], "same approver and date");
  assert.equal(sh(root, "log", "--format=%H", "refs/notes/specplane").split("\n").length, 1, "one notes commit for the group");
});

test("approve: a cycle where one member cites a missing part approves neither", async () => {
  const root = repo({ a: fm("a", refs("b R9")), b: fm("b", refs("a R9", "a R99")) });
  const before = count(root);
  const r = await approveSpecs(ctx(root), ["feature/a"], { yes: true });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join("\n"), /R99/);
  assert.equal(count(root), before);
  for (const id of ["a", "b"]) assert.equal(effective(root, id).status, "awaiting-review");
});

test("approve: every reason is listed, not only the first", async () => {
  const root = repo({ b: fm("b"), a: fm("a", refs("b R9", "b R42")) });
  fs.appendFileSync(path.join(root, F, "a.md"), "edit\n");
  const r = await approveSpecs(ctx(root), ["feature/a", "feature/nope"]);
  assert.equal(r.ok, false);
  const all = r.reasons.join("\n");
  assert.match(all, /uncommitted changes/);
  assert.match(all, /R42/);
  assert.match(all, /feature\/b.*awaiting-review/);
  assert.match(all, /feature\/nope.*not found/);
});

test("approve: uncommitted edits refuse and say to commit first", async () => {
  const root = repo({ a: fm("a") });
  fs.appendFileSync(path.join(root, F, "a.md"), "more\n");
  const r = await approveSpecs(ctx(root), ["feature/a"]);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /Commit .* first/);
});

test("approve: already approved does nothing and says so", async () => {
  const root = repo({ a: fm("a") });
  await approveSpecs(ctx(root), ["feature/a"]);
  const before = count(root);
  const r = await approveSpecs(ctx(root), ["feature/a"]);
  assert.ok(r.ok);
  assert.match(r.lines[0], /Already approved/);
  assert.equal(count(root), before);
});

test("approve: a current failed test result blocks approval; an outdated one does not", async () => {
  const root = repo({ a: fm("a") });
  const set = overrideSpec(ctx(root, "administrator"), "test", "feature/a", ["R9#T1", "failed"]);
  assert.ok(set.ok, set.reasons.join());
  const blocked = await approveSpecs(ctx(root), ["feature/a"]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reasons.join(), /failed test result \(R9#T1\)/);
  // A content edit makes the result outdated (counts as no result).
  fs.appendFileSync(path.join(root, F, "a.md"), "changed content\n");
  sh(root, "commit", "-q", "-am", "edit");
  const ok = await approveSpecs(ctx(root), ["feature/a"]);
  assert.ok(ok.ok, ok.reasons.join());
});

test("approve: no git user.name means no approval (the approver is never invented)", async () => {
  const root = repo({ a: fm("a") });
  sh(root, "config", "--unset", "user.name");
  const home = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "nohome-"));
  const saved = { ...process.env };
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = home; process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
  try {
    const c = ctx(root); c.actor = { ...c.actor, name: "" };
    const r = await approveSpecs(c, ["feature/a"]);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(), /user\.name/);
  } finally { process.env = saved; }
});

test("approve: the permission has three modes; only allow approves", async () => {
  const root = repo({ a: fm("a") });
  const llm = (r: string): Ctx => ({ ...ctx(root), actor: { role: "llm", kind: "llm", name: "m" }, preset: PRESETS.find((p) => p.id === r)! });
  const asked = await approveSpecs(llm("architecture-level-llm-control"), ["feature/a"], { yes: true });
  assert.equal(asked.ok, true, "request user sends a request instead of refusing");
  assert.ok(asked.request);
  assert.equal(effective(root, "a").status, "awaiting-review");
  const custom = structuredClone(DEFAULT_PRESET);
  custom.llm.modes["spec.approve"] = "deny";
  const denied = await approveSpecs({ ...llm("full-llm-control"), preset: custom }, ["feature/a"], { yes: true });
  assert.equal(denied.ok, false);
  assert.match(denied.reasons.join(), /Refused.*`spec\.approve`/);
  assert.equal(effective(root, "a").status, "awaiting-review");
  custom.llm.modes["spec.approve"] = "allow";
  const allowed = await approveSpecs({ ...llm("full-llm-control"), preset: custom }, ["feature/a"], { yes: true });
  assert.equal(allowed.ok, false, "an LLM actor has no human identity; the CLI never records one");
  assert.match(allowed.reasons.join(), /user\.name/);
  assert.equal(audit(root).filter((e) => e.outcome === "refused").length >= 2, true);
  assert.equal(audit(root).filter((e) => e.outcome === "request-sent").length, 1);
});

test("reopen: appends a reopen record, writes no commit or file edit, audits; re-approving the same content approves again", async () => {
  const root = repo({ a: fm("a") });
  await approveSpecs(ctx(root), ["feature/a"]);
  const before = count(root);
  const r = reopenSpec(ctx(root), "feature/a");
  assert.ok(r.ok, r.reasons.join());
  assert.equal(read(root, "a"), fm("a"));
  assert.equal(count(root), before);
  assert.deepEqual(records(root, "a").map((x) => x.kind), ["approval", "reopen"]);
  const st = effective(root, "a");
  assert.deepEqual([st.status, st.reasons], ["awaiting-review", ["edited"]]);
  const e = audit(root).at(-1)!;
  assert.equal(e.command, "spec reopen");
  assert.equal(e.permission, "spec.edit.feature");
  assert.equal(reopenSpec(ctx(root), "feature/a").lines[0].includes("already awaiting review"), true);
  const again = await approveSpecs(ctx(root), ["feature/a"]);
  assert.ok(again.ok, again.reasons.join());
  assert.equal(effective(root, "a").status, "approved", "a newer approval of the same content decides");
});

test("meta set title: one audit entry with field, old value, new value and user; status unchanged", async () => {
  const root = repo({ a: fm("a") });
  await approveSpecs(ctx(root), ["feature/a"]);
  const r = metaSet(ctx(root), "feature/a", "authors", "human:Pat Person,llm:claude-sonnet-5-5|drafted");
  assert.ok(r.ok, r.reasons.join());
  assert.match(read(root, "a"), /authors:\n {2}- human: Pat Person\n {2}- llm: claude-sonnet-5-5\n {4}contribution: drafted/);
  assert.equal(effective(root, "a").status, "approved", "authors are not content");
  const t = metaSet(ctx(root), "feature/a", "title", "Better title");
  assert.ok(t.ok);
  assert.match(read(root, "a"), /^title: Better title$/m);
  assert.doesNotMatch(t.lines.join("\n"), /fingerprint|awaiting/);
  assert.equal(effective(root, "a").status, "approved", "title is metadata (cli R17)");
  const e = audit(root).at(-1)!;
  assert.deepEqual([e.command, e.old, e.new, e.actor.name, e.permission], ["spec meta set", { title: "a" }, { title: "Better title" }, "Pat Person", "meta.write.title"]);
  assert.ok(metaSet(ctx(root), "feature/a", "covers", "R9, R10").ok);
  assert.equal(effective(root, "a").status, "approved", "covers is metadata (cli R17)");
});

test("meta set: refuses unknown fields and bad values, never touches the body", async () => {
  const root = repo({ a: fm("a") });
  const before = read(root, "a");
  for (const [f, v] of [["status", "approved"], ["id", "x"], ["approval.date", "2026-11-10"], ["approval", "x"], ["covers", "not a cite!"], ["title", ""]] as const) {
    const r = metaSet(ctx(root), "feature/a", f, v);
    assert.equal(r.ok, false, f);
  }
  assert.equal(read(root, "a"), before);
});

test("meta set: a dirty file is written but not committed", async () => {
  const root = repo({ a: fm("a") });
  fs.appendFileSync(path.join(root, F, "a.md"), "dirty\n");
  const before = count(root);
  const r = metaSet(ctx(root), "feature/a", "title", "T2");
  assert.ok(r.ok);
  assert.equal(count(root), before);
  assert.match(r.lines.join("\n"), /nothing was committed/);
});

test("meta get shows overrides", async () => {
  const root = repo({ a: fm("a") });
  await approveSpecs(ctx(root), ["feature/a"]);
  assert.doesNotMatch(metaGet(ctx(root), "feature/a").lines.join("\n"), /override/);
  overrideSpec(ctx(root, "administrator"), "approver", "feature/a", ["human:Someone Else"]);
  assert.match(metaGet(ctx(root), "feature/a").lines.join("\n"), /approver: \{"human":"Someone Else"\} \[override by \{"human":"Pat Person"\}/);
});

test("granular permissions: only authors allowed means authors change, title is refused naming the title permission", () => {
  const preset = structuredClone(DEFAULT_PRESET);
  preset.standardUser = { defaultMode: "deny", modes: { "meta.write.authors": "allow" } };
  const actor: Actor = { role: "standard-user", kind: "human", name: "p" };
  assert.equal(guard(preset, actor, [["meta.write.authors", "meta.write"]], "x").kind, "allow");
  const d = guard(preset, actor, [["meta.write.title", "meta.write"]], "x");
  assert.equal(d.kind, "deny");
  assert.equal((d as { permission: string }).permission, "meta.write.title");
  preset.standardUser.modes["meta.write"] = "allow";
  assert.equal(guard(preset, actor, [["meta.write.title", "meta.write"]], "x").kind, "allow", "more permissive mode wins");
  preset.standardUser = { defaultMode: "allow", modes: { "meta.write": "deny", "meta.write.title": "allow" } };
  assert.equal(guard(preset, actor, [["meta.write.title", "meta.write"]], "x").kind, "allow", "deny on general does not remove granular allow");
});

test("protected overrides: refused for the Standard User, allowed for the Administrator, marked, audited", async () => {
  const root = repo({ a: fm("a") });
  const before = read(root, "a");
  for (const [kind, args] of [["status", ["approved"]], ["approver", ["human:X"]], ["approval-commit", ["HEAD"]], ["test", ["R9#T1", "passed"]]] as const) {
    const r = overrideSpec(ctx(root), kind, "feature/a", [...args]);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(), new RegExp(`override\\.${kind}`));
  }
  assert.equal(read(root, "a"), before);
  assert.equal(audit(root).filter((e) => e.outcome === "refused").length, 4);

  const admin = ctx(root, "administrator");
  const s = overrideSpec(admin, "status", "feature/a", ["approved"]);
  assert.ok(s.ok, s.reasons.join());
  const [first] = records(root, "a");
  assert.deepEqual([first.kind, first.target, first.value, first.by, first.date], ["override", "status", "approved", { human: "Pat Person" }, "2026-11-10"]);
  assert.ok(first.cited && first.fingerprint, "checked like an approval");
  assert.equal(read(root, "a"), before, "no file edit");
  assert.equal(effective(root, "a").status, "approved");
  // The overridden approval is checked like any other: a content edit reopens it.
  fs.appendFileSync(path.join(root, F, "a.md"), "edit\n");
  sh(root, "commit", "-q", "-am", "edit");
  assert.equal(effective(root, "a").status, "awaiting-review");

  const t = overrideSpec(admin, "test", "feature/a", ["R9#T1", "passed"]);
  assert.ok(t.ok, t.reasons.join());
  assert.equal(read(root, "a").includes("results:"), false, "no file edit");
  const tr = records(root, "a").filter((r) => r.kind === "test-result").at(-1)!;
  assert.deepEqual([tr.test, tr["test-kind"], tr.outcome, (tr.override as { by: unknown }).by], ["R9#T1", "deterministic", "passed", { human: "Pat Person" }]);
  assert.match(metaGet(admin, "feature/a").lines.join("\n"), /result R9#T1: passed \[override/);
  const cleared = overrideSpec(ctx(root, "administrator"), "test", "feature/a", ["R9#T1", "clear"]);
  assert.ok(cleared.ok);
  assert.equal(records(root, "a").filter((r) => r.kind === "test-result").at(-1)!.outcome, "cleared");
  assert.doesNotMatch(metaGet(admin, "feature/a").lines.join("\n"), /result R9#T1/);
  const ov = audit(root).filter((e) => e.command.startsWith("spec override") && e.outcome === "done");
  assert.equal(ov.length, 3);
  assert.equal(ov[0].actor.role, "administrator");
  assert.equal(ov[0].permission, "override.status");
});

test("override status awaiting-review and a newer approval decide in order of time", async () => {
  const root = repo({ a: fm("a") });
  overrideSpec(ctx(root, "administrator"), "status", "feature/a", ["approved"]);
  assert.equal(effective(root, "a").status, "approved");
  overrideSpec(ctx(root, "administrator"), "status", "feature/a", ["awaiting-review"]);
  assert.equal(effective(root, "a").status, "awaiting-review");
  await approveSpecs(ctx(root), ["feature/a"]);
  assert.equal(effective(root, "a").status, "approved");
  assert.deepEqual(records(root, "a").map((x) => x.kind), ["override", "override", "approval"]);
});

test("override approver changes only what is shown, not the status", async () => {
  const root = repo({ a: fm("a") });
  assert.equal(overrideSpec(ctx(root, "administrator"), "approver", "feature/a", ["human:X"]).ok, false, "nothing approved yet");
  await approveSpecs(ctx(root), ["feature/a"]);
  assert.ok(overrideSpec(ctx(root, "administrator"), "approver", "feature/a", ["human:X"]).ok);
  assert.equal(effective(root, "a").status, "approved");
});

test("override approval-commit changes only what is shown, not the status", async () => {
  const root = repo({ a: fm("a") });
  assert.equal(overrideSpec(ctx(root, "administrator"), "approval-commit", "feature/a", ["HEAD"]).ok, false, "nothing approved yet");
  await approveSpecs(ctx(root), ["feature/a"]);
  const first = sh(root, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(root, "other.txt"), "x");
  sh(root, "add", "other.txt");
  sh(root, "commit", "-q", "-m", "other");
  assert.equal(overrideSpec(ctx(root, "administrator"), "approval-commit", "feature/a", ["deadbeef"]).ok, false, "unknown commit");
  const ok = overrideSpec(ctx(root, "administrator"), "approval-commit", "feature/a", [first.slice(0, 10)]);
  assert.ok(ok.ok, ok.reasons.join());
  assert.equal(effective(root, "a").status, "approved");
  assert.match(metaGet(ctx(root, "administrator"), "feature/a").lines.join("\n"), new RegExp(`approval.commit: ${first}.*override`));
  const rec = records(root, "a").filter((r) => r.kind === "override").at(-1)!;
  assert.deepEqual([rec.target, rec.value], ["approval-commit", first]);
});

test("presets: Standard User holds everything except the three overrides; Administrator holds all; defaults deny", () => {
  for (const p of PRESETS) {
    assert.equal(mode(p, "standard-user", "spec.approve"), "allow");
    for (const o of ["override.status", "override.approver", "override.approval-commit", "override.test"]) {
      assert.equal(mode(p, "standard-user", o), "deny");
      assert.equal(mode(p, "llm", o), "deny");
      assert.equal(mode(p, "administrator", o), "allow");
    }
    assert.equal(mode(p, "llm", "spec.approve"), "request-user");
    assert.equal(mode(p, "llm", "meta.write"), "deny");
    assert.equal(mode(p, "llm", "meta.write.title"), "deny");
  }
  assert.equal(mode(PRESETS[0], "llm", "spec.edit.architecture"), "allow");
  assert.equal(mode(PRESETS[1], "llm", "spec.edit.feature"), "deny");
  assert.equal(mode(PRESETS[2], "llm", "spec.edit.feature"), "allow");
  assert.equal(mode(PRESETS[3], "llm", "spec.edit.requirement"), "allow");
});

test("fm-edit keeps comments, other keys and order; inserts new keys in place", () => {
  const text = "---\nid: x\n# keep me\ntitle: T\nstatus: awaiting-review\ncovers: [R1]\n---\nbody\n";
  const out = editKeys(text, { status: "approved", approval: { by: { human: "p" }, date: "2026-11-10" }, "review-reason": undefined });
  assert.equal(out, "---\nid: x\n# keep me\ntitle: T\nstatus: approved\napproval:\n  by:\n    human: p\n  date: 2026-11-10\ncovers: [R1]\n---\nbody\n");
});

test("CLI: spec approve, role switch and override through the real command line", () => {
  const root = repo({ a: fm("a") });
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  const refused = run("spec", "override", "status", "feature/a", "approved");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /override\.status/);
  const ok = run("spec", "approve", "feature/a");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Approved feature\/a as Pat Person/);
  assert.equal(run("spec", "approve", "feature/a").stdout.includes("Already approved"), true);
  assert.equal(run("role", "show").stdout.trim(), "standard-user");
  run("role", "switch", "administrator");
  assert.equal(run("spec", "override", "approver", "feature/a", "human:Other").status, 0);
  assert.match(run("spec", "meta", "get", "feature/a").stdout, /approver: .*Other.*override/);
  run("role", "switch", "standard-user");
  const group = repo({ a: fm("a", refs("b R9")), b: fm("b", refs("a R9")) });
  const g = spawnSync(process.execPath, [cli, "spec", "approve", "feature/a"], { cwd: group, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(g.status, 1, "no terminal, no --yes");
  const g2 = spawnSync(process.execPath, [cli, "spec", "approve", "feature/a", "--yes"], { cwd: group, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(g2.status, 0, g2.stderr);
});
