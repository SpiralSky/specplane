/** Pure attribution patch. Callers must establish trusted action evidence first. */
import * as yaml from 'js-yaml';
import { isDeepStrictEqual } from 'node:util';
import { parseFrontmatter } from '../frontmatter.js';
import { SPEC_COMMON_SCHEMA, validator } from '../schemas.js';
import { contributionTrailer, deduplicateContributions, type ContributorSummary } from './contributions.js';
import type { ContributionEvent } from './contracts.js';

function contributors(value: unknown): ContributorSummary[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Invalid contributor summaries');
  const ids = new Set<string>(), models = new Set<string>();
  const allowed = new Set(['id', 'kind', 'provider', 'model_id', 'display_name', 'roles']);
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !allowed.has(k)) ||
      typeof item.id !== 'string' || !item.id || !['human', 'model'].includes(item.kind) ||
      !Array.isArray(item.roles) || !item.roles.length || item.roles.some((r: unknown) => !['create', 'revise', 'review'].includes(r as string)) || new Set(item.roles).size !== item.roles.length ||
      ['provider', 'model_id'].some(k => item[k] !== undefined && (typeof item[k] !== 'string' || !item[k])) ||
      (item.display_name !== undefined && typeof item.display_name !== 'string')) throw new Error('Invalid contributor summary');
    if (ids.has(item.id)) throw new Error('Duplicate contributor ID');
    ids.add(item.id);
    if (item.kind === 'model' && item.provider && item.model_id) {
      const key = JSON.stringify([item.provider, item.model_id]);
      if (models.has(key)) throw new Error('Duplicate known model contributor');
      models.add(key);
    }
  }
  return structuredClone(value) as ContributorSummary[];
}

