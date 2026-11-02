import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../config.js';
import { acquireWriterLease, inspectWriterLease } from '../core/writer-leases.js';
import { PlanStateError } from '../errors.js';
import { generateWorkingPlansMd } from '../generate/plans-md.js';
import { cliTrailers, formatMessage, readTrailers } from '../git/commit.js';
import { run } from '../git/exec.js';
import { listWorktrees } from '../git/worktree.js';
import { getPlanActivity, hasRemote, lenientFrontmatter, planReport, selectedPlanBranch, targetPlanRecord } from './activity.js';
import { getEffectiveStatus } from './status.js';
import { hasOpenPR } from '../git/forge.js';
import { branchExists, remoteBranchExists } from '../git/branch.js';
import type { Config, PlanFrontmatter } from '../types.js';

export interface ShelveReceipt { id: string; operation: 'shelve' | 'resume'; target: string; commit: string | null; checkout: string | null; retry: boolean; dryRun: boolean; startCommand: string | null; effectiveStatus: string | null; next: { number: number; title: string; status: string } | null }
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd }).trim();
const fail = (message: string): never => { throw new PlanStateError(message); };

/** Interim composition seam: plan-index step 3 must replace this with its snapshot renderer. */
function prospectiveIndex(admin: string, commit: string, config: Config, rel: string, changed: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-transition-'));
  try {
    const names = run('git', ['ls-tree', '-r', '--name-only', '-z', commit, '--', config.plans.dir], { cwd: admin }).split('\0').filter(f => /(?:^|\/)PLAN\.md$/.test(f));
    for (const name of names) {
      const output = path.join(dir, name);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, name === rel ? changed : run('git', ['show', `${commit}:${name}`], { cwd: admin }));
    }
    if (!names.includes(rel)) throw new PlanStateError('Target plan is absent from the committed snapshot.');
    return generateWorkingPlansMd(config, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function transitionText(original: string, operation: 'shelve' | 'resume', status: unknown, prior: unknown): string {
  const m = /^(\uFEFF?---(\r?\n))([\s\S]*?)(\r?\n---(?=\r?\n|$)[\s\S]*)$/.exec(original);
  if (!m || !/^status:[^\r\n]*$/m.test(m[3])) return fail('Cannot safely edit plan frontmatter.');
  let header = m[3].replace(/^status:[^\r\n]*/m, `status: ${operation === 'shelve' ? 'shelved' : prior}`);
  if (operation === 'shelve') header += `${m[2]}shelved_from: ${status}`;
  else header = header.replace(/\r?\n?shelved_from:[^\r\n]*(?=\r?\n|$)/m, '');
  const changed = m[1] + header + m[4];
  return changed;
}

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
    if (!local || local !== record.ref || git(admin, 'rev-parse', 'HEAD') !== local || git(admin, 'symbolic-ref', '--short', 'HEAD') !== target) return fail(`Cannot ${operation}: target checkout is stale or unavailable.`);
    const verifyFinal = (expectedTarget: string) => {
      lease!.assertOwned();
      const fresh = planReport(id, config, root, null).ref_freshness;
      const expected = { ...report.ref_freshness, target_local: expectedTarget };
      if (!isDeepStrictEqual(expected, fresh) || git(admin, 'rev-parse', 'HEAD') !== expectedTarget || git(admin, 'symbolic-ref', '--short', 'HEAD') !== target || !isDeepStrictEqual(trees.map(t => [t.path, t.branch, t.bare]), listWorktrees(root).map(t => [t.path, t.branch, t.bare]))) fail('Target, plan refs, checkout or lease changed; inspect before retrying.');
    };
    const receipt = (commit: string | null, retry: boolean, dryRun: boolean): ShelveReceipt => {
      const checkout = trees.find(t => t.branch === `plan/${id}`)?.path ?? null;
      const activity = getPlanActivity(id, record.config, root, target, branch.ref);
      let effectiveStatus: string = 'shelved';
      if (operation === 'resume') {
        const restored = { ...record.data, status: record.data.status === 'shelved' ? record.data.shelved_from : record.data.status } as unknown as PlanFrontmatter;
        const dependencies = new Map<string, PlanFrontmatter>();
        for (const dep of restored.depends_on ?? []) {
          const dependency = targetPlanRecord(dep, record.config, root, report);
          if (dependency) dependencies.set(dep, dependency.data as unknown as PlanFrontmatter);
        }
        effectiveStatus = getEffectiveStatus(restored, dependencies, record.config, {
          branchExists: pid => branchExists(`plan/${pid}`, root) || remoteBranchExists(`plan/${pid}`, root),
          hasOpenPr: pid => hasOpenPR(`plan/${pid}`, { cwd: root, forge: record.config.plans.forge, base: target }),
        });
      }
      return { id, operation, target, commit, checkout, retry, dryRun, startCommand: operation === 'resume' && !checkout ? `specplane plan start ${id}` : null, effectiveStatus, next: activity.steps.next };
    };
    const rel = `${record.config.plans.dir}/${id}/PLAN.md`;
    const index = `${record.config.plans.dir}/PLANS.md`;
    const file = path.join(admin, rel), indexFile = path.join(admin, index);
    if (git(admin, 'diff', '--cached', '--name-only')) return fail('Cannot record lifecycle transition: index has staged changes.');
    if (git(admin, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', record.config.plans.dir, '.specplane/config.yaml')) return fail('Cannot record lifecycle transition: administrative inputs are dirty or untracked.');
    if (['done', 'abandoned', 'shelved'].includes(String(branch.data.status))) return fail(`Cannot ${operation}: plan branch is terminal or shelved.`);
    const transitioned = operation === 'shelve' ? record.data.status === 'shelved' : record.data.status !== 'shelved';
    const trailers = readTrailers(local, admin);
    if (hasRemote(admin) && transitioned && trailers.get('Specplane-Workflow')?.join() === operation && trailers.get('Specplane-Plan')?.join() === id) {
      const parent = git(admin, 'rev-parse', `${local}^`);
      let published: string;
      try { published = git(admin, 'ls-remote', '--heads', 'origin', `refs/heads/${target}`).split(/\s+/)[0]; }
      catch (e) { return fail(`Cannot inspect publication of ${local}: ${String(e)}`); }
      if (published === parent) {
        const previousText = run('git', ['show', `${parent}:${rel}`], { cwd: admin });
        const previous = lenientFrontmatter(previousText);
        const compatiblePrevious = operation === 'shelve' ? (record.config.plans.status_source === 'git' ? previous?.status === 'ready' : ['in_progress', 'review'].includes(String(previous?.status))) : previous?.status === 'shelved' && (record.config.plans.status_source === 'git' ? previous?.shelved_from === 'ready' : ['in_progress', 'review'].includes(String(previous?.shelved_from)));
        const expected: Record<string, unknown> = operation === 'shelve' ? { ...previous, status: 'shelved', shelved_from: previous?.status } : { ...previous, status: previous?.shelved_from };
        if (operation === 'resume') delete expected.shelved_from;
        const paths = git(admin, 'diff-tree', '--no-commit-id', '--name-only', '-r', local).split('\n').sort();
        const expectedIndex = prospectiveIndex(admin, local, record.config, rel, record.text);
        if (git(admin, 'rev-list', '--parents', '-n', '1', local).split(' ').length !== 2 || !compatiblePrevious || transitionText(previousText, operation, previous?.status, previous?.shelved_from) !== record.text || !isDeepStrictEqual(expected, record.data) || paths.join('\n') !== [index, rel].sort().join('\n') || run('git', ['show', `${local}:${index}`], {cwd: admin}) !== expectedIndex || !isDeepStrictEqual(trees, listWorktrees(root)) || !isDeepStrictEqual(report.ref_freshness, planReport(id, config, root, null).ref_freshness)) return fail(`Cannot ${operation}: retained transition ${local} failed authentication.`);
        if (opts.dryRun) return receipt(local, true, true);
        try { verifyFinal(local); git(admin, 'push', `--force-with-lease=refs/heads/${target}:${parent}`, 'origin', `${local}:refs/heads/${target}`); }
        catch (e) { return fail(`Publication pending for ${local}: ${String(e)}`); }
        return receipt(local, true, false);
      }
      if (published !== local) return fail(`Cannot ${operation}: publication of ${local} needs reconciliation.`);
    }
    if (remote && remote !== local) return fail(`Cannot ${operation}: target publication requires reconciliation.`);
    if (hasRemote(admin)) {
      const published = git(admin, 'ls-remote', '--heads', 'origin', `refs/heads/${target}`).split(/\s+/)[0];
      if (published !== local) return fail(`Cannot ${operation}: target publication requires reconciliation.`);
    }
    const status = record.data.status;
    const prior = record.data.shelved_from;
    const compatible = (s: unknown) => record.config.plans.status_source === 'git' ? s === 'ready' : s === 'in_progress' || s === 'review';
    if (operation === 'shelve' && (!compatible(status) || ['done', 'abandoned', 'shelved'].includes(String(branch.data.status)))) return fail(`Cannot shelve: target status ${status}, branch status ${branch.data.status}.`);
    if (operation === 'resume' && (status !== 'shelved' || !compatible(prior))) return fail(`Cannot resume: invalid shelving state or status source.`);
    const original = fs.readFileSync(file, 'utf8');
    if (original !== record.text) return fail('Target plan changed during preparation.');
    const indexOriginal = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
    const changed = transitionText(original, operation, status, prior);
    const generated = prospectiveIndex(admin, local, record.config, rel, changed);
    let staged: string | null = null;
    if (opts.dryRun) return receipt(null, false, true);
    let committed = false, created: string | null = null;
    let planAttempted = false, planWritten = false, indexWritten = false;
    try {
      if (fs.readFileSync(file, 'utf8') !== original || (indexOriginal === null ? fs.existsSync(indexFile) : !fs.existsSync(indexFile) || !fs.readFileSync(indexFile).equals(indexOriginal)) || git(admin, 'diff', '--cached', '--name-only')) fail('Administrative inputs or index changed before writing; retry.');
      planAttempted = true;
      fs.writeFileSync(file, changed);
      planWritten = true;
      fs.writeFileSync(indexFile, generated);
      indexWritten = true;
      lease!.assertOwned();
      const otherAdmin = git(admin, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', record.config.plans.dir, '.specplane/config.yaml', `:(exclude)${rel}`, `:(exclude)${index}`);
      if (!isDeepStrictEqual(trees, listWorktrees(root)) || git(admin, 'rev-parse', 'HEAD') !== local || !isDeepStrictEqual(report.ref_freshness, planReport(id, config, root, null).ref_freshness) || otherAdmin || git(admin, 'diff', '--cached', '--name-only') || fs.readFileSync(file, 'utf8') !== changed || fs.readFileSync(indexFile, 'utf8') !== generated) fail('Administrative inputs, index or refs changed during transition; retry.');
      git(admin, 'add', '--', rel, index);
      staged = run('git', ['diff', '--cached', '--binary'], { cwd: admin });
      const files = git(admin, 'diff', '--cached', '--name-only').split('\n').sort();
      if (files.join('\n') !== [index, rel].sort().join('\n') || run('git', ['show', `:${rel}`], { cwd: admin }) !== changed || run('git', ['show', `:${index}`], { cwd: admin }) !== generated || fs.readFileSync(file, 'utf8') !== changed || fs.readFileSync(indexFile, 'utf8') !== generated) fail('Index or administrative files changed during transition; inspect before retrying.');
      const format = git(admin, 'rev-parse', '--show-object-format');
      const oidLength = format === 'sha1' ? 40 : format === 'sha256' ? 64 : fail(`Unsupported Git object format: ${format}.`);
      const output = run('git', ['-c', `core.abbrev=${oidLength}`, 'commit', '-m', formatMessage({ type: 'chore', scope: 'specplane', summary: `${operation} ${id}`, trailers: cliTrailers(operation, id) }), '--', rel, index], { cwd: admin });
      committed = true;
      // Git prints its commit summary after hooks, which may themselves write to stdout.
      const candidate = [...output.matchAll(new RegExp(`^\\[[^\\n]* ([0-9a-f]{${oidLength}})\\]`, 'gm'))].at(-1)?.[1];
      if (candidate && git(admin, 'rev-parse', '--verify', `${candidate}^{commit}`) === candidate) created = candidate;
      if (!created) fail('Commit succeeded but its identity could not be determined; inspect the reflog.');
      const head = git(admin, 'rev-parse', 'HEAD');
      verifyFinal(created!);
      const parents = git(admin, 'rev-list', '--parents', '-n', '1', head).split(' ');
      if (parents.length !== 2 || parents[1] !== local || run('git', ['show', `${head}:${rel}`], {cwd: admin}) !== changed || run('git', ['show', `${head}:${index}`], {cwd: admin}) !== generated || git(admin, 'diff-tree', '--no-commit-id', '--name-only', '-r', head).split('\n').sort().join('\n') !== [index, rel].sort().join('\n') || git(admin, 'diff', '--cached', '--name-only') || git(admin, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', record.config.plans.dir, '.specplane/config.yaml', `:(exclude)${rel}`, `:(exclude)${index}`) || !isDeepStrictEqual(trees.map(t => [t.path, t.branch, t.bare]), listWorktrees(root).map(t => [t.path, t.branch, t.bare])) || fs.readFileSync(file, 'utf8') !== changed || fs.readFileSync(indexFile, 'utf8') !== generated) fail(`Lifecycle commit ${head} or administrative state changed during hooks; retained for inspection.`);
    } catch (error) {
      const head = git(admin, 'rev-parse', 'HEAD');
      if (committed || head !== local) return fail(`Lifecycle commit ${created ?? 'identity unavailable'} was retained after a recording error (current HEAD ${head}); inspect refs and recovery state before retrying: ${String(error)}`);
      const currentIndex = run('git', ['diff', '--cached', '--binary'], { cwd: admin });
      const indexSafe = staged === null ? currentIndex === '' : currentIndex === staged;
      const fileSafe = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === changed;
      const outputSafe = fs.existsSync(indexFile) && fs.readFileSync(indexFile, 'utf8') === generated;
      const outputOriginal = indexOriginal === null ? !fs.existsSync(indexFile) : fs.existsSync(indexFile) && fs.readFileSync(indexFile).equals(indexOriginal);
      if (staged !== null && indexSafe) run('git', ['reset', '-q', 'HEAD', '--', rel, index], { cwd: admin });
      if (planWritten && fileSafe) fs.writeFileSync(file, original);
      if (indexWritten && outputSafe) { if (indexOriginal === null) fs.rmSync(indexFile, { force: true }); else fs.writeFileSync(indexFile, indexOriginal); }
      if (!indexSafe || (planWritten ? !fileSafe : planAttempted && (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== original)) || (indexWritten ? !outputSafe : !outputOriginal)) return fail(`Transition files or index changed or were partially written; ambiguous bytes retained for inspection: ${String(error)}`);
      throw error;
    }
    if (!committed) return fail('Lifecycle transition did not commit.');
    const commit = created!;
    try { verifyFinal(commit); if (hasRemote(admin)) git(admin, 'push', `--force-with-lease=refs/heads/${target}:${local}`, 'origin', `${commit}:refs/heads/${target}`); } catch (e) { return fail(`Publication pending for ${commit}, or final verification failed; commit retained: ${String(e)}`); }
    return receipt(commit, false, false);
  } finally { lease?.release(); }
}
export function transitionFromCheckout(id: string, operation: 'shelve' | 'resume', root: string, opts: { dryRun?: boolean } = {}): ShelveReceipt {
  return shelveTransition(id, operation, loadConfig(root).config, root, opts);
}
