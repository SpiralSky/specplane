// Derives the AI-facing documentation from the built user bundle (`steering` R23, `reference-cli` §12.5): an
// always-loaded essentials file under a size limit, and the searchable remainder (the bundle itself, read through
// `docs search`). Deterministic: the same user documentation gives the same bytes. Needs `build-docs` first.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { MANDATORY_NOTES, ESSENTIALS_LIMIT_BYTES } from '../dist/docs/required-topics.js';
import { noteText } from '../dist/docs/required.js';

const bundle = new URL('../assets/docs/', import.meta.url);
const target = new URL('../assets/ai-docs/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', bundle), 'utf8'));
const topicText = manifest.topics.map((t) => readFileSync(new URL(t.path, bundle), 'utf8')).join('\n');

const orientation = readFileSync(new URL(manifest.orientation.path, bundle), 'utf8').replace(/^# .*\n+/, '').trim();
const lines = [
  '# Specplane essentials', '',
  orientation, '',
  '## Finding information', '',
  'The full documentation is not loaded into your context. Search it with the `docs.search` action (or `specplane docs search <text>` for a person), then read only the topic you need.', '',
  '## Topics', '',
  ...manifest.topics.map((t) => `- \`${t.id}\`: ${t.summary}`), '',
  '## Always apply', '',
  ...MANDATORY_NOTES.map((id) => `- ${noteText(topicText, id).replace(/\s+/g, ' ')}`), '',
];
const essentials = lines.join('\n');
const bytes = Buffer.byteLength(essentials);
if (bytes > ESSENTIALS_LIMIT_BYTES) { console.error(`build-ai-docs: essentials are ${bytes} bytes, over the ${ESSENTIALS_LIMIT_BYTES} limit`); process.exit(1); }

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
writeFileSync(new URL('essentials.md', target), essentials);
writeFileSync(new URL('manifest.json', target), JSON.stringify({
  format_version: 1,
  docs_version: manifest.docs_version,
  essentials: { path: 'essentials.md', sha256: createHash('sha256').update(essentials).digest('hex'), bytes },
  remainder: { search: 'docs.search', topics: manifest.topics.map((t) => t.id) },
}, null, 2) + '\n');
