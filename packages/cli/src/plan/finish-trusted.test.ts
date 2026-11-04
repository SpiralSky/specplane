import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { prepareConfirmation, confirmOperation, confirmOperationAsync } from "../core/index.js";
import { acquireWriterLease } from "../core/writer-leases.js";
import type { ConfirmationChallenge, CoreContext } from "../core/contracts.js";
import { createFinishFixture } from "./finish-fixture.js";

const { git, A, repo, sha } = createFinishFixture();
const request = { operation: "plan.finish", arguments: { id: A } } as const;
const FM = "  status_source: frontmatter\n";

function host(checkout: string, decide: (c: ConfirmationChallenge, shown: ConfirmationChallenge[]) => "confirm" | "decline" | Error) {
  const shown: ConfirmationChallenge[] = [];
  const responses = new Map<string, { challengeId: string; decision: "confirm" | "decline"; interactionId: string }>();
  const context: CoreContext = { checkout, extensionId: "test", interaction: { async confirm(challenge) {
    shown.push(structuredClone(challenge));
    const d = decide(challenge, shown);
    if (d instanceof Error) throw d;
    const response = { challengeId: challenge.challengeId, decision: d, interactionId: "direct-human-event" };
    responses.set(challenge.challengeId, response);
    return response;
  } } };
  return { context, shown, response: (c: ConfirmationChallenge) => responses.get(c.challengeId)! };
}
const contended = (r: { root: string; co: string }) => () => acquireWriterLease({ repository: true, plans: [A], checkouts: [r.root, r.co], requestId: "contender" });

test("trusted finish consents to preparation before the frontmatter review claim, then asks each later gate afresh", async () => {
  const r = repo({ remote: true, planCfg: FM });
  const targetBefore = sha(r.root, "HEAD");
  const h = host(r.co, c => (c.operation === "plan.finish:finish-acceptance" ? "decline" : "confirm"));
  const prepared = await prepareConfirmation(request, h.context);
  assert.equal(prepared.ok, true, JSON.stringify(prepared)); if (!prepared.ok) return;
  assert.equal(prepared.value.operation, "plan.finish");
  assert.match(prepared.value.summary, /preparation only/);
  assert.equal(sha(r.root, "HEAD"), targetBefore, "no claim or publication before the response is consumed");
  assert.throws(contended(r), /held/);
  assert.equal(confirmOperation(prepared.value, h.response(prepared.value), h.context).ok, false, "synchronous confirmation cannot settle an async operation");
  const result = await confirmOperationAsync(prepared.value, h.response(prepared.value), h.context);
  assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) return;
  assert.deepEqual(h.shown.map(c => c.operation), ["plan.finish", "plan.finish:rebase", "plan.finish:finish-acceptance"]);
  assert.equal(new Set(h.shown.map(c => c.challengeId)).size, 3);
  assert.notEqual(sha(r.root, "HEAD"), targetBefore, "review claim followed the preparation consent");
  assert.match(fs.readFileSync(path.join(r.root, "plans", A, "PLAN.md"), "utf8"), /status: review/);
  assert.equal(git(r.origin, "rev-parse", "main"), sha(r.root, "HEAD"), "claim was published");
  assert.match(result.value.notices[0].message, /ready/);
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
  contended(r)().release();
  assert.equal((await confirmOperationAsync(prepared.value, h.response(prepared.value), h.context)).ok, false, "challenge is single use");
});

test("declining a later gate settles as ready and releases the complete lease set", async () => {
  const r = repo({ planCfg: FM });
  const h = host(r.co, c => (c.operation === "plan.finish:rebase" ? "decline" : "confirm"));
  const prepared = await prepareConfirmation(request, h.context);
  assert.equal(prepared.ok, true); if (!prepared.ok) return;
  const result = await confirmOperationAsync(prepared.value, h.response(prepared.value), h.context);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(h.shown.map(c => c.operation), ["plan.finish", "plan.finish:rebase"]);
  contended(r)().release();
});

