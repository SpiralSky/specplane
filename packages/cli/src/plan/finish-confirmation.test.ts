import assert from "node:assert/strict";

import * as fs from "node:fs";

import * as path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { finishPlan, type FinishGate } from "./flows.js";
import { acquireWriterLease } from "../core/writer-leases.js";
import { createFinishFixture } from "./finish-fixture.js";
import { capturePlanSnapshot } from "../generate/snapshot.js";
import { generatePlansMd } from "../generate/plans-md.js";

const { git, gitOk, A, repo, fin, finConfirmed, finWithCallback, sha } = createFinishFixture();

test("finish uses recorded nondefault target and requires fresh acceptance after finalization", () => {
  const r = repo({ target: "release" });
  const main = sha(r.root, "main");
  const first = fin(r, "--yes");
  assert.equal(first.code, 0, first.err);
  assert.equal(sha(r.root, "release"), main);
  assert.match(first.err, /ready to merge/);
  const reviewed = sha(r.co, "HEAD");
  const second = finConfirmed(r);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /Finished and merged/);
  assert.equal(sha(r.root, "main"), main);
  assert.ok(gitOk(r.root, "merge-base", "--is-ancestor", reviewed, "release"));
});

test("target movement invalidates earlier acceptance and requires another invocation", () => {
  const r = repo();
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const prior = sha(r.co, "HEAD");
  fs.writeFileSync(path.join(r.root, "advanced.txt"), "advance\n");
  git(r.root, "add", "advanced.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  const target = sha(r.root, "HEAD");
  const rebased = fin(r, "--yes");
  assert.equal(rebased.code, 0, rebased.err);
  assert.match(rebased.err, /ready to merge/);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.notEqual(sha(r.co, "HEAD"), prior);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  assert.match(merged.out, /Finished and merged/);
});

test("confirmation refuses when target moves during the human challenge", async () => {
  const r = repo();
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const reviewed = sha(r.co, "HEAD");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async question => {
    assert.match(question, new RegExp(reviewed));
    fs.writeFileSync(path.join(r.root, "raced.txt"), "race\n");
    git(r.root, "add", "raced.txt");
    git(r.root, "commit", "-q", "-m", "target race");
    return true;
  } }), /changed during operation/);
  assert.equal(sha(r.co, "HEAD"), reviewed);
  assert.equal(gitOk(r.root, "merge-base", "--is-ancestor", reviewed, "main"), false);
});

test("finalization confirmation preserves callback-time target file and index edits", async () => {
  const r = repo();
  const before = sha(r.co, "HEAD");
  const file = path.join(r.root, "base.txt");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
    fs.writeFileSync(file, "human staged change\n");
    git(r.root, "add", "base.txt");
    fs.writeFileSync(file, "human unstaged change\n");
    return true;
  } }), /clean checkout of target/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(fs.readFileSync(file, "utf8"), "human unstaged change\n");
  assert.equal(git(r.root, "show", ":base.txt"), "human staged change");
  assert.equal(git(r.co, "log", "-1", "--format=%s").includes("finish"), false);
});

