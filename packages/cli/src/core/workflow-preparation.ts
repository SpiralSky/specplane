/** Preparation owns state. Wire requests never establish ownership or policy. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lazyValidator } from '../lazy-validator.js';
import { CONFIG_PATH, loadConfig, resolveSessionMode } from '../config.js';
import { checkoutRoot } from '../git/repo.js';
import { run } from '../git/exec.js';
import { parseFrontmatter } from '../frontmatter.js';
import { resolveSpecId } from '../spec/resolve.js';
import { hasAnchor, findHeading } from '../spec/slug.js';
import { sectionSteps } from '../plan/step-done.js';
import { planNext } from '../plan/next.js';
import { assertFinishReadiness } from '../plan/flows.js';
import { PlanStateError } from '../errors.js';
import { parsePlan, parseStep, listStepFiles } from '../plan/parse.js';
import { lifecycleContext, recheckLifecycleRefs } from '../plan/lifecycle-context.js';
import { configAt, snapshot } from '../plan/prepare-start.js';
import { resolvePlanContext, validatePlanBranches } from '../plan/context.js';
import { validateCompatibility, type ExtensionManifest, type Capabilities } from './compatibility.js';
import { coreInfo } from './build-info.js';
import { acquireWriterLease, LeaseRefused, type WriterLease } from './writer-leases.js';
import { workflowInitiationSchema, reviewedTestMappingSchema } from './schemas.js';
import type { CoreContext, Criterion, Result, Notice, WorkflowInitiation, WorkflowRequest, TestRequirement } from './contracts.js';

const validInitiation = lazyValidator(workflowInitiationSchema, { allErrors: true }), validMapping = lazyValidator(reviewedTestMappingSchema, { allErrors: true });
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
class Refusal extends Error { constructor(readonly code: string, message: string) { super(message); } }
const refuse = (code: string, message: string): never => { throw new Refusal(code, message); };
function fileBytes(root: string, relative: string, missing = false): Buffer | null {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) return refuse('INVALID_EVIDENCE', `Invalid contained path: ${relative}`);
  let current = root;
  for (const [i, part] of relative.split('/').entries()) {
    current = path.join(current, part);
    let st: fs.Stats;
    try { st = fs.lstatSync(current); } catch (e) {
      if (missing && (e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    if (st.isSymbolicLink() || (i === relative.split('/').length - 1 ? !st.isFile() : !st.isDirectory())) return refuse('INVALID_EVIDENCE', `Nonregular input: ${relative}`);
  }
  return fs.readFileSync(current);
}
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd }).trim();
const rel = (cwd: string, file: string) => path.relative(cwd, file).split(path.sep).join('/');
const ref = (cwd: string, name: string): string | null => { try { return git(cwd, 'rev-parse', '--verify', `${name}^{commit}`); } catch { return null; } };
function clean(cwd: string) {
  if (git(cwd, 'status', '--porcelain=v1', '--untracked-files=all')) refuse('STALE_STATE', 'Preparation requires a clean tracked and nonignored untracked baseline; preserve and reconcile local changes first.');
}
function indexDigest(cwd: string): string { return sha256(run('git', ['ls-files', '--stage', '-z'], { cwd, binary: true })); }
function criteriaFrom(text: string): string[] {
  // Only acceptance checkboxes outside fences and within the named section count.
  let active = false, fence: string | null = null; const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) { if (!fence) fence = f[1][0]; else if (fence === f[1][0]) fence = null; continue; }
    if (fence) continue;
    if (/^##\s+/.test(line)) active = /^##\s+Acceptance criteria\s*$/i.test(line);
    const m = active && /^\s*[-*] \[[ xX]\]\s+(.+)$/.exec(line);
    if (m) found.push(m[1]);
  }
  return found;
}
function specPolicy(text: string): string {
  const data = parseFrontmatter(text).data;
  delete data.author; delete data.contributors;
  return sha256(canonical(data));
}
export interface PreparedState {
  creationDate: string;
  confirmContent?: NonNullable<CoreContext['interaction']>['confirm'];
  captureObservation?: NonNullable<CoreContext['contributions']>['observe'];
  cancellation: AbortController; stopWorker?: NonNullable<CoreContext['lifecycle']>['stopWorkflow']; cancellationPending: boolean; leaseReleased: boolean;
  initiation: WorkflowInitiation; request: WorkflowRequest; context: CoreContext; lease: WriterLease;
  refs: Record<string, string | null>; compatibilityDigests: Record<string, string>;
  editableSpecPolicies: Record<string, string>; inputPaths: string[]; mutableInputs: string[]; capabilities: Capabilities; uncertainCriteria: string[]; input: string | null;
}
const prepared = new Map<string, PreparedState>();
function packageDigests(context: CoreContext): Record<string, string> {
  const binding = context.compatibility!; const m = binding.manifest as ExtensionManifest;
  const paths = new Set(['specplane-extension.json', ...m.assets.map(a => a.path), ...m.procedures.flatMap(p => p.contracts.map(c => c.path))]);
  const inventory = m.assets.find(a => a.kind === 'core')!;
  const data = JSON.parse(fileBytes(binding.host.packageRoot, inventory.path)!.toString());
  for (const file of data.files) paths.add(file.path);
  return Object.fromEntries([...paths].sort().map(p => [p, sha256(fileBytes(binding.host.packageRoot, p)!)]));
}
function mapping(procedures: Record<string, string>, workflow: string, cwd: string, inputs: Record<string, string>, criteria: Criterion[]): Set<string> {
  const assigned = new Set<string>();
  for (const [procedurePath, content] of Object.entries(procedures)) {
    const blocks = [...content.matchAll(/^```specplane-test-requirements\s*\r?\n([\s\S]*?)^```\s*$/gm)];
    if (blocks.length > 1) refuse('INVALID_EVIDENCE', `Multiple test mappings: ${procedurePath}`);
    if (!blocks.length) {
      if (/^```specplane-test-requirements/m.test(content)) refuse('INVALID_EVIDENCE', `Unterminated test mapping: ${procedurePath}`);
      continue;
    }
    let value: any; try { value = JSON.parse(blocks[0][1]); } catch { return refuse('INVALID_EVIDENCE', 'Malformed reviewed test mapping JSON.'); }
    if (!validMapping(value) || value.workflow !== workflow) refuse('INVALID_EVIDENCE', `Invalid or wrong-workflow test mapping: ${procedurePath}`);
    for (const entry of value.criteria) {
      const bytes = fileBytes(cwd, entry.sourcePath)!;
      if (sha256(bytes) !== entry.sourceDigest) refuse('STALE_STATE', `Stale test mapping: ${entry.sourcePath}`);
      const key = `${entry.sourcePath}:${entry.criterionIndex}`;
      if (assigned.has(key)) refuse('INVALID_EVIDENCE', `Duplicate criterion mapping: ${key}`);
      const sourceCriteria = criteriaFrom(bytes.toString());
      if (!sourceCriteria[entry.criterionIndex - 1]) refuse('INVALID_EVIDENCE', `Unresolved criterion mapping: ${key}`);
      if (new Set(entry.testRequirements.map((r: TestRequirement) => r.suiteId)).size !== entry.testRequirements.length) refuse('INVALID_EVIDENCE', 'Duplicate suite identity in test mapping.');
      assigned.add(key); inputs[entry.sourcePath] = entry.sourceDigest;
      const criterion = criteria.find(c => c.sourcePath === entry.sourcePath && c.id === key);
      if (criterion) criterion.testRequirements = structuredClone(entry.testRequirements);
    }
  }
  return assigned;
}

export async function prepareWorkflow(request: WorkflowInitiation, context: CoreContext): Promise<Result<WorkflowRequest>> {
  let lease: WriterLease | undefined; const notices: Notice[] = [];
  try {
    if (!validInitiation(request)) refuse('INVALID_EVIDENCE', 'Expected a closed WorkflowInitiation, not a prepared WorkflowRequest.');
    const creationDate=(context.clock?.now()??new Date()).toISOString().slice(0,10);
    const confirmContent=typeof context.interaction?.confirm==='function'?context.interaction.confirm.bind(context.interaction):undefined;
    const captureObservation = typeof context.contributions?.observe === 'function' ? context.contributions.observe.bind(context.contributions) : undefined;
    const stopWorker = typeof context.lifecycle?.stopWorkflow === 'function' ? context.lifecycle.stopWorkflow.bind(context.lifecycle) : undefined;
    // Take private copies before awaiting host/package I/O.
    request = structuredClone(request); context = { ...context, compatibility: context.compatibility && structuredClone(context.compatibility) };
    if (context.signal?.aborted) refuse('CANCELLED', 'Preparation cancelled.');
    if (!context.compatibility) refuse('INCOMPATIBLE', 'Structured preparation requires private extension package compatibility inputs; use the manual CLI otherwise.');
    if (request.extensionId !== context.extensionId || context.compatibility!.host.extensionId !== request.extensionId || context.compatibility!.host.workflow !== request.workflow) refuse('INCOMPATIBLE', 'Initiation, context and host workflow/extension identities must agree.');
    const compatibility = await validateCompatibility(context.compatibility!.manifest, context.compatibility!.host, coreInfo);
    if (!compatibility.ok) return compatibility;
    notices.push(...compatibility.notices);
    if (!compatibility.value.reasoning) refuse('UNSUPPORTED_CAPABILITY', 'This extension does not provide reasoning workflows.');
    if (!path.isAbsolute(request.checkout) || !context.checkout || !path.isAbsolute(context.checkout)) refuse('STALE_STATE', 'Absolute request and context checkouts are required.');
    const cwd = fs.realpathSync(checkoutRoot(request.checkout));
    if (fs.realpathSync(request.checkout) !== cwd || fs.realpathSync(context.checkout!) !== cwd) refuse('STALE_STATE', 'Request and context must identify the same checkout root.');
    let config = loadConfig(cwd).config;
    const id = request.workflow === 'plan-step' || request.workflow === 'plan-finish' ? request.selection.planId : undefined;
    if (id && git(cwd, 'branch', '--show-current') !== `plan/${id}`) refuse('STALE_STATE', 'Plan preparation requires its exact managed branch and checkout.');
    const discoveryTarget = id ? resolvePlanContext(cwd, { id, planBranches: { local: snapshot(cwd, ref(cwd, `refs/heads/plan/${id}`), id, config), remote: snapshot(cwd, ref(cwd, `refs/remotes/origin/plan/${id}`), id, config) } }).targetBranch : null;
    const plans = id ? [id, ...(discoveryTarget?.startsWith('plan/') ? [discoveryTarget.slice(5)] : [])] : [];
    const requestId = randomUUID();
    lease = acquireWriterLease({ checkouts: [cwd], plans, repository: request.workflow!=='validate', requestId });
    clean(cwd);
    if (context.signal?.aborted) refuse('CANCELLED', 'Preparation cancelled.');
    if (id && git(cwd, 'remote').split('\n').includes('origin')) {
      git(cwd, 'fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*');
      const local = ref(cwd, `refs/heads/plan/${id}`), remote = ref(cwd, `refs/remotes/origin/plan/${id}`);
      const selected = validatePlanBranches(cwd, id, { local: snapshot(cwd, local, id, config), remote: snapshot(cwd, remote, id, config) });
      if (selected && selected.commit !== local) git(cwd, 'merge', '--ff-only', selected.commit);
      config = loadConfig(cwd).config;
    }
    const inputs: Record<string, string | 'missing'> = {};
    const entries: WorkflowRequest['context'] = [];
    const mutableInputs: string[] = [];
    const editableSpecPolicies: Record<string, string> = {};
    const inputPaths = new Set<string>(), protectedPaths = new Set<string>([CONFIG_PATH]);
    const bind = (p: string, anchor?: string): string | 'missing' => {
      const bytes = fileBytes(cwd, p, true), digest = bytes === null ? 'missing' : sha256(bytes);
      inputPaths.add(p); inputs[p] = digest;
      if (bytes && !entries.some(e => e.path === p && e.anchor === anchor)) entries.push({ path: p, ...(anchor ? { anchor } : {}), digest });
      return digest;
    };
    const configDigest = bind(CONFIG_PATH);
    if (configDigest === 'missing') refuse('POLICY_DENIED', 'Repository configuration is required.');
    const compatibilityDigests = packageDigests(context);
    const manifest = context.compatibility!.manifest as ExtensionManifest;
    const procedures: Record<string, string> = {};
    const procedureDigests: Record<string, string> = {};
    for (const contract of manifest.procedures.filter(p => p.workflow === request.workflow).flatMap(p => p.contracts)) {
      const key = `package://${contract.path}`;
      procedures[key] = fileBytes(context.compatibility!.host.packageRoot, contract.path)!.toString();
      procedureDigests[key] = contract.sha256;
    }
    // Bind the entire verified inventory, including the manifest and runtime files.
    for (const [p, digest] of Object.entries(compatibilityDigests)) inputs[`package://${p}`] = digest;
    const scope: WorkflowRequest['scope'] = { kind: request.workflow, specIds: [], allowedEditPaths: [] };
    const criteria: Criterion[] = [];
    const addCriteria = (p: string) => {
      const digest = bind(p); if (digest === 'missing') return;
      for (const [i, text] of criteriaFrom(fileBytes(cwd, p)!.toString()).entries()) criteria.push({ id: `${p}:${i + 1}`, text, sourcePath: p, sourceDigest: digest, testRequirements: [] });
    };
    const boundSpecs = new Set<string>();
    const bindSpec = (id: string, fromRoot?: string): ReturnType<typeof resolveSpecId> & { relative: string } => {
      const resolved = resolveSpecId(id, config, fromRoot, cwd); const p = rel(cwd, resolved.path);
      bind(p); protectedPaths.add(p); const qualified = `${resolved.root}:${resolved.id}`;
      if (!scope.specIds.includes(qualified)) scope.specIds.push(qualified);
      if (!boundSpecs.has(qualified)) {
        boundSpecs.add(qualified);
        const metadata = parseFrontmatter(fileBytes(cwd, p)!.toString(), p).data;
        for (const field of ['implements', 'extends']) {
          const values = metadata[field] === undefined ? [] : Array.isArray(metadata[field]) ? metadata[field] as unknown[] : [metadata[field]];
          for (const value of values) { if (typeof value !== 'string') refuse('INVALID_EVIDENCE', `Invalid ${field} reference in ${p}`); bindSpec(value as string, resolved.root); }
        }
      }
      return { ...resolved, relative: p };
    };
    let refs: Record<string, string | null> = {};
    if (request.workflow === 'plan-step') {
      const state = lifecycleContext(id!, config, cwd);
      if (state.target.status === 'done' || state.plan.status === 'done') refuse('POLICY_DENIED', 'Terminal plans cannot execute steps.');
      if (state.context.targetBranch !== discoveryTarget) refuse('STALE_STATE', 'Target changed during synchronization; retry with the complete lease set.');
      refs = state.refs;
      const next = planNext(id!, config, cwd);
      if (next.checkout === null || fs.realpathSync(next.checkout) !== cwd) refuse('STALE_STATE', 'Wrong plan checkout.');
      const selection = request.selection;
      if (selection.reason !== undefined && (!selection.force || !selection.step || !selection.reason.trim() || /[\r\n]/.test(selection.reason))) refuse('INVALID_EVIDENCE', 'Rerun reason requires force, explicit step and nonblank single-line text.');
      const planDir = `${config.plans.dir}/${id}`;
      const steps = listStepFiles(path.join(cwd, planDir)).map(file => parseStep(file));
      const selected = selection.step ? steps.find(s => s.frontmatter.step === selection.step) : steps.find(s => s.frontmatter.step === next.step?.number);
      if (!selected) refuse('POLICY_DENIED', 'No executable step selected.');
      const completed = ['done', 'skipped'].includes(selected!.frontmatter.status);
      const rerun = completed && Boolean(selection.step && selection.force && selection.reason?.trim());
      if (!completed) {
        const history = git(cwd, 'log', '--format=%(trailers:key=Specplane-Plan,valueonly)%x00%(trailers:key=Specplane-Step,valueonly)%x1e');
        if (history.split('\x1e').some(row => { const [plan, step] = row.split('\0').map(x => x.trim()); return plan === id && Number(step) === selected!.frontmatter.step; })) refuse('RECOVERY_REQUIRED', 'Matching step commit exists without completed status; reconcile partial recording.');
      }
      if (completed && !rerun) refuse('POLICY_DENIED', 'Completed step rerun requires step, force and reason.');
      if (!['ready', 'in_progress', 'review'].includes(next.effectiveStatus) || next.attention.some(a => !['finish_ready', ...(selection.force ? ['blocked'] : [])].includes(a.kind))) refuse('POLICY_DENIED', next.reason);
      if (!rerun && selected!.frontmatter.step !== next.step?.number) refuse('POLICY_DENIED', 'Select the lowest pending step.');
      if (selection.force && !selection.step && selection.reason) refuse('INVALID_EVIDENCE', 'Rerun requires an explicit step.');
      const p = rel(cwd, selected!.file);
      bind(`${planDir}/PLAN.md`); bind(`${planDir}/HANDOFF.md`); bind(`${planDir}/spec-gaps.md`);
      const handoff = fileBytes(cwd, `${planDir}/HANDOFF.md`, true)?.toString() ?? '';
      if (!rerun && sectionSteps(handoff).some(n => n > selected!.frontmatter.step)) refuse('RECOVERY_REQUIRED', 'HANDOFF contains a later step; reconcile append-only history.');
      for (const s of steps) { const stepPath = rel(cwd, s.file); bind(stepPath); protectedPaths.add(stepPath); }
      for (const file of ['PLAN.md', 'HANDOFF.md', 'spec-gaps.md']) protectedPaths.add(`${planDir}/${file}`);
      addCriteria(p);
      if (!criteria.length) refuse('INVALID_EVIDENCE', 'Selected step has no acceptance criteria.');
      for (const spec of parsePlan(path.join(cwd, planDir)).frontmatter.specs) bindSpec(spec);
      for (const entry of selected!.frontmatter.context ?? []) {
        if ('spec' in entry) {
          const [spec, anchor] = entry.spec.split('#'); const r = bindSpec(spec);
          if (anchor && !hasAnchor(fileBytes(cwd, r.relative)!.toString(), anchor) && !findHeading(fileBytes(cwd, r.relative)!.toString(), anchor)) refuse('INVALID_EVIDENCE', `Missing context anchor: ${entry.spec}`);
          bind(r.relative, anchor);
        } else if ('file' in entry) {
          mutableInputs.push(entry.file);
          if (bind(entry.file) === 'missing') notices.push({ code: 'MISSING_CONTEXT', message: entry.file });
          else if (git(cwd, 'ls-files', '--', entry.file) === entry.file) {
            const text = fileBytes(cwd, entry.file)!.toString();
            if (text.includes('```specplane-test-requirements')) { mutableInputs.splice(mutableInputs.indexOf(entry.file), 1); protectedPaths.add(entry.file); procedures[entry.file] = text; procedureDigests[entry.file] = inputs[entry.file] as string; }
          }
        } else {
          const dir = config.decisions.dir;
          const number = entry.decision.match(/^decision\/(\d{4})$/)?.[1];
          const matches = number && fs.existsSync(path.join(cwd, dir)) ? fs.readdirSync(path.join(cwd, dir)).filter(f => f.startsWith(`${number}-`) && f.endsWith('.md')) : [];
          if (matches.length !== 1) refuse('INVALID_EVIDENCE', `Unresolved decision: ${entry.decision}`);
          bind(`${dir}/${matches[0]}`);
        }
      }
      // Target/dependency bytes and complete captured refs remain private immutable inputs.
      inputs['target://context'] = sha256(canonical(state.context));
      inputs['target://plan'] = sha256(canonical(state.target));
      for (const dep of state.target.depends_on ?? []) {
        const targetConfig = configAt(cwd, state.context.targetCommit);
        const file = `${targetConfig.plans.dir}/${dep}/PLAN.md`, archived = `${targetConfig.plans.dir}/archive/${dep}/PLAN.md`;
        const bytes = (p: string) => { try { return run('git', ['show', `${state.context.targetCommit}:${p}`], { cwd }); } catch { return null; } };
        inputs[`target://dependency/${dep}`] = sha256(bytes(file) ?? bytes(archived) ?? 'missing');
      }
      Object.assign(scope, { planId: id, step: selected!.frontmatter.step, expectedStatus: selected!.frontmatter.status, checkout: cwd, leaseId: requestId });
      // Plan implementation may touch repository files, but administrative inputs remain protected.
      scope.allowedEditPaths = ['.'];
    } else if (request.workflow === 'plan-finish') {
      // Readiness only: the finish itself runs through its human-confirmed operation, never from a result.
      const state = lifecycleContext(id!, config, cwd);
      if (state.context.targetBranch !== discoveryTarget) refuse('STALE_STATE', 'Target changed during synchronization; retry with the complete lease set.');
      refs = state.refs;
      try { assertFinishReadiness(id!, state.config, cwd, git(cwd, 'remote').split('\n').includes('origin')); }
      catch (e) { if (e instanceof PlanStateError) refuse('POLICY_DENIED', e.message); throw e; }
      const planDir = `${config.plans.dir}/${id}`;
      bind(`${planDir}/PLAN.md`); bind(`${planDir}/HANDOFF.md`); bind(`${planDir}/spec-gaps.md`);
      for (const file of ['PLAN.md', 'HANDOFF.md', 'spec-gaps.md']) protectedPaths.add(`${planDir}/${file}`);
      addCriteria(`${planDir}/PLAN.md`);
      for (const spec of parsePlan(path.join(cwd, planDir)).frontmatter.specs) bindSpec(spec);
      inputs['target://context'] = sha256(canonical(state.context));
      inputs['target://plan'] = sha256(canonical(state.target));
      Object.assign(scope, { planId: id });
      if (!criteria.length) criteria.push({ id: `${CONFIG_PATH}:workflow-policy`, text: 'Report finish readiness for the plan. The finish itself needs its human confirmation and is never performed from a result.', sourcePath: CONFIG_PATH, sourceDigest: configDigest as string, testRequirements: [] });
    } else {
      const { specIds, input } = request.selection;
      scope.input = input;
      for (const spec of specIds) {
        const resolved = bindSpec(spec);
        const type = resolved.id.startsWith('feature/') ? 'feature' : 'architecture';
        if (request.workflow === 'spec-assist' || request.workflow === 'spec-draft-architecture') {
          const role = config.specs[request.workflow === 'spec-assist' ? 'feature' : 'architecture'].llm_role;
          if (role === 'none') refuse('POLICY_DENIED', 'Configured authorship policy forbids this workflow.');
          if (request.workflow === 'spec-assist' && type !== 'feature') refuse('POLICY_DENIED', 'spec-assist selects feature specs.');
          // Assist/review may discuss text; final writes remain confirmation-gated.
          if (role === 'draft' && type === (request.workflow === 'spec-assist' ? 'feature' : 'architecture')) { scope.allowedEditPaths.push(resolved.relative); mutableInputs.push(resolved.relative); protectedPaths.delete(resolved.relative); editableSpecPolicies[resolved.relative] = specPolicy(fileBytes(cwd, resolved.relative)!.toString()); }
        }
        if (request.workflow !== 'spec-assist' && request.workflow !== 'spec-draft-architecture') addCriteria(resolved.relative);
      }
      if (request.workflow === 'spec-assist' || request.workflow === 'spec-draft-architecture') {
        const role = config.specs[request.workflow === 'spec-assist' ? 'feature' : 'architecture'].llm_role;
        if (role === 'none') refuse('POLICY_DENIED', 'Configured authorship policy forbids this workflow.');
      }
      if (request.workflow === 'validate') {
        // Validation may inspect the whole repository but never permits edits.
        for (const p of run('git', ['ls-files', '-z'], { cwd }).split('\0').filter(Boolean)) bind(p);
      }
      if (!criteria.length) criteria.push({ id: `${CONFIG_PATH}:workflow-policy`, text: `Follow the verified ${request.workflow} procedure and configured policies for the requested scope. Creation and lifecycle changes require their dedicated core operations.`, sourcePath: CONFIG_PATH, sourceDigest: configDigest as string, testRequirements: [] });
    }
    const mapped = mapping(procedures, request.workflow, cwd, inputs as Record<string, string>, criteria);
    for (const criterion of criteria) protectedPaths.add(criterion.sourcePath);
    for (const p of Object.keys(inputs)) if (!p.startsWith('package://') && !p.startsWith('target://')) inputPaths.add(p);
    const uncertainCriteria = criteria.filter(c => !mapped.has(c.id)).map(c => c.id);
    for (const id of uncertainCriteria) notices.push({ code: 'UNCERTAIN_TEST_MAPPING', message: `No reviewed test/inspection mapping for ${id}; empty requirements do not establish acceptance.` });
    const branch = git(cwd, 'branch', '--show-current');
    if (!branch) refuse('STALE_STATE', 'Detached HEAD is not an executable workflow checkout.');
    const baseFields = { head: git(cwd, 'rev-parse', 'HEAD'), branch, configDigest: configDigest as string, inputDigests: inputs, indexDigest: indexDigest(cwd) };
    const envelope: WorkflowRequest = { protocol: 1, requestId, workflow: request.workflow, extensionId: request.extensionId, checkout: cwd, mode: resolveSessionMode(config.execution.session_mode, request.mode), base: { ...baseFields, digest: sha256(canonical(baseFields)) }, scope, context: entries, criteria, procedureDigests };
    lease.assertOwned(); clean(cwd); recheckLifecycleRefs(cwd, refs);
    if (context.signal?.aborted) refuse('CANCELLED', 'Preparation cancelled.');
    // Revalidate package after synchronization, before exposing a prepared request.
    const verified = await validateCompatibility(context.compatibility!.manifest, context.compatibility!.host, coreInfo);
    if (!verified.ok) return verified;
    if (canonical(packageDigests(context)) !== canonical(compatibilityDigests)) refuse('STALE_STATE', 'Package changed during preparation.');
    lease.assertOwned(); clean(cwd); recheckLifecycleRefs(cwd, refs);
    if (git(cwd, 'rev-parse', 'HEAD') !== baseFields.head || git(cwd, 'branch', '--show-current') !== branch || indexDigest(cwd) !== baseFields.indexDigest) refuse('STALE_STATE', 'Checkout changed during preparation.');
    for (const p of inputPaths) {
      const expected = inputs[p];
      const bytes = fileBytes(cwd, p, true);
      if ((bytes === null ? 'missing' : sha256(bytes)) !== expected) refuse('STALE_STATE', `Input changed during preparation: ${p}`);
    }
    if (context.signal?.aborted) refuse('CANCELLED', 'Preparation cancelled.');
    const cancellation = new AbortController();
    const boundContext = { ...context, signal: context.signal ? AbortSignal.any([context.signal, cancellation.signal]) : cancellation.signal };
    lease.retainHostWorker();
    prepared.set(requestId, { creationDate, confirmContent, cancellation, captureObservation, stopWorker, cancellationPending: false, leaseReleased: false, initiation: request, editableSpecPolicies, inputPaths: [...inputPaths], mutableInputs: mutableInputs.filter(p => !protectedPaths.has(p)), request: structuredClone(envelope), context: boundContext, lease, refs, compatibilityDigests, capabilities: compatibility.value, uncertainCriteria, input: request.workflow === 'plan-step' || request.workflow === 'plan-finish' ? null : request.selection.input });
    lease = undefined;
    return { protocol: 1, ok: true, value: envelope, notices };
  } catch (error) {
    return { protocol: 1, ok: false, error: { code: error instanceof Refusal || error instanceof LeaseRefused ? error.code : context.signal?.aborted ? 'CANCELLED' : 'PREPARATION_FAILED', message: error instanceof Error ? error.message : String(error), retryable: error instanceof LeaseRefused && error.code === 'LOCKED', details: null }, notices };
  } finally {
    try { lease?.release(); } catch (error) {
      return { protocol: 1, ok: false, error: { code: 'RECOVERY_REQUIRED', message: `Preparation could not release its lease: ${error instanceof Error ? error.message : String(error)}`, retryable: false, details: null }, notices };
    }
  }
}

/** Internal boundary for subsequent test/validation/recording phases. Not a wire API. */
export async function assertPrepared(requestId: string, context: CoreContext): Promise<PreparedState> {
  const state = assertPreparedIdentity(requestId, context);
  if (state.context.signal?.aborted || context.signal?.aborted) refuse('CANCELLED', 'Prepared workflow cancelled; prove worker stopped before releasing leases.');
  const verified = await validateCompatibility(state.context.compatibility!.manifest, state.context.compatibility!.host, coreInfo);
  if (!verified.ok || canonical(packageDigests(state.context)) !== canonical(state.compatibilityDigests)) refuse('STALE_STATE', 'Prepared package compatibility changed.');
  state.lease.assertOwned();
  if (state.context.signal?.aborted || context.signal?.aborted) refuse('CANCELLED', 'Prepared workflow cancelled.');
  const request = state.request, cwd = request.checkout;
  if (git(cwd, 'rev-parse', 'HEAD') !== request.base.head || git(cwd, 'branch', '--show-current') !== request.base.branch || indexDigest(cwd) !== request.base.indexDigest) refuse('STALE_STATE', 'Prepared HEAD, branch or index changed.');
  recheckLifecycleRefs(cwd, state.refs);
  for (const p of state.inputPaths) {
    if (state.mutableInputs.includes(p)) continue;
    const digest = request.base.inputDigests[p];
    const bytes = fileBytes(cwd, p, true);
    if ((bytes === null ? 'missing' : sha256(bytes)) !== digest) refuse('STALE_STATE', `Prepared input changed: ${p}`);
  }
  for (const [p, expected] of Object.entries(state.editableSpecPolicies)) {
    if (specPolicy(fileBytes(cwd, p)!.toString()) !== expected) refuse('STALE_STATE', `Prepared spec policy changed: ${p}`);
  }
  return state;
}
/** Identity/lease-only boundary: cancellation and inspection must work after stale inputs or abortion. */
export function assertPreparedIdentity(requestId: string, context: CoreContext): PreparedState {
  const state = prepared.get(requestId);
  if (!state || state.context.extensionId !== context.extensionId || !context.checkout || !path.isAbsolute(context.checkout) || fs.realpathSync(context.checkout) !== state.request.checkout) return refuse('STALE_STATE', 'Prepared execution identity/owner unavailable; completed records can be inspected with recoverWorkflowRecording, but execution resumption is unavailable.');
  if (!state.leaseReleased) state.lease.assertOwned();
  return state;
}
/** Complete proven cancellation while retaining a safe inspectable terminal state. */
export function finishStoppedPreparation(requestId: string): void {
  if (activities.has(requestId)) return refuse('RECOVERY_REQUIRED', 'Worker acknowledgment arrived while a core phase remains active; lease retained.');
  const state = prepared.get(requestId);
  if (!state || state.leaseReleased) return;
  state.lease.releaseStoppedHost(); state.leaseReleased = true;
}
export function preparedActivity(requestId: string): 'idle' | 'execution' | 'validation' | 'recording' {
  return activities.get(requestId) ?? 'idle';
}
/** Called only by the embedding lifecycle after it has proved the worker stopped. */
export function releaseStoppedPreparation(requestId: string): void {
  if (activities.has(requestId)) return refuse('LOCKED', 'Cannot release a workflow with an active phase.');
  const state = prepared.get(requestId); if (!state) return;
  if (!state.leaseReleased) state.lease.releaseStoppedHost(); prepared.delete(requestId);
}

const activities = new Map<string, 'execution' | 'validation' | 'recording'>();
/** Reserve before asynchronous checks so no phase can overlap execution. */
export async function withPreparedActivity<T>(requestId: string, activity: 'execution' | 'validation' | 'recording', body: () => Promise<T>): Promise<T> {
  if (prepared.get(requestId)?.context.signal?.aborted) return refuse('CANCELLED', 'Prepared workflow cancelled.');
  if (activities.has(requestId)) return refuse('LOCKED', `Workflow already running ${activities.get(requestId)}.`);
  activities.set(requestId, activity);
  try { return await body(); } finally { activities.delete(requestId); }
}
