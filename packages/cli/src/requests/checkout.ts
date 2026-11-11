import * as fs from "node:fs";
import { loadSettings } from "../config.js";
import { findPlan, PLAN_ID_RE } from "../plan/model.js";
import { worktreeSource } from "../spec/source.js";
import * as path from "node:path";
import { run } from "../git/exec.js";
import { checkoutRoot } from "../git/repo.js";
import { listWorktrees } from "../git/worktree.js";
import { RequestStateError, type RequestRecord } from "./store.js";

const git = (root: string, args: string[]) => run("git", args, { cwd: root }).trim();
const canonical = (p: string) => fs.realpathSync(p);
function hasPlan(root: string, id: string): boolean {
  const dir = path.relative(root, loadSettings(root).config.abs.plans).split(path.sep).join("/");
  const rec = findPlan(worktreeSource(root), dir, id);
  return !!rec?.planText && rec.fm?.data?.id === `plan/${id}` && !rec.legacy;
}
const common = (root: string) => canonical(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));

/** Only actual registered plan branches imply execution context, never an action's target ID. */
export function requestContext(root: string, explicit?: string | null): { plan: string | null; checkout: string | null } {
  const branch = git(root, ["branch", "--show-current"]);
  const inferred = branch.startsWith("plan/") && listWorktrees(root).some((w) => w.branch === branch && canonical(w.path) === canonical(checkoutRoot(root))) ? branch.slice(5) : null;
  const plan = explicit ?? (inferred && hasPlan(root, inferred) ? inferred : null);
  if (!plan) return { plan: null, checkout: null };
  const checkout = destination(root, plan, null);
  return { plan, checkout };
}

function destination(root: string, plan: string, recorded: string | null): string {
  if (!PLAN_ID_RE.test(plan) || plan.length > 64) throw new RequestStateError(`Invalid plan ID: ${plan}.`);
  const listed = listWorktrees(root).find((w) => w.branch === `plan/${plan}`);
  const expected = listed?.path ?? recorded ?? `plan/${plan} (no registered worktree)`;
  const refuse = (): never => { throw new RequestStateError(`Plan \`${plan}\` worktree ${expected} is missing or no longer registered for this repository and branch. The request stays pending.`); };
  if (!listed || !fs.existsSync(listed.path)) return refuse();
  try {
    const live = canonical(listed.path);
    if (canonical(checkoutRoot(live)) !== live || common(root) !== common(live) || git(live, ["branch", "--show-current"]) !== `plan/${plan}` || !hasPlan(live, plan)) return refuse();
    // Git's live registration wins over a stale saved path after `git worktree move`.
    return live;
  } catch { return refuse(); }
}

export function requestRoot(root: string, rec: Pick<RequestRecord, "plan" | "checkout" | "base" | "action">): string {
  if (!rec.plan) {
    if (rec.checkout) throw new RequestStateError("A request checkout requires a plan. The request stays pending.");
    return root;
  }
  // Old plan commands used plan as the action target even outside a plan session.
  if (rec.checkout === undefined && rec.base.branch !== `plan/${rec.plan}`) {
    if (rec.action.command.startsWith("plan ")) return root;
    throw new RequestStateError(`Legacy request for plan \`${rec.plan}\` has no verified checkout context. Decline and resend it from the plan worktree. The request stays pending.`);
  }
  return destination(root, rec.plan, rec.checkout ?? null);
}
