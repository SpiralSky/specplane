// Builds the released user documentation bundle: copies `docs/user/` to `assets/docs/` with a manifest, after
// checking that the required topics, commands, configuration keys, permissions and notes are all documented
// (`architecture/reference-cli` §12.5). Needs the compiled CLI (`dist/`). Generated files are never edited by hand.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { coreInfo } from '../dist/build-info.js';
import { checkRequiredTopics, collectRequiredInputs, requiredFacts } from '../dist/docs/required.js';

const source = new URL('../../../docs/user/', import.meta.url);
const target = new URL('../assets/docs/', import.meta.url);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const fail = (message) => { console.error(`build-docs: ${message}`); process.exit(1); };

const docs = new Map();
const meta = new Map();
let orientation = '';
for (const name of readdirSync(source).filter((n) => n.endsWith('.md')).sort()) {
  const text = readFileSync(new URL(name, source), 'utf8');
  const id = name.slice(0, -3);
  if (id === 'orientation') { orientation = text; continue; }
  const m = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(text);
  if (!m) fail(`${name} has no frontmatter (title, summary)`);
  const front = parse(m[1]) ?? {};
  if (typeof front.title !== 'string' || !front.title.trim() || typeof front.summary !== 'string' || !front.summary.trim()) fail(`${name} needs a title and a summary`);
  const related = front.related ?? [];
  if (!Array.isArray(related) || related.some((r) => typeof r !== 'string')) fail(`${name}: related must be a list of topic ids`);
  docs.set(id, m[2].trimEnd() + '\n');
  meta.set(id, { title: front.title.trim(), summary: front.summary.trim(), related });
}
if (!orientation.trim()) fail('docs/user/orientation.md is missing or empty');
for (const [id, { related }] of meta) for (const r of related) if (!docs.has(r)) fail(`${id}: related topic \`${r}\` does not exist`);

const inputs = collectRequiredInputs();
const errors = checkRequiredTopics(docs, inputs);
if (errors.length) fail(`the user documentation is incomplete:\n  ${errors.join('\n  ')}`);

rmSync(target, { recursive: true, force: true });
mkdirSync(new URL('topics/', target), { recursive: true });
writeFileSync(new URL('orientation.md', target), orientation.trimEnd() + '\n');
const topics = [...docs.keys()].sort().map((id) => {
  writeFileSync(new URL(`topics/${id}.md`, target), docs.get(id));
  const { title, summary, related } = meta.get(id);
  return { id, title, summary, path: `topics/${id}.md`, sha256: sha(docs.get(id)), related: [...related].sort() };
});
const manifest = {
  format_version: 2,
  core_version: coreInfo.version,
  docs_version: coreInfo.docsVersion,
  contract_version: coreInfo.contractVersion,
  orientation: { path: 'orientation.md', sha256: sha(orientation.trimEnd() + '\n') },
  required: requiredFacts(inputs),
  topics,
};
writeFileSync(new URL('manifest.json', target), JSON.stringify(manifest, null, 2) + '\n');
