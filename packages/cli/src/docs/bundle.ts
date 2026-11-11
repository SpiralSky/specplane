import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { readContainedFile } from './contained-files.js';

import { REQUIRED_TOPIC_IDS } from './required-topics.js';
export { ESSENTIALS_LIMIT_BYTES } from './required-topics.js';

/** Topics every released bundle contains (`reference-cli` §12.5); the build also checks their content. */
export const minimumDocumentationTopics = REQUIRED_TOPIC_IDS;
/** The generated bundle is copied from `docs/user/` by `scripts/build-docs.mjs`; its manifest lists what it must document. */
export type DocumentationRequired = { commands: string[]; config_keys: string[]; permissions: string[]; notes: string[] };
export type DocumentationTopicEntry = { id: string; title: string; summary: string; path: string; sha256: string; related: string[] };
export type DocumentationVersions = { core_version: string; docs_version: string; contract_version: number };
export type DocumentationManifest = DocumentationVersions & { format_version: 2; orientation: { path: string; sha256: string }; required: DocumentationRequired; topics: DocumentationTopicEntry[] };
export type DocumentationTopic = DocumentationTopicEntry & { content: string };
export type DocumentationBundle = { manifest: DocumentationManifest; orientation: string; topics: DocumentationTopic[] };
export class DocumentationBundleError extends Error {
  readonly code = 'DOCS_BUNDLE_INVALID';
  constructor(reason: string) { super(`Invalid documentation bundle: ${reason}. Repair or reinstall the Specplane package.`); this.name = 'DocumentationBundleError'; }
}
function fail(message: string): never { throw new DocumentationBundleError(message); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!record(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('invalid manifest fields');
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function topicId(value: unknown): value is string { return typeof value === 'string' && value !== 'search' && /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(value); }
function relativePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\x00-\x1f<>:"|?*]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) fail('invalid contained path');
}

/** Read only released package bytes. No repository, configuration or network lookup. */
export function loadDocumentationBundle(
  bundleDirectory = fileURLToPath(new URL('../../assets/docs/', import.meta.url)),
  expectedVersions?: DocumentationVersions,
): DocumentationBundle {
  try {
    const decode = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const read = (file: string) => decode(readContainedFile(bundleDirectory, file));
    const document: unknown = JSON.parse(read('manifest.json'));
    exact(document, ['format_version', 'core_version', 'docs_version', 'contract_version', 'orientation', 'required', 'topics']);
    if (document.format_version !== 2 || !text(document.core_version) || !text(document.docs_version) || !Number.isSafeInteger(document.contract_version) || (document.contract_version as number) < 1) fail('invalid bundle version');
    if (expectedVersions && Object.entries(expectedVersions).some(([key, value]) => document[key] !== value)) fail('bundle version does not match the released core');
    const paths = new Map<string, string>([['manifest.json', 'manifest']]);
    const verified = (entry: Record<string, unknown>, role: string): string => {
      relativePath(entry.path);
      if (!digest(entry.sha256)) fail('invalid SHA-256');
      const previous = paths.get(entry.path);
      if (previous) fail(`duplicate asset path ${entry.path}`);
      paths.set(entry.path, role);
      const bytes = readContainedFile(bundleDirectory, entry.path);
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) fail(`digest mismatch for ${entry.path}`);
      return decode(bytes);
    };
    exact(document.required, ['commands', 'config_keys', 'permissions', 'notes']);
    if (Object.values(document.required).some(list => !Array.isArray(list) || list.some(item => !text(item)))) fail('invalid required lists');
    exact(document.orientation, ['path', 'sha256']);
    const orientation = verified(document.orientation, 'orientation');
    if (!orientation.trim()) fail('empty orientation');
    if (!Array.isArray(document.topics) || !document.topics.length) fail('empty topic index');
    const ids = new Set<string>();
    const topics: DocumentationTopic[] = [];
    for (const entry of document.topics) {
      exact(entry, ['id', 'title', 'summary', 'path', 'sha256', 'related']);
      if (!topicId(entry.id) || ids.has(entry.id) || !text(entry.title) || !text(entry.summary) || !Array.isArray(entry.related) || !entry.related.every(topicId) || new Set(entry.related).size !== entry.related.length) fail('invalid or duplicate topic');
      ids.add(entry.id);
      const content = verified(entry, `topic:${entry.id}`);
      if (!content.trim()) fail(`empty topic ${entry.id}`);
      topics.push({ ...(entry as DocumentationTopicEntry), content });
    }
    if (topics.some(topic => topic.related.some(id => !ids.has(id)))) fail('unresolved related topic');
    if (minimumDocumentationTopics.some(id => !ids.has(id))) fail('missing minimum documentation topic');
    return { manifest: document as DocumentationManifest, orientation, topics };
  } catch (error) {
    if (error instanceof DocumentationBundleError) throw error;
    throw new DocumentationBundleError(error instanceof Error ? error.message : String(error));
  }
}
