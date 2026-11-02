import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';
import { isDeepStrictEqual } from 'node:util';
import { CONFIG_PATH, parseConfigText } from '../config.js';
import { checkoutRoot } from '../git/repo.js';
import { run } from '../git/exec.js';
import { parseFrontmatter } from '../frontmatter.js';
import { SPEC_COMMON_SCHEMA, validator } from '../schemas.js';
import { resolveSpecId } from '../spec/resolve.js';
import { acquireWriterLease } from './writer-leases.js';
import { evaluateImplementation, fingerprintClosure, type AssessmentReason, type CompletionSnapshot } from './completion.js';
import type { ImplementationDeclaration } from '../types.js';

export interface CompletionReceipt {
  id: string; implementation_status: 'incomplete' | 'partial' | 'complete';
  assessment_status: 'current' | 'unrecorded'; assessment_reasons: AssessmentReason[];
  fingerprint: string | null; changed_file: string; changed: boolean; dry_run: boolean;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const validate = validator(SPEC_COMMON_SCHEMA);
function validateSpec(content: string, file: string): Record<string, unknown> {
  const data = parseFrontmatter(content, file).data;
  if (!validate(data)) throw new Error(`Invalid spec metadata in ${file}: ${JSON.stringify(validate.errors)}`);
  return data;
}
/** Replace only the top-level implementation node, leaving all other source bytes untouched. */
function replaceImplementation(text: string, declaration: ImplementationDeclaration): string {
  const start = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)/.exec(text);
  if (!start) throw new Error('Missing frontmatter');
  const rest = text.slice(start[0].length);
  const close = /^---[^\r\n]*(?:\r\n|\n|\r|$)/m.exec(rest);
  if (!close) throw new Error('Missing closing frontmatter delimiter');
  const header = rest.slice(0, close.index);
  const eol = start[0].endsWith('\r\n') ? '\r\n' : start[0].endsWith('\r') ? '\r' : '\n';
  type Node = { start: number; end: number; value: unknown; kind: string | null; children: Node[] };
  const stack: Node[] = []; let tree: Node | undefined;
  yaml.load(header, { schema: yaml.JSON_SCHEMA, listener(event, state) {
    if (event === 'open') stack.push({ start: state.position, end: state.position, value: undefined, kind: null, children: [] });
    else {
      const item = stack.pop()!; item.end = state.position; item.value = state.result; item.kind = state.kind;
      if (stack.length) stack[stack.length - 1].children.push(item); else tree = item;
    }
  } });
  if (!tree) throw new Error('Cannot locate YAML mapping');
  let mapping: Node = tree;
  while (mapping.children.length === 1 && mapping.children[0].kind === 'mapping') mapping = mapping.children[0];
  const entries = mapping.children;
  const at = entries.findIndex((node, index) => index % 2 === 0 && node.value === 'implementation');
  const value = yaml.dump(declaration, { flowLevel: 0, lineWidth: -1, noRefs: true }).trim();
  if (at >= 0) {
    const item = entries[at + 1];
    if (!item) throw new Error('Cannot locate implementation value');
    // js-yaml includes trailing comments and indentation in a block value's end position.
    // Last child ends at the end of the actual value; retain surrounding comments verbatim.
    let end = item.end;
    if (item.children.length && /^[ \t]*[\r\n]/.test(header.slice(item.start, item.end))) {
      end = item.children[item.children.length - 1].end;
    }
    while (end > item.start && /[\s]/.test(header[end - 1])) end--;
    const prefix = header.slice(0, item.start), suffix = header.slice(end);
    return start[0] + prefix + ' ' + value + suffix + rest.slice(close.index);
  }
  if (Object.hasOwn(parseFrontmatter(text).data, 'implementation')) throw new Error('Cannot safely locate implementation metadata');
  const first = entries[0];
  const isFlow = header.slice(mapping.start, mapping.end).trimStart().startsWith('{');
  if (isFlow) {
    const brace = header.lastIndexOf('}', mapping.end - 1);
    if (brace < 0) throw new Error('Cannot locate YAML mapping end');
    return start[0] + header.slice(0, brace) + (entries.length ? ', ' : '') + `implementation: ${value}` + header.slice(brace) + rest.slice(close.index);
  }
  const indent = first ? /^ */.exec(header.slice(header.lastIndexOf('\n', first.start - 1) + 1))?.[0] ?? '' : '';
  return start[0] + header + (header && !/[\r\n]$/.test(header) ? eol : '') + `${indent}implementation: ${value}${eol}` + rest.slice(close.index);
}