test("finish rejects a draft target lifecycle record", () => {
  const r = repo();
  const file = path.join(r.root, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: draft"));
  git(r.root, "commit", "-qam", "move target back to draft");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /target status draft/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("unattended finalization reports readiness without claiming finish", () => {
  const r = repo();
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Ready for finalization/);
  assert.doesNotMatch(result.out, /Finished/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("publication refuses a refreshed remote plan tracking ref after confirmation", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const remoteSeed = sha(r.root, "main");
  const action = `if (count === 2) { execFileSync("git", ["update-ref", "refs/remotes/origin/plan/${A}", ${JSON.stringify(remoteSeed)}]); }`;
  const result = finWithCallback(r, action);
  assert.equal(result.code, 1);
  assert.match(result.err, /refs\/remotes\/origin\/plan.*changed during operation/);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
});

test("publication refuses a plan head moved during confirmation", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const action = `if (count === 2) { execFileSync("git", ["commit", "--allow-empty", "-m", "concurrent change"]); }`;
  const result = finWithCallback(r, action);
  assert.equal(result.code, 1);
  assert.match(result.err, /Plan changed during publication confirmation/);
  assert.equal(git(r.co, "log", "-1", "--format=%s"), "concurrent change");
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
});

test("finish rejects a draft branch lifecycle status", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: draft"));
  git(r.co, "commit", "-qam", "invalid branch status");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /plan status draft is not executable for git mode/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("finish reaches approval gate for a migrated active Git-mode plan", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: review"));
  git(r.co, "commit", "-qam", "migrated status");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 0, result.err);
  assert.match(result.err, /ready to merge/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("finish regenerates acceptance evidence after rebase and separates merge consent", async () => {
  const r = repo();
  const original = sha(r.co, "HEAD");
  const file = path.join(r.root, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("it works", "new target requirement"));
  fs.writeFileSync(path.join(r.root, "plans", A, "spec-gaps.md"),
    "## G1: New target gap\n**Kind**: assumption\n**Step**: 1\n**Case**: changed target\n**Resolution**: pending\n**Status**: open\n");
  git(r.root, "add", "plans");
  git(r.root, "commit", "-qm", "change acceptance evidence");
  const target = sha(r.root, "HEAD");
  const questions: string[] = [];
  const result = await finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async question => {
    questions.push(question);
    assert.match(question, /new target requirement/);
    assert.match(question, /G1 \(assumption, .*changed target/);
    assert.doesNotMatch(question, /it works/);
    assert.ok(question.includes(sha(r.co, "HEAD")));
    assert.ok(question.includes(target));
    assert.notEqual(sha(r.co, "HEAD"), original);
    return questions.length === 1;
  } });
  assert.equal(questions.length, 2);
  assert.match(questions[0], /Finalize/);
  assert.match(questions[1], /Merge/);
  assert.equal(result.outcome, "ready");
  assert.equal(result.finalized, true);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
  assert.doesNotMatch(result.notices.join("\n"), /it works/);
});

test("declining fresh post-rebase acceptance preserves the rebased work without finalizing", async () => {
  const r = repo();
  const original = sha(r.co, "HEAD");
  fs.writeFileSync(path.join(r.root, "advanced.txt"), "advance\n");
  git(r.root, "add", "advanced.txt");
  git(r.root, "commit", "-qm", "advance target");
  const target = sha(r.root, "HEAD");
  let calls = 0;
  const result = await finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async question => {
    calls++;
    assert.match(question, /Finalize/);
    assert.ok(question.includes(sha(r.co, "HEAD")));
    assert.notEqual(sha(r.co, "HEAD"), original);
    return false;
  } });
  assert.equal(calls, 1);
  assert.equal(result.finalized, false);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
});


test("finish refuses an unfinished step introduced by the rebase before requesting consent", async () => {
  const r = repo();
  const steps = path.join(r.root, "plans", A, "steps");
  fs.mkdirSync(steps, { recursive: true });
  fs.writeFileSync(path.join(steps, "02-new.md"),
    `---\nplan: ${A}\nstep: 2\ntitle: New requirement\nstatus: pending\n---\n# New requirement\n`);
  git(r.root, "add", "plans");
  git(r.root, "commit", "-qm", "add required step");
  const target = sha(r.root, "HEAD");
  let calls = 0;
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
    calls++;
    return true;
  } }), /Cannot finish: step 02 is `pending`/);
  assert.equal(calls, 0);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.ok(fs.existsSync(path.join(r.co, "plans", A, "steps", "02-new.md")));
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
});

test("finalization previews exact status bytes and archive moves before consent", async () => {
  const r = repo({ planCfg: "  archive_done: true\n" });
  const file = path.join(r.co, "plans", A, "PLAN.md");
  const before = fs.readFileSync(file, "utf8").replace("status: ready", "status : ready");
  fs.writeFileSync(file, before);
  git(r.co, "commit", "-qam", "space before status colon");
  let calls = 0;
  const result = await finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async question => {
    calls++;
    if (calls === 1) {
      assert.ok(question.includes(`Before:\n${before}`));
      assert.ok(question.includes(`After:\n${before.replace("status : ready", "status: done")}`));
      assert.ok(question.includes(`plans/${A}/PLAN.md → plans/archive/${A}/PLAN.md`));
      assert.ok(question.includes('Exact plan index change: plans/PLANS.md\nBefore:\n(missing)\nAfter:\n'));
      assert.ok(question.includes(`archive/${A}/PLAN.md`));
      assert.equal(fs.readFileSync(file, "utf8"), before);
      return true;
    }
    return false;
  } });
  assert.equal(result.finalized, true);
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(path.join(r.co, "plans/archive", A, "PLAN.md"), "utf8"), before.replace("status : ready", "status: done"));
});

