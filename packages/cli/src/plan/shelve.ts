import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../config.js';
import { acquireWriterLease, inspectWriterLease } from '../core/writer-leases.js';
import { PlanStateError } from '../errors.js';
import { generatePlansMd } from '../generate/plans-md.js';
import { cliTrailers, formatMessage, readTrailers } from '../git/commit.js';
import { run } from '../git/exec.js';
import { listWorktrees } from '../git/worktree.js';
import { getPlanActivity, hasRemote, planReport, selectedPlanBranch, targetPlanRecord } from './activity.js';
import { planNext } from './next.js';
import type { Config } from '../types.js';

export interface ShelveReceipt { id: string; operation: 'shelve' | 'resume'; target: string; commit: string | null; checkout: string | null; retry: boolean; dryRun: boolean; effectiveStatus: string | null; next: { number: number; title: string; status: string } | null }
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd }).trim();
const fail = (message: string): never => { throw new PlanStateError(message); };

/** Record a lifecycle transition on the selected integration target. */
export function shelveTransition(id: string, operation: 'shelve' | 'resume', config: Config, root: string, opts: { dryRun?: boolean } = {}): ShelveReceipt {
  const trees = listWorktrees(root);
  const req = { repository: true, plans: [id], checkouts: trees.filter(t => !t.bare).map(t => t.path), requestId: `${operation}-${randomUUID()}` };
  const lease = opts.dryRun ? null : acquireWriterLease(req);
  if (opts.dryRun) inspectWriterLease(req);
  try {
    if (!isDeepStrictEqual(trees, listWorktrees(root))) return fail('Checkout set changed during preparation; retry.');
    const branch = selectedPlanBranch(id, config, root);
    if (!branch) return fail(`Cannot ${operation}: an existing plan branch is required.`);
    const report = planReport(id, config, root, null);
    const record = targetPlanRecord(id, config, root, report);
    if (!record || !report.target_branch) return fail(`Cannot ${operation}: authoritative target record is unavailable.`);
    const target = report.target_branch;
    const admin = trees.find(t => !t.bare && t.branch === target)?.path;
    if (!admin) return fail(`Cannot ${operation}: provide a checkout of target ${target}.`);
    const local = report.ref_freshness.target_local, remote = report.ref_freshness.target_remote;
    if (!local || local !== record.ref || git(admin, 'rev-parse', 'HEAD') !== local) return fail(`Cannot ${operation}: target checkout is stale or unavailable.`);
    const receipt = (commit: string | null, retry: boolean, dryRun: boolean): ShelveReceipt => {
      const checkout = trees.find(t => t.branch === `plan/${id}`)?.path ?? null;
      const activity = getPlanActivity(id, record.config, root, target, branch.ref);
      let effectiveStatus: string | null = operation === 'shelve' ? 'shelved' : null;
      if (!dryRun && operation === 'resume') try { effectiveStatus = planNext(id, record.config, root).effectiveStatus; } catch { /* report unavailable instead of guessing */ }
      return { id, operation, target, commit, checkout, retry, dryRun, effectiveStatus, next: activity.steps.next };
    };
    const transitioned = operation === 'shelve' ? record.data.status === 'shelved' : record.data.status !== 'shelved';
    const trailers = readTrailers(local, admin);
    if (!opts.dryRun && hasRemote(admin) && transitioned && trailers.get('Specplane-Workflow')?.join() === operation && trailers.get('Specplane-Plan')?.join() === id) {
      const parent = git(admin, 'rev-parse', `${local}^`);
      let published: string;
      try { published = git(admin, 'ls-remote', '--heads', 'origin', `refs/heads/${target}`).split(/\s+/)[0]; }
      catch (e) { return fail(`Cannot inspect publication of ${local}: ${String(e)}`); }
      if (published === parent) {
        try { git(admin, 'push', 'origin', `refs/heads/${target}:refs/heads/${target}`); }
        catch (e) { return fail(`Publication pending for ${local}: ${String(e)}`); }
        return receipt(local, true, false);
      }
      if (published !== local) return fail(`Cannot ${operation}: publication of ${local} needs reconciliation.`);
    }
    if (remote && remote !== local) return fail(`Cannot ${operation}: target publication requires reconciliation.`);
    const status = record.data.status;
    const prior = record.data.shelved_from;
    const compatible = (s: unknown) => record.config.plans.status_source === 'git' ? s === 'ready' : s === 'in_progress' || s === 'review';
    if (operation === 'shelve' && (!compatible(status) || ['done', 'abandoned', 'shelved'].includes(String(branch.data.status)))) return fail(`Cannot shelve: target status ${status}, branch status ${branch.data.status}.`);
    if (operation === 'resume' && (status !== 'shelved' || !compatible(prior))) return fail(`Cannot resume: invalid shelving state or status source.`);
    const rel = `${record.config.plans.dir}/${id}/PLAN.md`;
    const index = `${record.config.plans.dir}/PLANS.md`;
    if (git(admin, 'diff', '--cached', '--name-only')) return fail('Cannot record lifecycle transition: index has staged changes.');
    // The generator reads the worktree, so require every administrative input clean,
    // including ignored and untracked files, until snapshot generation is available.
    if (git(admin, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', record.config.plans.dir, '.specplane/config.yaml')) return fail('Cannot record lifecycle transition: administrative inputs are dirty or untracked.');
    const file = path.join(admin, rel), indexFile = path.join(admin, index);
    const original = fs.readFileSync(file, 'utf8');
    if (original !== record.text) return fail('Target plan changed during preparation.');
    const indexOriginal = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
    const m = /^(\uFEFF?---(\r?\n))([\s\S]*?)(\r?\n---(?=\r?\n|$)[\s\S]*)$/.exec(original);
    if (!m || !/^status:[^\r\n]*$/m.test(m[3])) return fail('Cannot safely edit plan frontmatter.');
    let header = m[3].replace(/^status:[^\r\n]*/m, `status: ${operation === 'shelve' ? 'shelved' : prior}`);
    if (operation === 'shelve') header += `${m[2]}shelved_from: ${status}`;
    else header = header.replace(/\r?\n?shelved_from:[^\r\n]*(?=\r?\n|$)/m, '');
    const changed = m[1] + header + m[4];
    let generated: string | null = null;
    let staged: string | null = null;
    if (opts.dryRun) return receipt(null, false, true);
    let committed = false;
    try {
      fs.writeFileSync(file, changed);
      generated = generatePlansMd(record.config, admin);
      fs.writeFileSync(indexFile, generated);
      lease!.assertOwned();
      const otherAdmin = git(admin, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', record.config.plans.dir, '.specplane/config.yaml', `:(exclude)${rel}`, `:(exclude)${index}`);
      if (!isDeepStrictEqual(trees, listWorktrees(root)) || git(admin, 'rev-parse', 'HEAD') !== local || !isDeepStrictEqual(report.ref_freshness, planReport(id, config, root, null).ref_freshness) || otherAdmin || git(admin, 'diff', '--cached', '--name-only') || fs.readFileSync(file, 'utf8') !== changed || fs.readFileSync(indexFile, 'utf8') !== generated) fail('Administrative inputs, index or refs changed during transition; retry.');
      git(admin, 'add', '--', rel, index);
      staged = run('git', ['diff', '--cached', '--binary'], { cwd: admin });
      const files = git(admin, 'diff', '--cached', '--name-only').split('\n').sort();
      if (files.join('\n') !== [index, rel].sort().join('\n') || run('git', ['show', `:${rel}`], { cwd: admin }) !== changed || run('git', ['show', `:${index}`], { cwd: admin }) !== generated || fs.readFileSync(file, 'utf8') !== changed || fs.readFileSync(indexFile, 'utf8') !== generated) fail('Index or administrative files changed during transition; inspect before retrying.');
      git(admin, 'commit', '-m', formatMessage({ type: 'chore', scope: 'specplane', summary: `${operation} ${id}`, trailers: cliTrailers(operation, id) }), '--', rel, index);
      committed = true;
    } catch (error) {
      const head = git(admin, 'rev-parse', 'HEAD');
      if (head !== local) return fail(`Lifecycle commit ${head} was retained after a recording error; inspect and publish it before retrying: ${String(error)}`);
      const currentIndex = run('git', ['diff', '--cached', '--binary'], { cwd: admin });
      const indexSafe = staged === null ? currentIndex === '' : currentIndex === staged;
      const fileSafe = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === changed;
      const generatedSafe = generated === null ? (indexOriginal === null ? !fs.existsSync(indexFile) : fs.existsSync(indexFile) && fs.readFileSync(indexFile).equals(indexOriginal)) : fs.existsSync(indexFile) && fs.readFileSync(indexFile, 'utf8') === generated;
      if (!indexSafe || !fileSafe || !generatedSafe) return fail(`Transition files or index changed concurrently; retained for inspection: ${String(error)}`);
      if (staged !== null) run('git', ['reset', '-q', 'HEAD', '--', rel, index], { cwd: admin });
      fs.writeFileSync(file, original);
      if (indexOriginal === null) fs.rmSync(indexFile, { force: true }); else fs.writeFileSync(indexFile, indexOriginal);
      throw error;
    }
    if (!committed) return fail('Lifecycle transition did not commit.');
    const commit = git(admin, 'rev-parse', 'HEAD');
    if (hasRemote(admin)) try { git(admin, 'push', 'origin', `refs/heads/${target}:refs/heads/${target}`); } catch (e) { return fail(`Publication pending for ${commit}: ${String(e)}`); }
    return receipt(commit, false, false);
  } finally { lease?.release(); }
}
export function transitionFromCheckout(id: string, operation: 'shelve' | 'resume', root: string, opts: { dryRun?: boolean } = {}): ShelveReceipt {
  return shelveTransition(id, operation, loadConfig(root).config, root, opts);
}