export function writeImplementation(input: { id: string; root?: string; status: 'incomplete' | 'partial' | 'complete'; dryRun?: boolean }, cwd: string, options: { signal?: AbortSignal; beforeRecheck?: () => void } = {}): CompletionReceipt {
  if (!['incomplete', 'partial', 'complete'].includes(input.status)) throw new Error('Invalid implementation status');
  const abort = () => { if (options.signal?.aborted) throw new Error('Operation aborted'); };
  abort();
  const checkout = fs.realpathSync(checkoutRoot(cwd));
  const lease = input.dryRun ? undefined : acquireWriterLease({ checkouts: [checkout], repository: true, requestId: randomUUID() });
  try {
    const observations = new Map<string, { signature: string | null; digest: string | null }>();
    const recordPath = (file: string): void => {
      const relative = path.relative(checkout, file);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error(`Path outside checkout: ${file}`);
      let current = checkout;
      for (const component of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        let signature: string | null = null;
        try {
          const stat = fs.lstatSync(current);
          if (stat.isSymbolicLink()) throw new Error(`Symlink in input path: ${current}`);
          signature = `${stat.dev}:${stat.ino}:${stat.mode}`;
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        const old = observations.get(current);
        if (old && old.signature !== signature) throw new Error(`Input changed during assessment: ${current}`);
        if (!old) observations.set(current, { signature, digest: null });
        if (signature === null) break;
      }
    };
    const read = (file: string): Buffer | null => {
      recordPath(file);
      let bytes: Buffer | null;
      try { bytes = fs.readFileSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; bytes = null; }
      const value = bytes === null ? null : digest(bytes);
      const old = observations.get(file);
      if (old && old.digest !== null && old.digest !== value) throw new Error(`Input changed during assessment: ${file}`);
      if (old) old.digest = value;
      return bytes;
    };
    const gitDir = run('git', ['rev-parse', '--absolute-git-dir'], { cwd: checkout }).trim();
    const indexPath = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'index'], { cwd: checkout }).trim();
    const headPath = path.join(gitDir, 'HEAD');
    const rawExternal = (file: string): string | null => { try { return digest(fs.readFileSync(file)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
    const head = () => { try { return run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: checkout }).trim(); } catch (error) { if (error instanceof Error && /Needed a single revision/.test(error.message)) return null; throw error; } };
    const gitState = { head: head(), headFile: rawExternal(headPath), index: rawExternal(indexPath) };
    const recheck = () => {
      abort();
      lease?.assertOwned();
      for (const [file, expected] of observations) {
        let actual: string | null = null;
        try {
          const stat = fs.lstatSync(file);
          if (stat.isSymbolicLink()) throw new Error(`Symlink in input path: ${file}`);
          actual = `${stat.dev}:${stat.ino}:${stat.mode}`;
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        if (actual !== expected.signature) throw new Error(`Input changed during assessment: ${file}`);
        if (expected.digest !== null && rawExternal(file) !== expected.digest) throw new Error(`Input changed during assessment: ${file}`);
      }
      if (head() !== gitState.head || rawExternal(headPath) !== gitState.headFile || rawExternal(indexPath) !== gitState.index) throw new Error('HEAD or index changed during assessment');
    };
    const cfg = read(path.join(checkout, CONFIG_PATH));
    const { config } = parseConfigText(cfg?.toString('utf8') ?? null, checkout);
    for (const root of config.spec_roots) recordPath(path.resolve(checkout, root.path));
    const exists = (file: string) => read(file) !== null;
    const rawId = input.root !== undefined && !input.id.includes(':') ? `${input.root}:${input.id}` : input.id;
    const resolved = resolveSpecId(rawId, config, undefined, checkout, exists);
    const contents = read(resolved.path)!.toString('utf8');
    const data = validateSpec(contents, resolved.path);
    const snapshot: CompletionSnapshot = { resolve(reference, fromRoot) {
      const hit = resolveSpecId(reference, config, fromRoot, checkout, exists);
      const content = read(hit.path)!.toString('utf8');
      validateSpec(content, hit.path);
      return { id: `${hit.root}:${hit.id}`, content };
    } };
    const id = `${resolved.root}:${resolved.id}`;
    const previous = data.implementation as ImplementationDeclaration | undefined;
    const fingerprints = input.status === 'complete' ? fingerprintClosure({ id, content: contents }, snapshot) : null;
    const declaration: ImplementationDeclaration = { ...previous, status: input.status, ...(fingerprints ?? {}) };
    const same = isDeepStrictEqual(previous, declaration);
    const proposed = same ? contents : replaceImplementation(contents, declaration);
    const proposedData = validateSpec(proposed, resolved.path);
    const withoutImplementation = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'implementation'));
    if (!isDeepStrictEqual(withoutImplementation(data), withoutImplementation(proposedData))) throw new Error('Cannot preserve unrelated metadata while updating implementation');
    if (parseFrontmatter(contents).body !== parseFrontmatter(proposed).body) throw new Error('Cannot preserve spec body while updating implementation');
    const assessed = evaluateImplementation({ id, content: proposed }, snapshot);
    const changed = proposed !== contents;
    if (changed && !input.dryRun) {
      options.beforeRecheck?.();
      recheck();
      const temp = path.join(path.dirname(resolved.path), `.${path.basename(resolved.path)}.${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temp, proposed, { flag: 'wx', mode: fs.statSync(resolved.path).mode & 0o777 });
        recheck();
        fs.renameSync(temp, resolved.path);
      } finally { try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    }
    return { id, implementation_status: input.status, assessment_status: assessed.assessment_status as 'current' | 'unrecorded', assessment_reasons: assessed.assessment_reasons, fingerprint: fingerprints?.assessed_spec_hash ?? null, changed_file: path.relative(checkout, resolved.path), changed, dry_run: !!input.dryRun };
  } finally { lease?.release(); }
}
