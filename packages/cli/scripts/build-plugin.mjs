// Assemble the Claude Code plugin (`harnesses/claude/specifications/architecture/claude-integration` §10): the plugin
// sources of harnesses/claude/plugin plus a self-contained copy of the compiled core under core/, because the manifest
// starts `core/dist/harness/mcp-main.js` and the slash-command handler runs `core/dist/cli.js`. The result is dist/plugin
// (or the directory named by --out); it needs only Node, no install step.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--out');
const out = path.resolve(arg > 0 ? process.argv[arg + 1] : path.join(pkg, 'dist/plugin'));
const source = path.resolve(pkg, '../../harnesses/claude/plugin');
const skip = (file) => /\.test\.js(\.map)?$/.test(file) || /[\\/]dist[\\/](fixtures|test-repo)\.js/.test(file) || /[\\/]dist[\\/]plugin([\\/]|$)/.test(file);

if (!existsSync(path.join(pkg, 'dist/cli.js'))) throw new Error('Run the TypeScript build first: dist/cli.js is missing.');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'core'), { recursive: true });
for (const entry of ['.claude-plugin', 'hooks', 'LICENSE']) cpSync(path.join(source, entry), path.join(out, entry), { recursive: true });

const core = path.join(out, 'core');
// The output may sit inside dist, so copy its entries one by one and leave the plugin folder itself out.
for (const entry of readdirSync(path.join(pkg, 'dist'))) {
  if (path.join(pkg, 'dist', entry) === out) continue;
  cpSync(path.join(pkg, 'dist', entry), path.join(core, 'dist', entry), { recursive: true, filter: (f) => !skip(f) });
}
for (const entry of ['assets/docs', 'assets/ai-docs', 'assets/steering', 'assets/commands', 'package.json', 'core-release.json']) {
  cpSync(path.join(pkg, entry), path.join(core, entry), { recursive: true });
}
// Production dependencies only, with their own dependencies, exactly as installed here.
const listed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: pkg, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const dir of listed) {
  if (path.resolve(dir) === pkg) continue;
  const rel = path.relative(path.join(pkg, 'node_modules'), dir);
  if (rel.startsWith('..')) throw new Error(`Unexpected dependency location: ${dir}`);
  cpSync(dir, path.join(core, 'node_modules', rel), { recursive: true });
}
const manifest = JSON.parse(readFileSync(path.join(out, '.claude-plugin/plugin.json'), 'utf8'));
for (const server of Object.values(manifest.mcpServers ?? {})) {
  for (const a of server.args ?? []) {
    const file = a.replace('${CLAUDE_PLUGIN_ROOT}', out);
    if (file !== a && !existsSync(file)) throw new Error(`The plugin manifest names a file the package lacks: ${a}`);
  }
}
console.log(`Claude plugin written to ${path.relative(process.cwd(), out) || '.'}`);