test("finalization rejects a hidden callback edit instead of committing unreviewed status bytes", async () => {
  const r = repo();
  const relative = `plans/${A}/PLAN.md`;
  const file = path.join(r.co, relative);
  const before = sha(r.co, "HEAD");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
    git(r.co, "update-index", "--assume-unchanged", relative);
    fs.appendFileSync(file, "\nUnreviewed acceptance change\n");
    return true;
  } }), /Finalization input differs from the reviewed revision/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.match(fs.readFileSync(file, "utf8"), /Unreviewed acceptance change/);
});

for (const change of ["binary bytes", "file type", "executable mode"] as const) {
  test(`archive finalization preserves hidden callback changes to ${change}`, async () => {
    const r = repo({ planCfg: "  archive_done: true\n" });
    const relative = `plans/${A}/attachment.bin`;
    const file = path.join(r.co, relative);
    fs.writeFileSync(file, Buffer.from([0, 255, 1, 128]));
    git(r.co, "add", relative);
    git(r.co, "commit", "-qm", "add binary archive input");
    const before = sha(r.co, "HEAD");
    const plan = fs.readFileSync(path.join(r.co, "plans", A, "PLAN.md"), "utf8");
    let calls = 0;
    await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
      calls++;
      git(r.co, "update-index", "--assume-unchanged", relative);
      if (change === "binary bytes") fs.writeFileSync(file, Buffer.from([0, 254, 1, 128]));
      else if (change === "file type") {
        fs.unlinkSync(file);
        fs.symlinkSync("PLAN.md", file);
      } else fs.chmodSync(file, 0o755);
      return true;
    } }), /Archive input (type )?differs from the reviewed revision/);
    assert.equal(calls, 1);
    assert.equal(sha(r.co, "HEAD"), before);
    assert.equal(fs.readFileSync(path.join(r.co, "plans", A, "PLAN.md"), "utf8"), plan);
    assert.equal(fs.existsSync(path.join(r.co, "plans/archive", A)), false);
    if (change === "binary bytes") assert.deepEqual(fs.readFileSync(file), Buffer.from([0, 254, 1, 128]));
    else if (change === "file type") assert.equal(fs.readlinkSync(file), "PLAN.md");
    else assert.ok(fs.statSync(file).mode & 0o111);
  });
}

for (const change of ["unrelated file", "plan status", "commit message"] as const) {
  test(`finalization refuses hook changes to ${change} before merge consent`, async () => {
    const r = repo({ planCfg: "  archive_done: true\n" });
    const target = sha(r.root, "HEAD");
    const before = sha(r.co, "HEAD");
    const common = git(r.co, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const hook = path.join(common, "hooks", change === "commit message" ? "commit-msg" : "pre-commit");
    const archived = `plans/archive/${A}/PLAN.md`;
    const script = change === "unrelated file" ? 'printf "hook edit\\n" > hook.txt\ngit add hook.txt\n' :
      change === "plan status" ? `sed 's/status: done/status: review/' '${archived}' > status.tmp\nmv status.tmp '${archived}'\ngit add '${archived}'\n` :
      'printf "\\nUnexpected hook message\\n" >> "$1"\n';
    fs.writeFileSync(hook, `#!/bin/sh\n${script}`, { mode: 0o755 });
    let calls = 0;
    await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
      calls++;
      return true;
    } }), /differs from the prepared tree, message or branch/);
    assert.equal(calls, 1);
    assert.equal(sha(r.root, "HEAD"), target);
    assert.notEqual(sha(r.co, "HEAD"), before);
    assert.equal(sha(r.co, "HEAD^"), before);
    assert.equal(git(r.co, "status", "--porcelain"), "");
    if (change === "unrelated file") assert.equal(fs.readFileSync(path.join(r.co, "hook.txt"), "utf8"), "hook edit\n");
    else if (change === "plan status") assert.match(fs.readFileSync(path.join(r.co, archived), "utf8"), /status: review/);
    else assert.match(git(r.co, "log", "-1", "--format=%B"), /Unexpected hook message/);
    const retained = sha(r.co, "HEAD");
    const journalDirectory = path.join(common, "specplane-finish");
    const journals = fs.readdirSync(journalDirectory);
    assert.equal(journals.length, 1);
    const journal = path.join(journalDirectory, journals[0]);
    const evidence = fs.readFileSync(journal, "utf8");
    assert.equal(JSON.parse(evidence).parent, before);
    fs.unlinkSync(hook);
    // A new process must not reinterpret valid finish trailers as verification.
    const retry = finConfirmed(r);
    assert.equal(retry.code, 1, retry.err);
    assert.match(retry.err, /Pending finalization evidence/);
    assert.equal(sha(r.co, "HEAD"), retained);
    assert.equal(sha(r.root, "HEAD"), target);
    assert.equal(fs.readFileSync(journal, "utf8"), evidence);
  });
}

