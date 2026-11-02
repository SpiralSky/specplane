import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as yaml from 'js-yaml';
import { parseConfigText, CONFIG_PATH } from '../config.js';
import { acquireWriterLease, inspectWriterLease } from '../core/writer-leases.js';
import { PlanStateError } from '../errors.js';
import { run } from '../git/exec.js';
import { checkoutRoot, mainRoot } from '../git/repo.js';
import { listWorktrees } from '../git/worktree.js';
import { lenientFrontmatter } from './activity.js';
import { resolvePlanContext, validateExecutionBinding, validatePlanBranches } from './context.js';
import { checkStackTarget, recheckLifecycleRefs } from './lifecycle-context.js';
import { configAt, planAt, samePaths, snapshot, specAt } from './prepare-start.js';
import { PLAN_SCHEMA, SPEC_COMMON_SCHEMA, SPEC_FEATURE_SCHEMA, SPEC_ARCHITECTURE_SCHEMA, validator } from '../schemas.js';

export interface RetargetReceipt {
 id: string; old_target: string; new_target: string; start_target_branch: string; start_base: string;
 comparison_base: string | null; changed_files: { path: string; before: string; after: string }[];
 changed: boolean; dry_run: boolean; committed: false;
}
const fail = (message: string): never => { throw new PlanStateError(message); };
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const git = (cwd: string, ...args: string[]) => run('git', ['--no-optional-locks', ...args], { cwd }).trim();
const ref = (cwd: string, name: string): string | null => { try { return git(cwd, 'rev-parse', '--verify', '--quiet', `${name}^{commit}`); } catch { return null; } };

/** Safely change only the explicit block-form binding. Unsupported YAML layouts
 * fail closed instead of rewriting comments or unrelated source. */
