import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { coreInfo } from '../core/build-info.js';
import { validateCompatibility, type Capabilities, type ExtensionManifest } from '../core/compatibility.js';
import { loadDocumentationBundle } from '../docs/bundle.js';
import { hasAnchor } from '../spec/slug.js';

/** A tree or file copied into the package; `to` is package-relative. */
export interface PackageInput { from: string; to: string }
export interface PackageProcedure { workflow: string; contracts: { sourceId: string; anchor: string }[] }
export interface PackageBuildOptions {
  /** Absolute path of a directory that does not exist or is empty. Nothing outside it is written. */
  outDir: string;
  extension: { id: string; host: string };
  capabilities: Capabilities;
  /** Documentation bundle directory; packaged under `docs/`. */
  docsDir: string;
  /** Runtime and dependency files/trees (kind `core` through the inventory). */
  runtime: PackageInput[];
  /** Reasoning or hook assets, listed individually in the manifest. */
  assets?: (PackageInput & { kind: 'reasoning' | 'hook' })[];
  /** Instruction file; the builder stamps the shared orientation metadata line. */
  instructions: PackageInput;
  procedures: PackageProcedure[];
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fail = (message: string): never => { throw new Error(`Package build refused: ${message}`); };
const rel = /^(?!\/)(?:[^\\/:]+\/)*[^\\/:]+$/;

function copyInput(outDir: string, input: PackageInput): string[] {
  if (!rel.test(input.to) || input.to.split('/').some(part => part === '.' || part === '..')) fail(`invalid package path ${input.to}`);
  const stat = fs.lstatSync(input.from);
  if (stat.isSymbolicLink()) fail(`link input ${input.from}`);
  const entries = (source: string, target: string): string[] => {
    const info = fs.lstatSync(source);
    if (info.isSymbolicLink()) return fail(`link input ${source}`);
    if (info.isDirectory()) return fs.readdirSync(source).sort().flatMap(name => entries(path.join(source, name), `${target}/${name}`));
    if (!info.isFile()) return fail(`non-regular input ${source}`);
    const dest = path.join(outDir, target);
    if (fs.existsSync(dest)) fail(`duplicate package path ${target}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    return [target];
  };
  return entries(input.from, input.to);
}
function walk(root: string, prefix = ''): string[] {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, name) : [name];
  }).sort();
}

/**
 * Builds a package from current inputs into an empty directory, derives the build inventory and manifest from the
 * written bytes, and validates the result with the same compatibility check hosts use. It never touches a host
 * location, certifies no host version (`hostCompatibility` stays empty), and records no release pin.
 */
export async function buildExtensionPackage(options: PackageBuildOptions): Promise<ExtensionManifest> {
  const { outDir } = options;
  if (!path.isAbsolute(outDir)) fail('outDir must be absolute');
  const existed = fs.existsSync(outDir);
  if (existed && (!fs.lstatSync(outDir).isDirectory() || fs.readdirSync(outDir).length)) fail('outDir must be an empty directory');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const versions = { core_version: coreInfo.version, docs_version: coreInfo.docsVersion, contract_version: coreInfo.contractVersion };
    const bundle = loadDocumentationBundle(options.docsDir, versions); // refuses invalid or version-drifted docs first
    copyInput(outDir, { from: options.docsDir, to: 'docs' });
    for (const input of options.runtime) copyInput(outDir, input);
    const assets: ExtensionManifest['assets'] = [];
    for (const asset of options.assets ?? []) for (const file of copyInput(outDir, asset)) assets.push({ path: file, sha256: '', kind: asset.kind });
    const [instructionPath] = copyInput(outDir, options.instructions);
    const metadata = `<!-- specplane-orientation: ${JSON.stringify({ docs_version: coreInfo.docsVersion, contract_version: coreInfo.contractVersion, sha256: bundle.manifest.orientation.sha256 })} -->\n`;
    const body = fs.readFileSync(path.join(outDir, instructionPath), 'utf8').replace(/<!-- specplane-orientation: [^\n]* -->\n?/g, '');
    fs.writeFileSync(path.join(outDir, instructionPath), metadata + body);

    const sources = new Map(bundle.manifest.topics.flatMap(topic => topic.sources).map(source => [source.id, source]));
    if (!options.procedures.length) fail('no procedures');
    const procedures: ExtensionManifest['procedures'] = options.procedures.map(procedure => ({
      workflow: procedure.workflow,
      contracts: procedure.contracts.map(contract => {
        const source = sources.get(contract.sourceId) ?? fail(`unresolved contract ${contract.sourceId}`);
        const bytes = fs.readFileSync(path.join(options.docsDir, source.path));
        if (!hasAnchor(bytes.toString('utf8'), contract.anchor)) fail(`missing heading ${contract.sourceId}#${contract.anchor}`);
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        return { id: source.id, anchor: contract.anchor, blob, sha256: source.sha256, path: `docs/${source.path}` };
      }),
    }));

    const inventoryFiles = walk(outDir);
    const inventoryPath = 'core/inventory.json';
    if (inventoryFiles.includes(inventoryPath) || inventoryFiles.includes('specplane-extension.json')) fail('inputs may not supply package metadata');
    const digest = (name: string) => sha256(fs.readFileSync(path.join(outDir, name)));
    const inventory = JSON.stringify({ root: '.', files: inventoryFiles.map(name => ({ path: name, sha256: digest(name) })) });
    fs.mkdirSync(path.join(outDir, 'core'), { recursive: true });
    fs.writeFileSync(path.join(outDir, inventoryPath), inventory);
    const manifest: ExtensionManifest = {
      schemaVersion: 1,
      extension: { ...options.extension, version: coreInfo.version },
      core: { ...coreInfo },
      hostCompatibility: [],
      capabilities: options.capabilities,
      procedures,
      assets: [
        { path: inventoryPath, sha256: sha256(inventory), kind: 'core' },
        ...inventoryFiles.filter(name => name.startsWith('docs/')).map(name => ({ path: name, sha256: digest(name), kind: 'docs' as const })),
        ...assets.map(asset => ({ ...asset, sha256: digest(asset.path) })),
        { path: instructionPath, sha256: digest(instructionPath), kind: 'instructions' as const },
      ],
    };
    fs.writeFileSync(path.join(outDir, 'specplane-extension.json'), JSON.stringify(manifest));
    const checked = await validateCompatibility(manifest, {
      packageRoot: fs.realpathSync(outDir), extensionId: options.extension.id, host: options.extension.host,
      surface: 'package-build', workflow: options.procedures[0].workflow, probes: { nativeCommands: false, backgroundSessions: false },
    }, coreInfo);
    if (!checked.ok) fail(`built package does not validate: ${checked.error.message}`);
    return manifest;
  } catch (error) {
    fs.rmSync(outDir, { recursive: true, force: true });
    if (existed) fs.mkdirSync(outDir);
    throw error;
  }
}