test("pending finalization evidence refuses before any confirmation or rebase", async () => {
  const r = repo();
  const common = git(r.co, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const directory = path.join(common, "specplane-finish");
  fs.mkdirSync(directory);
  // A directory/link or invalid JSON at the record path must also refuse.
  const { createHash } = await import("node:crypto");
  const record = path.join(directory, createHash("sha256").update(A).digest("hex") + ".json");
  fs.mkdirSync(record);
  const before = sha(r.co, "HEAD");
  let confirmations = 0;
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => { confirmations++; return true; } }), /Pending finalization evidence/);
  assert.equal(confirmations, 0);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.ok(fs.statSync(record).isDirectory());
});

for (const archive of [true, false]) {
  test(`finish commits its exact prospective plan index with archive_done=${archive}`, async () => {
    const r = repo({ planCfg: `  archive_done: ${archive}\n` });
    let calls = 0;
    await finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => ++calls === 1 });
    assert.equal(calls, 2);
    const expected = generatePlansMd(capturePlanSnapshot(r.co, 'head'));
    assert.equal(fs.readFileSync(path.join(r.co, 'plans/PLANS.md'), 'utf8'), expected);
    assert.equal(git(r.co, 'show', 'HEAD:plans/PLANS.md'), expected.trim());
    assert.ok(expected.includes(archive ? `archive/${A}/PLAN.md` : `${A}/PLAN.md`));
    assert.match(expected, /done/);
    assert.equal(git(r.co, 'status', '--porcelain'), '');
  });
}

test('finish refuses a hidden plan index edit during finalization consent', async () => {
  const r = repo();
  const output = path.join(r.co, 'plans/PLANS.md');
  fs.writeFileSync(output, generatePlansMd(capturePlanSnapshot(r.co, 'head')));
  git(r.co, 'add', 'plans/PLANS.md');
  git(r.co, 'commit', '-qm', 'capture plan index');
  const before = sha(r.co, 'HEAD');
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
    git(r.co, 'update-index', '--assume-unchanged', 'plans/PLANS.md');
    fs.writeFileSync(output, 'private index edit\n');
    return true;
  } }), /Finalization plan index differs from the reviewed revision/);
  assert.equal(sha(r.co, 'HEAD'), before);
  assert.equal(fs.readFileSync(output, 'utf8'), 'private index edit\n');
});

test('finish retains a hook-modified prospective index and blocks retry', async () => {
  const r = repo();
  const common = git(r.co, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const hook = path.join(common, 'hooks/pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "hook index\\n" > plans/PLANS.md\ngit add plans/PLANS.md\n', { mode: 0o755 });
  const target = sha(r.root, 'HEAD');
  let calls = 0;
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => { calls++; return true; } }), /differs from the prepared tree, message or branch/);
  assert.equal(calls, 1);
  assert.equal(sha(r.root, 'HEAD'), target);
  assert.equal(fs.readFileSync(path.join(r.co, 'plans/PLANS.md'), 'utf8'), 'hook index\n');
  fs.unlinkSync(hook);
  const retry = finConfirmed(r);
  assert.equal(retry.code, 1, retry.err);
  assert.match(retry.err, /Pending finalization evidence/);
});