export function retargetFrontmatter(text: string, old: string, target: string): string {
 const match = /^(\uFEFF?---(\r?\n))([\s\S]*?)(\r?\n---(?=\r?\n|$)[\s\S]*)$/.exec(text);
 if (!match) return fail('Cannot safely edit plan frontmatter.');
 const newline = match[2];
 if (newline === '\r\n' ? /(?<!\r)\n/.test(match[3]) : /\r\n/.test(match[3])) return fail('Cannot safely edit mixed frontmatter line endings.');
 const eol = '\n'; let header = match[3].replace(/\r\n/g, '\n');
 const blocks = [...header.matchAll(/^execution:[ \t]*(?:#.*)?$/gm)];
 if (blocks.length !== 1 || /^  target_changes:[ \t]*\[(?![ \t]*\])/m.test(header)) {
   type Node = { start: number; end: number; value: unknown; kind: string | null; children: Node[] };
   const stack: Node[] = []; let tree: Node | undefined;
   yaml.load(header, { schema: yaml.JSON_SCHEMA, listener(event, state) {
     if (event === 'open') stack.push({ start: state.position, end: state.position, value: undefined, kind: null, children: [] });
     else { const node = stack.pop()!; node.end = state.position; node.value = state.result; node.kind = state.kind; if (stack.length) stack[stack.length - 1].children.push(node); else tree = node; }
   } });
   if (!tree) return fail('Cannot locate plan metadata.');
   let root: Node = tree; while (root.children.length === 1 && root.children[0].kind === 'mapping') root = root.children[0];
   const valueOf = (node: Node, key: string): Node | undefined => { const i = node.children.findIndex((c, n) => n % 2 === 0 && c.value === key); return i < 0 ? undefined : node.children[i + 1]; };
   const binding = valueOf(root, 'execution'); const current = binding && valueOf(binding, 'target_branch');
   if (!binding || binding.kind !== 'mapping' || !current || current.kind !== 'scalar') return fail('Cannot safely edit execution binding layout.');
   const edits: { start: number; end: number; text: string }[] = [];
   const replaceScalar = (node: Node) => { const raw = header.slice(node.start, node.end); const leading = /^\s*/.exec(raw)![0]; const trailing = /\s*$/.exec(raw)![0]; edits.push({ start: node.start, end: node.end, text: leading + JSON.stringify(target) + trailing }); };
   replaceScalar(current);
   const declared = valueOf(root, 'target_branch'); if (declared) { if (declared.kind !== 'scalar') return fail('Cannot safely edit target declaration.'); replaceScalar(declared); }
   const history = valueOf(binding, 'target_changes'); const entry = `{from: ${JSON.stringify(old)}, to: ${JSON.stringify(target)}}`;
   if (history) {
     const raw = header.slice(history.start, history.end); const open = raw.indexOf('['), close = raw.lastIndexOf(']');
     if (history.kind !== 'sequence' || open < 0 || close < open) return fail('Cannot safely edit target history layout.');
     edits.push({ start: history.start + close, end: history.start + close, text: `${(history.value as unknown[]).length ? ', ' : ''}${entry}` });
   } else {
     const raw = header.slice(binding.start, binding.end); const close = raw.lastIndexOf('}'); if (!raw.trimStart().startsWith('{') || close < 0) return fail('Cannot locate binding end.');
     edits.push({ start: binding.start + close, end: binding.start + close, text: `, target_changes: [${entry}]` });
   }
   for (const edit of edits.sort((a, b) => b.start - a.start)) header = header.slice(0, edit.start) + edit.text + header.slice(edit.end);
   const result = match[1] + (newline === '\r\n' ? header.replace(/\n/g, '\r\n') : header) + match[4];
   const before = lenientFrontmatter(text), after = lenientFrontmatter(result);
   if (!before || !after || !validator(PLAN_SCHEMA)(after)) return fail('Edited plan metadata is invalid.');
   const expected = structuredClone(before) as any; expected.execution.target_branch = target; expected.execution.target_changes = [...(expected.execution.target_changes ?? []), { from: old, to: target }];
   if (Object.hasOwn(expected, 'target_branch')) expected.target_branch = target;
   if (!isDeepStrictEqual(expected, after)) return fail('Cannot preserve unrelated plan metadata.');
   return result;
 }
 const start = blocks[0].index! + blocks[0][0].length;
 const tail = header.slice(start); const next = /\r?\n(?=\S)/.exec(tail);
 const end = next ? start + next.index : header.length;
 let block = header.slice(start, end);
 const targets = [...block.matchAll(/^  target_branch:[^\r\n]*$/gm)];
 if (targets.length !== 1) return fail('Cannot safely edit execution target layout.');
 block = block.replace(/^  target_branch:[^\r\n]*$/m, line => `  target_branch: ${JSON.stringify(target)}${/\s+#.*$/.exec(line)?.[0] ?? ''}`);
 const changes = [...block.matchAll(/^  target_changes:[ \t]*(?:#.*)?$/gm)];
 if (changes.length > 1) return fail('Cannot safely edit target history layout.');
 const entry = `${eol}    - from: ${JSON.stringify(old)}${eol}      to: ${JSON.stringify(target)}`;
 if (changes.length) {
   const i = changes[0].index! + changes[0][0].length;
   const after = block.slice(i); const nextKey = /\r?\n(?=  \S)/.exec(after);
   const at = nextKey ? i + nextKey.index : block.length;
   block = block.slice(0, at) + entry + block.slice(at);
 } else if (/^  target_changes:[ \t]*\[[ \t]*\][ \t]*(?:#.*)?$/m.test(block)) {
   block = block.replace(/^  target_changes:[ \t]*\[[ \t]*\]([ \t]*(?:#.*)?)$/m, (_line, comment: string) => `  target_changes:${comment}${entry}`);
 } else if (/^  target_changes:/m.test(block)) return fail('Cannot safely edit target history layout.');
 else block += `${eol}  target_changes:${entry}`;
 header = header.slice(0, start) + block + header.slice(end);
 const declarations = [...header.matchAll(/^target_branch:[^\r\n]*$/gm)];
 if (declarations.length > 1) return fail('Cannot safely edit target declaration.');
 if (declarations.length) header = header.replace(/^target_branch:[^\r\n]*$/m, line => `target_branch: ${JSON.stringify(target)}${/\s+#.*$/.exec(line)?.[0] ?? ''}`);
 const result = match[1] + (newline === '\r\n' ? header.replace(/\n/g, '\r\n') : header) + match[4];
 const before = lenientFrontmatter(text), after = lenientFrontmatter(result);
 if (!before || !after || !validator(PLAN_SCHEMA)(after)) return fail('Edited plan metadata is invalid.');
 const expected = structuredClone(before) as any;
 expected.execution.target_branch = target;
 expected.execution.target_changes = [...(expected.execution.target_changes ?? []), { from: old, to: target }];
 if (Object.hasOwn(expected, 'target_branch')) expected.target_branch = target;
 if (!isDeepStrictEqual(expected, after)) return fail('Cannot preserve unrelated plan metadata.');
 return result;
}

export function retargetPlan(input: { id: string; target: string; dryRun?: boolean }, cwd: string, options: { signal?: AbortSignal; beforeRecheck?: () => void } = {}): RetargetReceipt {
 const { id, target } = input;
 if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return fail('Invalid plan ID.');
 const root = fs.realpathSync(checkoutRoot(cwd)); const main = mainRoot(root);
 const trees = listWorktrees(main); const branch = `plan/${id}`;
 if (!trees.some(t => !t.bare && t.branch === branch && fs.realpathSync(t.path) === root) || git(root, 'symbolic-ref', '--short', 'HEAD') !== branch) return fail('Retarget requires the exact registered plan checkout.');
 const plans = git(root, 'for-each-ref', '--format=%(refname)', 'refs/heads/plan/', 'refs/remotes/origin/plan/').split('\n').map(s => s.replace(/^refs\/(?:heads|remotes\/origin)\/plan\//, '')).filter(Boolean);
 const req = { repository: true, plans: [id, ...plans], checkouts: trees.filter(t => !t.bare).map(t => t.path), requestId: `retarget-${randomUUID()}` };
 if (input.dryRun) inspectWriterLease(req);
 const lease = input.dryRun ? null : acquireWriterLease(req);
 try {
  if (options.signal?.aborted) return fail('Operation aborted.');
  const configText = fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8');
  const config = parseConfigText(configText, root).config;
  const refs: Record<string, string | null> = {};
  const capture = (n: string) => refs[n] = ref(root, n);
  const local = capture(`refs/heads/${branch}`), remote = capture(`refs/remotes/origin/${branch}`);
  const selected = validatePlanBranches(root, id, { local: snapshot(root, local, id, config), remote: snapshot(root, remote, id, config) });
  if (!local || !selected || selected.commit !== local || !selected.binding || ref(root, 'HEAD') !== local) return fail('Recorded local plan context is unavailable or stale.');
  const plan = planAt(root, local, config, id)!; const binding = selected.binding;
  validateExecutionBinding(root, id, binding, plan.target_branch);
  const destination = resolvePlanContext(root, { id, explicit: target });
  const lifecycle = (status: string) => ['ready', 'in_progress', 'review'].includes(status) ? 'active' : status;
  for (const name of [binding.target_branch, target]) { capture(`refs/heads/${name}`); capture(`refs/remotes/origin/${name}`); }
  const oldAvailable = refs[`refs/heads/${binding.target_branch}`] || refs[`refs/remotes/origin/${binding.target_branch}`];
  const old = oldAvailable ? resolvePlanContext(root, { id, explicit: binding.target_branch }) : null;
  const records = [destination.targetCommit, ...(old ? [old.targetCommit] : [])].map(commit => {
    const cfg = configAt(root, commit); if (!samePaths(config, cfg)) return fail('Conflicting target configuration paths.');
    const p = planAt(root, commit, cfg, id); if (!p) return fail('Target plan record is unavailable.');
    if (p.comparison_base !== plan.comparison_base || p.execution && !isDeepStrictEqual(p.execution, binding)) return fail('Conflicting target execution provenance.');
    if (lifecycle(p.status) !== lifecycle(plan.status)) return fail('Conflicting target lifecycle state.');
    return { p, cfg, commit };
  });
  const identityMatches = (p: typeof plan) => p.id === plan.id && p.title === plan.title && isDeepStrictEqual(p.specs, plan.specs) && isDeepStrictEqual(p.depends_on ?? [], plan.depends_on ?? []) && p.comparison_base === plan.comparison_base;
  if (records.some(({ p }) => !identityMatches(p))) return fail('Conflicting plan identity or dependencies.');
  if (old && records[1].p.target_branch && records[1].p.target_branch !== binding.target_branch) return fail('Old target declaration conflicts with recorded target.');
  if (!old) {
    const historicalConfig = configAt(root, binding.start_base);
    const historical = samePaths(config, historicalConfig) ? planAt(root, binding.start_base, historicalConfig, id) : null;
    if (!historical || !identityMatches(historical) || lifecycle(historical.status) !== lifecycle(plan.status)) return fail('Missing old target and insufficient identity or lifecycle evidence.');
  }
  if (!['ready', 'in_progress', 'review'].includes(plan.status)) return fail('Plan lifecycle state does not permit retargeting.');
  const dest = records[0];
  if (dest.p.target_branch && dest.p.target_branch !== target) return fail('Destination declaration conflicts with requested target.');
  for (const raw of dest.p.specs) {
    const spec = specAt(root, dest.commit, dest.cfg, raw); const required = dest.cfg.plans.require_approved_specs === 'feature_and_architecture' || (dest.cfg.plans.require_approved_specs === 'feature' && spec.id.startsWith('feature/'));
    if (required) { const data = lenientFrontmatter(spec.text); const schema = spec.id.startsWith('feature/') ? SPEC_FEATURE_SCHEMA : SPEC_ARCHITECTURE_SCHEMA; if (!data || data.id !== spec.id || !validator(SPEC_COMMON_SCHEMA)(data) || !validator(schema)(data) || data.status !== 'approved' || (data.allow_architecture === true && (typeof data.architecture_reason !== 'string' || !data.architecture_reason.trim()))) return fail(`Invalid or unapproved required spec ${spec.id}.`); }
  }
  let unfinished = 0;
  for (const dep of dest.p.depends_on ?? []) {
    const p = planAt(root, dest.commit, dest.cfg, dep); if (!p) return fail(`Missing dependency ${dep}.`);
    if (p.status !== 'done') {
      if (++unfinished > 1 || dest.cfg.plans.dependency_mode === 'wait_for_merge' || !['ready', 'in_progress', 'review'].includes(p.status)) return fail(`Dependency ${dep} is unfinished or cannot be stacked.`);
      const tip = checkStackTarget(dep, target, config, root, refs);
      if (!samePaths(config, configAt(root, tip))) return fail('Conflicting stack configuration paths.');
      const stackPlan = planAt(root, tip, config, id);
      if (!stackPlan || !identityMatches(stackPlan)) return fail('Stack tree has a conflicting plan identity.');
      for (const raw of dest.p.specs) if (specAt(root, tip, config, raw).text !== specAt(root, dest.commit, dest.cfg, raw).text) return fail(`Stack tree has a different specification revision: ${raw}.`);
    }
  }
  const origin = (() => { try { return git(root, 'remote', 'get-url', 'origin'); } catch { return ''; } })();
  if (origin) {
    if (!/github\.com[:/]/i.test(origin) || config.plans.forge === 'none') return fail('Required forge evidence is unavailable.');
    let evidence: unknown; try { evidence = JSON.parse(run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'url,baseRefName', '--limit', '1000'], { cwd: root })); } catch { return fail('Required forge evidence is unavailable.'); }
    if (!Array.isArray(evidence) || evidence.length >= 1000 || evidence.some(x => typeof x?.url !== 'string' || typeof x?.baseRefName !== 'string')) return fail('Invalid or incomplete forge evidence.');
    if (evidence.some(x => x.baseRefName !== target)) return fail('Pull request base conflicts with requested target; reconcile it externally.');
  }
  const file = `${config.plans.dir}/${id}/PLAN.md`;
  const absolute = path.resolve(root, file); if (!absolute.startsWith(root + path.sep)) return fail('Plan path escapes checkout.');
  const paths = [absolute, path.join(root, CONFIG_PATH)];
  const signatures = new Map<string, string>();
  for (const inputPath of paths) {
    let current = root;
    for (const part of path.relative(root, inputPath).split(path.sep)) {
      current = path.join(current, part); const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return fail('Symlink in recording path.');
      signatures.set(current, `${stat.dev}:${stat.ino}:${stat.mode}`);
    }
  }
  const admin = [CONFIG_PATH, `${config.plans.dir}/${id}`, `${config.plans.dir}/archive/${id}`];
  const dirty = () => git(root, 'status', '--porcelain', '--untracked-files=all', '--ignored', '--', ...admin);
  if (dirty()) return fail('Plan recording set is dirty; commit or discard it first.');
  const mutationCheck = () => {
    for (const tree of trees.filter(t => !t.bare)) {
      const gitdir = git(tree.path, 'rev-parse', '--absolute-git-dir');
      for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) if (fs.existsSync(path.join(gitdir, name))) return fail('Unfinished Git mutation requires recovery.');
    }
  };
  mutationCheck();
  const original = fs.readFileSync(absolute, 'utf8');
  const proposed = target === binding.target_branch ? original : retargetFrontmatter(original, binding.target_branch, target);
  const changed = proposed !== original;
  const receipt: RetargetReceipt = { id, old_target: binding.target_branch, new_target: target, start_target_branch: binding.start_target_branch, start_base: binding.start_base, comparison_base: plan.comparison_base ?? null, changed_files: changed ? [{ path: file, before: hash(original), after: hash(proposed) }] : [], changed, dry_run: !!input.dryRun, committed: false };
  if (changed && !input.dryRun) {
    options.beforeRecheck?.();
    const verify = () => { if (options.signal?.aborted) return fail('Operation aborted.'); lease!.assertOwned(); recheckLifecycleRefs(root, refs);
      for (const [p, signature] of signatures) { const s = fs.lstatSync(p); if (s.isSymbolicLink() || `${s.dev}:${s.ino}:${s.mode}` !== signature) return fail('Recording path identity changed; retry.'); }
      mutationCheck();
      if (JSON.stringify(trees) !== JSON.stringify(listWorktrees(main)) || git(root, 'symbolic-ref', '--short', 'HEAD') !== branch || dirty() || fs.readFileSync(absolute, 'utf8') !== original || fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8') !== configText) return fail('Checkout or recording preimage changed; retry.'); };
    verify(); const temp = path.join(root, `.specplane-retarget-${randomUUID()}.tmp`);
    try { fs.writeFileSync(temp, proposed, { flag: 'wx', mode: fs.statSync(absolute).mode & 0o777 }); verify(); fs.renameSync(temp, absolute); } finally { try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  }
  return receipt;
 } finally { lease?.release(); }
}
