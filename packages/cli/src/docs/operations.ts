import { readFileSync } from 'node:fs';
import { DocumentationBundleError, loadDocumentationBundle, type DocumentationBundle, type DocumentationSource } from './bundle.js';

export type DocsIndex = { version: string; docs_version: string; orientation: string; items: { topic_id: string; title: string; related: string[] }[] };
export type DocsTopic = { topic_id: string; title: string; version: string; docs_version: string; source_references: DocumentationSource[]; related: string[]; content: string };
export type DocsSearch = { version: string; docs_version: string; items: { topic_id: string; title: string; excerpts: { line: number; text: string }[] }[] };

/** Caller mistakes (unknown topic, empty query). Package damage is `DocumentationBundleError`; both exit 1. */
export class DocsUsageError extends Error {
  readonly code: 'DOCS_UNKNOWN_TOPIC' | 'DOCS_EMPTY_QUERY';
  constructor(code: DocsUsageError['code'], message: string) { super(message); this.name = 'DocsUsageError'; this.code = code; }
}

const MAX_EXCERPTS = 3;
const discovery = 'Run `specplane docs` to list topics or `specplane docs search <text>` to search them.';

/** Released docs only: never consults a repository, configuration or the network. */
export function loadReleasedDocs(bundleDirectory?: string): DocumentationBundle {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  const release = JSON.parse(readFileSync(new URL('../../core-release.json', import.meta.url), 'utf8')) as { docsVersion: string; contractVersion: number };
  return loadDocumentationBundle(bundleDirectory, { core_version: pkg.version, docs_version: release.docsVersion, contract_version: release.contractVersion });
}

export function docsIndex(bundleDirectory?: string): DocsIndex {
  const { manifest, orientation, topics } = loadReleasedDocs(bundleDirectory);
  return { version: manifest.core_version, docs_version: manifest.docs_version, orientation, items: topics.map(t => ({ topic_id: t.id, title: t.title, related: [...t.related] })) };
}

export function docsTopic(id: string, bundleDirectory?: string): DocsTopic {
  const { manifest, topics } = loadReleasedDocs(bundleDirectory);
  // Exact match against manifest IDs only; the input never reaches a filesystem path.
  const topic = topics.find(t => t.id === id);
  if (!topic) throw new DocsUsageError('DOCS_UNKNOWN_TOPIC', `Unknown documentation topic \`${id.replace(/[\x00-\x1f`]/g, '?')}\`. ${discovery}`);
  return { topic_id: topic.id, title: topic.title, version: manifest.core_version, docs_version: manifest.docs_version, source_references: topic.sources.map(s => ({ ...s })), related: [...topic.related], content: topic.content };
}

/**
 * Case-insensitive literal match over title and body, sorted by topic ID, at most three matching body lines per topic.
 * A topic whose title matches but no body line does is still returned, with an empty excerpt list (D7).
 */
export function docsSearch(query: string, bundleDirectory?: string): DocsSearch {
  if (query.trim() === '') throw new DocsUsageError('DOCS_EMPTY_QUERY', `Search text must not be empty. ${discovery}`);
  const { manifest, topics } = loadReleasedDocs(bundleDirectory);
  const needle = query.toLowerCase();
  const items: DocsSearch['items'] = [];
  for (const topic of topics) {
    const excerpts: { line: number; text: string }[] = [];
    const lines = topic.content.split(/\r?\n/);
    for (let i = 0; i < lines.length && excerpts.length < MAX_EXCERPTS; i++) {
      if (lines[i].toLowerCase().includes(needle)) excerpts.push({ line: i + 1, text: lines[i].trim() });
    }
    if (excerpts.length || topic.title.toLowerCase().includes(needle)) items.push({ topic_id: topic.id, title: topic.title, excerpts });
  }
  items.sort((a, b) => (a.topic_id < b.topic_id ? -1 : a.topic_id > b.topic_id ? 1 : 0));
  return { version: manifest.core_version, docs_version: manifest.docs_version, items };
}

export function renderIndex(index: DocsIndex): string {
  const rows = index.items.map(i => `  ${i.topic_id}  ${i.title}`).join('\n');
  return `${index.orientation.trimEnd()}\n\nTopics (Specplane ${index.version}, docs ${index.docs_version}):\n${rows}\n\nRun \`specplane docs <topic>\` to read one, or \`specplane docs search <text>\` to search.\n`;
}
export function renderTopic(topic: DocsTopic): string {
  const related = topic.related.length ? `\nRelated: ${topic.related.join(', ')}\n` : '';
  return `${topic.content.trimEnd()}\n${related}`;
}
export function renderSearch(result: DocsSearch): string {
  if (!result.items.length) return 'No matching topics.\n';
  return result.items.map(i => `${i.topic_id}  ${i.title}\n${i.excerpts.map(e => `  ${e.line}: ${e.text}`).join('\n')}${i.excerpts.length ? '\n' : ''}`).join('\n');
}
export { DocumentationBundleError };
