import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// The first command-documentation slice. U13 expands the general documentation bundle.
const directory = new URL('../assets/commands/', import.meta.url);
const source = readFileSync(new URL('../../../docs/user/harness-commands.md', import.meta.url), 'utf8');
const docs = Object.fromEntries([...source.matchAll(/^## ([a-z-]+)\n\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
  .map((match) => [match[1], match[2].trim()]));
const commands = readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)).sort();
if (JSON.stringify(Object.keys(docs).sort()) !== JSON.stringify(commands) || Object.values(docs).some((text) => !text)) {
  throw new Error('Every command contract must have non-empty user documentation, with no extra topics');
}
writeFileSync(new URL('documentation.json', directory), JSON.stringify(docs, null, 2) + '\n');