test("target movement between preparation consent and confirmation refuses before any claim and releases the lease", async () => {
  const r = repo({ remote: true, planCfg: FM });
  const h = host(r.co, () => "confirm");
  const prepared = await prepareConfirmation(request, h.context);
  assert.equal(prepared.ok, true); if (!prepared.ok) return;
  fs.writeFileSync(path.join(r.root, "moved.txt"), "x\n");
  git(r.root, "add", "moved.txt"); git(r.root, "commit", "-q", "-m", "move target");
  const moved = sha(r.root, "HEAD");
  const result = await confirmOperationAsync(prepared.value, h.response(prepared.value), h.context);
  assert.equal(result.ok, false);
  assert.equal(sha(r.root, "HEAD"), moved);
  assert.equal(h.shown.length, 1);
  contended(r)().release();
});

test("an uncertain asynchronous failure retains the lease and cannot be replayed", async () => {
  const r = repo({ planCfg: FM });
  const h = host(r.co, c => (c.operation === "plan.finish:rebase" ? new Error("host interaction failed") : "confirm"));
  const prepared = await prepareConfirmation(request, h.context);
  assert.equal(prepared.ok, true); if (!prepared.ok) return;
  const result = await confirmOperationAsync(prepared.value, h.response(prepared.value), h.context);
  assert.equal(result.ok, false);
  assert.throws(contended(r), /held/, "lease stays held for inspection");
  assert.equal((await confirmOperationAsync(prepared.value, h.response(prepared.value), h.context)).ok, false);
  assert.equal(h.shown.length, 2);
});

test("trusted finish without a trusted interaction port, or from the wrong checkout, refuses before any lease or write", async () => {
  const r = repo({ planCfg: FM });
  assert.equal((await prepareConfirmation(request, { checkout: r.co, extensionId: "test" })).ok, false);
  const h = host(r.root, () => "confirm");
  assert.equal((await prepareConfirmation(request, h.context)).ok, false);
  assert.equal(h.shown.length, 0);
  contended(r)().release();
});

test("an unpublished review claim needs its own preparation consent before publication, and declining publishes nothing", async () => {
  const r = repo({ remote: true, planCfg: FM });
  const first = host(r.co, c => (c.operation === "plan.finish:rebase" ? "decline" : "confirm"));
  const p1 = await prepareConfirmation(request, first.context);
  assert.equal(p1.ok, true); if (!p1.ok) return;
  assert.equal((await confirmOperationAsync(p1.value, first.response(p1.value), first.context)).ok, true);
  const claim = sha(r.root, "HEAD");
  const parent = git(r.root, "rev-parse", "HEAD~1");
  assert.equal(git(r.origin, "rev-parse", "main"), claim);
  git(r.origin, "update-ref", "refs/heads/main", parent); // the claim is committed locally but not published
  contended(r)().release();

  const declined = host(r.co, () => "decline");
  const p2 = await prepareConfirmation(request, declined.context);
  assert.equal(p2.ok, false, "declining the preparation consent refuses the operation");
  assert.deepEqual(declined.shown.map(c => c.operation), ["plan.finish"], "preparation is the only question asked");
  assert.match(declined.shown[0].summary, /preparation only/);
  assert.equal(git(r.origin, "rev-parse", "main"), parent, "declined preparation published nothing");
  assert.equal(sha(r.root, "HEAD"), claim);
  contended(r)().release();

  const accepted = host(r.co, c => (c.operation === "plan.finish:rebase" ? "decline" : "confirm"));
  const p3 = await prepareConfirmation(request, accepted.context);
  assert.equal(p3.ok, true); if (!p3.ok) return;
  assert.equal((await confirmOperationAsync(p3.value, accepted.response(p3.value), accepted.context)).ok, true);
  assert.equal(accepted.shown[0].operation, "plan.finish");
  assert.equal(git(r.origin, "rev-parse", "main"), claim, "consented preparation published the pending claim");
  contended(r)().release();
});
