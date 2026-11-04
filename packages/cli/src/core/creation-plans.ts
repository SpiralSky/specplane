/** Exact creation previews reuse the dedicated CLI renderers; no preview writes files. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../config.js';
import { parseFrontmatter } from '../frontmatter.js';
import { resolveSpecId } from '../spec/resolve.js';
import { slugify } from '../spec/slug.js';
import { loadAdrs } from '../decisions/validate.js';
import { renderSpecNew, applySpecNew, applyCreationScaffold, type CreationScaffold } from '../commands/spec.js';
import { renderPlanNew, applyPlanNew } from '../commands/plan.js';
import { renderDecisionNew, applyDecisionNew } from '../commands/decision.js';
import { assertRecordingPaths } from '../plan/recording-set.js';
import { setFinalizedAssistAuthor } from './contribution-metadata.js';
import { readContainedFile } from './contained-files.js';
import { canonical, sha256, type PreparedState } from './workflow-preparation.js';
import { run } from '../git/exec.js';
import type { WorkflowCreation } from './contracts.js';

export type CreationRequest = WorkflowCreation;
export interface PreparedCreation {
  operation: CreationRequest['operation'];
  identity: string;
  files: { path: string; before: null; scaffold: string; after: string }[];
  directories: string[];
  apply(): void;
}
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function body(text: string, value: string): string {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_EVIDENCE', 'Creation requires explicit nonempty approved body text.');
  const close = text.indexOf('\n---\n', 4);
  if (!text.startsWith('---\n') || close < 0) fail('INVALID_EVIDENCE', 'Dedicated operation produced invalid creation metadata.');
  const after = text.slice(0, close + 5) + value;
  if (!isDeepStrictEqual(parseFrontmatter(text).data, parseFrontmatter(after).data)) fail('POLICY_DENIED', 'Creation body cannot change dedicated metadata.');
  return after;
}
function absent(root: string, files: string[]): void {
  assertRecordingPaths(root, files);
  for (const file of files) {
    try { fs.lstatSync(path.join(root, file)); fail('STALE_STATE', `Creation destination already exists: ${file}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}

export function prepareCreation(state: PreparedState, input: CreationRequest): PreparedCreation {
  const request = state.request, creation = structuredClone(input), root = request.checkout;
  if (request.workflow === 'plan-step' || state.initiation.workflow === 'plan-step') fail('POLICY_DENIED', 'Plan-step results cannot invoke creation operations.');
  if (!creation.arguments.title?.trim()) fail('INVALID_EVIDENCE', 'Core creation requires an explicit nonempty title.');
  const config = loadConfig(root).config;
  const reference = (raw: string): string => {
    const resolved = resolveSpecId(raw, config, undefined, root), qualified = `${resolved.root}:${resolved.id}`;
    if (raw.split('#')[0] !== qualified || !request.scope.specIds.includes(qualified)) fail('POLICY_DENIED', 'Creation references must be exact root-qualified members of the prepared scope.');
    return qualified;
  };
  let render: () => CreationScaffold, apply: (plan: CreationScaffold, root: string) => void;
  let author: 'mixed' | 'llm' | undefined;
  if (creation.operation === 'spec.new') {
    const args = creation.arguments;
    if ((request.workflow !== 'spec-assist' || args.type !== 'feature') && (request.workflow !== 'spec-draft-architecture' || args.type !== 'architecture')) fail('POLICY_DENIED', 'Spec creation does not match the prepared workflow.');
    const role = config.specs[args.type].llm_role;
    if (role !== 'assist' && role !== 'draft') fail('POLICY_DENIED', 'New spec body creation requires assist or draft authorship policy.');
    author = role === 'assist' ? 'mixed' : 'llm';
    for (const ref of args.implements ?? []) if (!reference(ref).includes(':feature/')) fail('POLICY_DENIED', 'Architecture creation implements prepared feature specs.');
    for (const ref of args.extends ?? []) reference(ref);
    render = () => renderSpecNew(args.type, args.slug, { root: args.root, title: args.title, implements: args.implements?.join(','), extends: args.extends?.join(',') }, root, loadConfig(root).config);
    apply = applySpecNew;
  } else if (creation.operation === 'plan.new') {
    if (request.workflow !== 'plan-create') fail('POLICY_DENIED', 'Plan creation requires a prepared plan-create workflow.');
    const args = creation.arguments;
    if (!args.id?.trim() || !args.specs?.length || !Array.isArray(creation.steps) || !creation.steps.length) fail('INVALID_EVIDENCE', 'Plan creation requires an explicit ID, specs and nonempty approved step list.');
    for (const ref of args.specs) reference(ref);
    for (const step of creation.steps) {
      if (!step.title?.trim() || !Array.isArray(step.context)) fail('INVALID_EVIDENCE', 'Each approved step requires a title and explicit context array.');
      for (const entry of step.context) {
        if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 1) fail('INVALID_EVIDENCE', 'Invalid approved step context.');
        if ('spec' in entry) reference(entry.spec);
        else if ('decision' in entry) {
          const matches = loadAdrs(config, root).adrs.filter(adr => adr.frontmatter.id === entry.decision);
          if (matches.length !== 1) fail('INVALID_EVIDENCE', 'Step decision context must identify one existing decision.');
        } else if ('file' in entry) {
          const file = entry.file.replace(/\/$/, '');
          if (!file || path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || /[\\\x00-\x1f<>:"|?*]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail('INVALID_EVIDENCE', 'Step file context must be a contained repository path.');
        } else fail('INVALID_EVIDENCE', 'Unknown approved step context.');
      }
    }
    render = () => renderPlanNew({ id: args.id, title: args.title, specs: args.specs!.join(','), dependsOn: args.dependsOn?.join(','), target: args.target, comparisonBase: args.comparisonBase }, root, loadConfig(root).config);
    apply = applyPlanNew;
  } else {
    if (creation.operation !== 'decision.new' || request.workflow !== 'decision-new') fail('POLICY_DENIED', 'Decision creation requires a prepared decision-new workflow.');
    render = () => renderDecisionNew(creation.arguments.title, loadConfig(root).config, root, state.creationDate);
    apply = applyDecisionNew;
  }
  const scaffold = render(), extra: CreationScaffold['files'] = [];
  const files: PreparedCreation['files'] = scaffold.files.map(file => {
    let after = file.path === scaffold.path ? body(file.content, creation.body) : file.content;
    if (file.path === scaffold.path && author === 'mixed') after = setFinalizedAssistAuthor(after);
    if (file.path === scaffold.path && author === 'llm') after = after.replace(/^author: user$/m, 'author: llm');
    return { path: file.path, before: null, scaffold: file.content, after };
  });
  if (creation.operation === 'plan.new') {
    const directory = path.posix.dirname(scaffold.path);
    for (const [index, step] of creation.steps.entries()) {
      const slug = slugify(step.title);
      if (!slug) fail('INVALID_EVIDENCE', 'Approved step title must produce a filename slug.');
      const relative = `${directory}/steps/${String(index + 1).padStart(2, '0')}-${slug}.md`;
      const text = `---\nplan: ${scaffold.identity}\nstep: ${index + 1}\ntitle: ${JSON.stringify(step.title)}\nstatus: pending\ncontext: ${JSON.stringify(step.context)}\n---\n`;
      extra.push({ path: relative, content: text });
      files.push({ path: relative, before: null, scaffold: text, after: body(text, step.body) });
    }
  }
  absent(root, files.map(file => file.path));
  const expected = canonical(scaffold), snapshot = structuredClone(files);
  return { operation: creation.operation, identity: scaffold.identity, files, directories: [...scaffold.directories], apply() {
    state.lease.assertOwned();
    if (state.context.signal?.aborted) fail('CANCELLED', 'Creation preparation was cancelled.');
    if (run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim() !== request.base.head || run('git', ['branch', '--show-current'], { cwd: root }).trim() !== request.base.branch) fail('STALE_STATE', 'Prepared creation HEAD or branch changed.');
    if (sha256(run('git', ['ls-files', '--stage', '-z'], { cwd: root, binary: true })) !== request.base.indexDigest) fail('STALE_STATE', 'Prepared creation index changed.');
    for (const relative of state.inputPaths) {
      let digest: string;
      try { digest = sha256(readContainedFile(root, relative)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; digest = 'missing'; }
      if (digest !== request.base.inputDigests[relative]) fail('STALE_STATE', `Prepared creation input changed: ${relative}`);
    }
    if (sha256(readContainedFile(root, '.specplane/config.yaml')) !== request.base.configDigest) fail('STALE_STATE', 'Creation configuration changed after preparation.');
    absent(root, snapshot.map(file => file.path));
    const current = render();
    if (canonical(current) !== expected) fail('STALE_STATE', 'Dedicated creation scaffold changed after preview.');
    apply(current, root);
    if (extra.length) applyCreationScaffold({ ...current, files: extra }, root);
  } };
}