test('structured finish gates distinguish preparation, acceptance and merge while retaining a borrowed lease', async () => {
  const r = repo();
  const lease = acquireWriterLease({ repository: true, plans: [A], checkouts: [r.root, r.co], requestId: 'trusted-finish' });
  const gates: FinishGate[] = [];
  try {
    const initial = sha(r.co, 'HEAD');
    const target = sha(r.root, 'HEAD');
    const result = await finishPlan(A, loadConfig(r.co).config, r.co, {
      lease, confirm: async () => { throw new Error('Manual interaction cannot stand in for the trusted gate.'); },
      confirmGate: async gate => {
        assert.ok(Object.isFrozen(gate));
        assert.equal(gate.planId, A); assert.equal(gate.branch, `plan/${A}`);
        assert.equal(gate.target, 'main'); assert.equal(gate.targetHead, target);
        assert.equal(gate.head, sha(r.co, 'HEAD'));
        gates.push({ ...gate });
        assert.throws(() => acquireWriterLease({ checkouts: [r.root], requestId: 'contender' }), /held/);
        return gate.kind !== 'merge';
      },
    });
    assert.deepEqual(gates.map(gate => gate.kind), ['rebase', 'finish-acceptance', 'merge']);
    assert.equal(gates[0].head, initial);
    assert.match(gates[1].summary, /Exact finalization change:/);
    assert.notEqual(gates[2].head, initial, 'merge uses the newly finalized revision');
    assert.equal(result.outcome, 'ready'); assert.equal(result.finalized, true);
    assert.equal(sha(r.root, 'HEAD'), target);
    lease.assertOwned();
    assert.throws(() => acquireWriterLease({ plans: [A], checkouts: [r.co], requestId: 'after-return' }), /held/);
  } finally { lease.release(); }
  acquireWriterLease({ repository: true, plans: [A], checkouts: [r.root, r.co], requestId: 'after-release' }).release();
});

test('declined or cancelled structured rebase gates leave the reviewed revision unfinalized', async () => {
  for (const cancelled of [false, true]) {
    const r = repo();
    fs.writeFileSync(path.join(r.root, 'advance.txt'), 'advance\n');
    git(r.root, 'add', 'advance.txt'); git(r.root, 'commit', '-qm', 'advance');
    const before = sha(r.co, 'HEAD'), target = sha(r.root, 'HEAD');
    const controller = new AbortController();
    const gates: string[] = [];
    const operation = finishPlan(A, loadConfig(r.co).config, r.co, { signal: controller.signal, confirmGate: async gate => {
      gates.push(gate.kind); assert.equal(gate.kind, 'rebase');
      assert.equal(gate.head, before); assert.equal(gate.targetHead, target);
      if (cancelled) controller.abort();
      return cancelled;
    } });
    if (cancelled) await assert.rejects(operation, /cancelled/);
    else assert.equal((await operation).outcome, 'ready');
    assert.deepEqual(gates, ['rebase']);
    assert.equal(sha(r.co, 'HEAD'), before); assert.equal(sha(r.root, 'HEAD'), target);
    assert.match(fs.readFileSync(path.join(r.co, 'plans', A, 'PLAN.md'), 'utf8'), /status: ready/);
    acquireWriterLease({ repository: true, plans: [A], checkouts: [r.root, r.co], requestId: 'after' }).release();
  }
});

test('finish rejects an incomplete borrowed lease without consuming its ownership', async () => {
  const r = repo();
  const lease = acquireWriterLease({ checkouts: [r.co], requestId: 'incomplete' });
  try {
    let calls = 0;
    await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { lease, confirmGate: async () => { calls++; return true; } }), /every relevant plan and checkout lease/);
    assert.equal(calls, 0); lease.assertOwned();
  } finally { lease.release(); }
});

test('structured finish rebase binds the current checkout inventory after a frontmatter review claim', async () => {
  const r = repo({ planCfg: '  status_source: frontmatter\n' });
  const targetBefore = sha(r.root, 'HEAD');
  const kinds: string[] = [];
  const result = await finishPlan(A, loadConfig(r.co).config, r.co, { confirmGate: async gate => {
    kinds.push(gate.kind);
    assert.equal(gate.targetHead, sha(r.root, 'HEAD'));
    if (gate.kind === 'rebase') {
      assert.notEqual(gate.targetHead, targetBefore);
      assert.match(fs.readFileSync(path.join(r.root, 'plans', A, 'PLAN.md'), 'utf8'), /status: review/);
      return true;
    }
    assert.equal(gate.kind, 'finish-acceptance');
    return false;
  } });
  assert.deepEqual(kinds, ['rebase', 'finish-acceptance']);
  assert.equal(result.outcome, 'ready'); assert.equal(result.finalized, false);
});