/** Source spans retain all bytes outside the value being replaced. */
function replaceField(text: string, field: 'author' | 'contributors', value: unknown): string {
  const start = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)/.exec(text);
  if (!start) throw new Error('Missing frontmatter');
  const rest = text.slice(start[0].length), close = /^---[^\r\n]*(?:\r\n|\n|\r|$)/m.exec(rest);
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
  const at = entries.findIndex((node, index) => index % 2 === 0 && node.value === field);
  const replacement = yaml.dump(value, { flowLevel: 0, lineWidth: -1, noRefs: true }).trim();
  if (at >= 0) {
    const item = entries[at + 1];
    if (!item) throw new Error(`Cannot locate ${field} value`);
    // Block sequences/mappings may include following comments in every parent
    // node's end position. Descend to the final value, while retaining closing
    // punctuation for flow nodes such as roles: [review].
    const valueEnd = (node: Node): number => {
      const raw = header.slice(node.start, node.end).trimStart();
      if (node.children.length && !/^(?:&[^\s]+\s+)?[\[{]/.test(raw)) return valueEnd(node.children[node.children.length - 1]);
      let end = node.end;
      while (end > node.start && /\s/.test(header[end - 1])) end--;
      return end;
    };
    const end = valueEnd(item);
    if (field === 'author' && /(?:^|\s)[&*][^\s]+/.test(header.slice(item.start, end))) throw new Error('Cannot safely replace anchored author metadata');
    const prefix = header.slice(0, item.start);
    return start[0] + prefix + (/[ \t]$/.test(prefix) ? '' : ' ') + replacement + header.slice(end) + rest.slice(close.index);
  }
  if (Object.hasOwn(parseFrontmatter(text).data, field)) throw new Error(`Cannot safely locate ${field} metadata`);
  if (header.slice(mapping.start, mapping.end).trimStart().startsWith('{')) {
    const brace = header.lastIndexOf('}', mapping.end - 1);
    if (brace < 0) throw new Error('Cannot locate YAML mapping end');
    return start[0] + header.slice(0, brace) + (entries.length ? ', ' : '') + `${field}: ${replacement}` + header.slice(brace) + rest.slice(close.index);
  }
  const first = entries[0];
  const indent = first ? /^ */.exec(header.slice(header.lastIndexOf('\n', first.start - 1) + 1))?.[0] ?? '' : '';
  return start[0] + header + (header && !/[\r\n]$/.test(header) ? eol : '') + `${indent}${field}: ${replacement}${eol}` + rest.slice(close.index);
}

/** One spec per call; metadata edits create no recursive contribution events. */
export function prepareContributionMetadata(text: string, events: readonly ContributionEvent[]): { text: string; trailers: string[] } {
  const before = parseFrontmatter(text), valid = validator(SPEC_COMMON_SCHEMA);
  if (!valid(before.data)) throw new Error('Invalid spec metadata');
  const summaries = contributors(before.data.contributors);
  const unique = deduplicateContributions(events, () => true);
  const specs = new Set(unique.map(event => event.spec));
  if (specs.size > 1 || unique.some(event => event.spec.indexOf(':') < 1 || event.spec.slice(event.spec.indexOf(':') + 1) !== before.data.id)) throw new Error('Contribution events must identify this exact spec');
  if (!unique.length) return { text, trailers: [] };
  let author = before.data.author as 'user' | 'llm' | 'mixed';
  const trailers = unique.map(event => {
    const actor = event.actor;
    // Use the event's stable ID for a new known pair, rather than allocating a
    // fresh UUID on every proposal revalidation. Existing pair IDs remain intact.
    const known = actor.kind === 'model' && actor.provider && actor.model_id;
    const existing = known ? summaries.find(s => s.kind === 'model' && s.provider === actor.provider && s.model_id === actor.model_id) : summaries.find(s => s.id === event.eventId);
    if (!existing && summaries.some(s => s.id === event.eventId)) throw new Error('Contribution event ID collides with an unrelated summary');
    if (existing && !known && (existing.kind !== actor.kind || existing.provider !== actor.provider || existing.model_id !== actor.model_id)) throw new Error('Contribution identity conflicts with existing summary');
    if (!existing && known) summaries.push({ id: event.eventId, kind: 'model', provider: actor.provider, model_id: actor.model_id, ...(actor.display_name !== undefined ? { display_name: actor.display_name } : {}), roles: [] });
    if (event.role !== 'review') {
      const bodyAuthor = actor.kind === 'human' ? 'user' : 'llm';
      if (author !== bodyAuthor) author = 'mixed';
    }
    return JSON.stringify(contributionTrailer(event, summaries, () => true));
  });
  let proposed = text;
  if (!isDeepStrictEqual(before.data.contributors, summaries)) {
    // Shared anchors couple the edited field to metadata outside our ownership.
    // Refuse rather than silently severing that relationship while rewriting it.
    const counts = new Map<object, number>();
    const count = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      counts.set(value, (counts.get(value) ?? 0) + 1);
      for (const child of Object.values(value)) count(child);
    };
    count(before.data);
    const assertUnshared = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (counts.get(value)! > 1) throw new Error('Cannot safely replace shared contributor YAML anchors');
      for (const child of Object.values(value)) assertUnshared(child);
    };
    assertUnshared(before.data.contributors);
    proposed = replaceField(proposed, 'contributors', summaries);
  }
  if (author !== before.data.author) proposed = replaceField(proposed, 'author', author);
  const after = parseFrontmatter(proposed);
  if (!valid(after.data)) throw new Error('Invalid resulting spec metadata');
  contributors(after.data.contributors);
  const other = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => !['author', 'contributors'].includes(key)));
  if (!isDeepStrictEqual(other(before.data), other(after.data)) || !isDeepStrictEqual(after.data.contributors, summaries) || after.data.author !== author || before.body !== after.body) throw new Error('Cannot preserve unrelated spec metadata and body');
  return { text: proposed, trailers };
}

/** Refine-then-write has shared human/model authorship, independent of event capture. */
export function setFinalizedAssistAuthor(text: string): string {
  const before = parseFrontmatter(text), valid = validator(SPEC_COMMON_SCHEMA);
  if (!valid(before.data)) throw new Error('Invalid spec metadata');
  if (before.data.author === 'mixed') return text;
  const proposed = replaceField(text, 'author', 'mixed');
  const after = parseFrontmatter(proposed);
  const withoutAuthor = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'author'));
  if (!valid(after.data) || after.data.author !== 'mixed' || !isDeepStrictEqual(withoutAuthor(before.data), withoutAuthor(after.data)) || before.body !== after.body) throw new Error('Cannot preserve unrelated metadata and body while setting assist authorship');
  return proposed;
}
