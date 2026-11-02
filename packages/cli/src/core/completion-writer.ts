import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';
import { isDeepStrictEqual } from 'node:util';
import { CONFIG_PATH, parseConfigText } from '../config.js';
import { checkoutRoot } from '../git/repo.js';
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
  const node = yaml.dump({ implementation: declaration }, { lineWidth: -1, noRefs: true }).replace(/\n/g, eol);
  const lines = header.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const at = lines.findIndex(line => /^(?:implementation|['"]implementation['"])[ \t]*:/.test(line));
  if (at < 0) {
    if (Object.hasOwn(parseFrontmatter(text).data, 'implementation')) throw new Error('Cannot safely locate implementation metadata');
    return start[0] + header + (header && !/[\r\n]$/.test(header) ? eol : '') + node + rest.slice(close.index);
  }
  let end = at + 1;
  while (end < lines.length && !/^(?:[^\s#]|---)/.test(lines[end])) end++;
  // Comments and blank lines after a block belong to the surrounding document.
  while (end > at + 1 && /^[ \t]*(?:#.*)?(?:\r\n|\n|\r)?$/.test(lines[end - 1])) end--;
  return start[0] + lines.slice(0, at).join('') + node + lines.slice(end).join('') + rest.slice(close.index);
}

export function writeImplementation(input: { id: string; root?: string; status: 'incomplete' | 'partial' | 'complete'; dryRun?: boolean }, cwd: string): CompletionReceipt {
  if (!['incomplete', 'partial', 'complete'].includes(input.status)) throw new Error('Invalid implementation status');
  const checkout = checkoutRoot(cwd);
  const lease = input.dryRun ? undefined : acquireWriterLease({ checkouts: [checkout], repository: true, requestId: randomUUID() });
  try {
    const observations = new Map<string, string | null>();
    const read = (file: string): Buffer | null => {
      let bytes: Buffer | null;
      try { bytes = fs.readFileSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; bytes = null; }
      const value = bytes === null ? null : digest(bytes);
      if (observations.has(file) && observations.get(file) !== value) throw new Error(`Input changed during assessment: ${file}`);
      observations.set(file, value);
      return bytes;
    };
    const cfg = read(path.join(checkout, CONFIG_PATH));
    const { config } = parseConfigText(cfg?.toString('utf8') ?? null, checkout);
    const exists = (file: string) => read(file) !== null;
    const resolved = resolveSpecId(input.id, config, input.root, checkout, exists);
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
    validateSpec(proposed, resolved.path);
    const assessed = evaluateImplementation({ id, content: proposed }, snapshot);
    const changed = proposed !== contents;
    if (changed && !input.dryRun) {
      const temp = path.join(path.dirname(resolved.path), `.${path.basename(resolved.path)}.${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temp, proposed, { flag: 'wx', mode: fs.statSync(resolved.path).mode & 0o777 });
      lease!.assertOwned();
      for (const [file, expected] of observations) {
        let actual: string | null;
        try { actual = digest(fs.readFileSync(file)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; actual = null; }
        if (actual !== expected) throw new Error(`Input changed during assessment: ${file}`);
      }
        fs.renameSync(temp, resolved.path);
      } finally { try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    }
    return { id, implementation_status: input.status, assessment_status: assessed.assessment_status as 'current' | 'unrecorded', assessment_reasons: assessed.assessment_reasons, fingerprint: fingerprints?.assessed_spec_hash ?? null, changed_file: path.relative(checkout, resolved.path), changed, dry_run: !!input.dryRun };
  } finally { lease?.release(); }
}
