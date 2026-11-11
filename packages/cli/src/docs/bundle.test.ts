import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { DocumentationBundleError, loadDocumentationBundle, minimumDocumentationTopics, type DocumentationManifest } from './bundle.js';
import { MANDATORY_NOTES } from './required-topics.js';

const assetRoot = fileURLToPath(new URL('../../assets/docs/', import.meta.url));
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function fixture(action: (root: string, manifest: DocumentationManifest, save: () => void) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-docs-'));
  try {
    fs.cpSync(assetRoot, root, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as DocumentationManifest;
    action(root, manifest, () => fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const invalid = (action: () => unknown) => assert.throws(action, error => error instanceof DocumentationBundleError && error.code === 'DOCS_BUNDLE_INVALID' && /Repair or reinstall/.test(error.message));

test('released docs package has the required topics, exact bytes and matching release versions', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const release = JSON.parse(fs.readFileSync(new URL('../../core-release.json', import.meta.url), 'utf8'));
  const bundle = loadDocumentationBundle(undefined, { core_version: pkg.version, docs_version: release.docsVersion, contract_version: release.contractVersion });
  const ids = bundle.topics.map(topic => topic.id);
  for (const id of minimumDocumentationTopics) assert.ok(ids.includes(id), id);
  assert.deepEqual(ids, [...ids].sort());
  assert.match(bundle.orientation, /Plans are optional/);
  for (const topic of bundle.topics) assert.equal(topic.content, fs.readFileSync(path.join(assetRoot, topic.path), 'utf8'));
  assert.deepEqual(bundle.manifest.required.notes, [...MANDATORY_NOTES]);
});

test('all executable documentation examples resolve delivered commands and options', () => {
  const bundle = loadDocumentationBundle();
  let examples = 0;
  for (const content of [bundle.orientation, ...bundle.topics.map(topic => topic.content)]) {
    for (const block of content.matchAll(/```sh\n([\s\S]*?)```/g)) for (const raw of block[1].trim().split('\n')) {
      const line = raw.replace(/\s+#.*$/, '').trim();
      if (!line.startsWith('specplane ')) continue; // install steps and other shell lines are not CLI examples
      const [, ...args] = line.split(/\s+/);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.js', import.meta.url)), ...args, '--help'], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${line}: ${result.stderr}`);
      const commandPath = ['spec', 'plan'].includes(args[0]) ? args.slice(0, 2) : args.slice(0, 1);
      const escapedPath = commandPath.join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(result.stdout, new RegExp(`^Usage: specplane ${escapedPath}(?:\\s|$)`, 'm'), line);
      for (const option of args.filter(arg => arg.startsWith('--'))) {
        const escapedOption = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(result.stdout, new RegExp(`(?:^|\\s)${escapedOption}(?:[\\s,=]|$)`, 'm'), `${line}: option absent from selected command help`);
      }
      examples++;
    }
  }
  assert.ok(examples >= 5);
});

test('bundle loads copied bytes outside any repository without configuration', () => fixture(root => {
  const bundle = loadDocumentationBundle(root);
  assert.ok(bundle.topics.length >= minimumDocumentationTopics.length);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  assert.equal(fs.existsSync(path.join(root, '.specplane')), false);
}));

test('closed metadata, versions, IDs, required topics and related links refuse corruption', () => {
  const edits: ((manifest: DocumentationManifest) => void)[] = [
    manifest => { (manifest as unknown as Record<string, unknown>).extra = true; },
    manifest => { manifest.format_version = 1 as 2; },
    manifest => { manifest.contract_version = 0; },
    manifest => { manifest.topics[1].id = manifest.topics[0].id; },
    manifest => { manifest.topics[0].id = 'search'; },
    manifest => { manifest.topics[0].id = '../escape'; },
    manifest => { manifest.topics = manifest.topics.filter(topic => topic.id !== 'concepts'); },
    manifest => { manifest.topics[0].summary = ''; },
    manifest => { manifest.required.notes = []; (manifest.required as unknown as Record<string, unknown>).extra = 1; },
    manifest => { manifest.topics[0].related = ['missing']; },
    manifest => { manifest.topics[0].path = manifest.orientation.path; },
    manifest => { manifest.topics[1].path = manifest.topics[0].path; },
  ];
  for (const edit of edits) fixture((root, manifest, save) => { edit(manifest); save(); invalid(() => loadDocumentationBundle(root)); });
  fixture(root => invalid(() => loadDocumentationBundle(root, { core_version: '9.0.0', docs_version: '0.1.0', contract_version: 1 })));
});

test('missing and corrupt manifest, orientation, topic and source bytes refuse without fallback', () => {
  for (const mode of ['missing', 'changed']) for (const role of ['manifest', 'orientation', 'topic']) fixture((root, manifest) => {
    const relative = role === 'manifest' ? 'manifest.json' : role === 'orientation' ? manifest.orientation.path : manifest.topics[0].path;
    if (mode === 'missing') fs.unlinkSync(path.join(root, relative));
    else fs.writeFileSync(path.join(root, relative), 'corrupt');
    invalid(() => loadDocumentationBundle(root));
  });
});

test('invalid UTF-8 refuses even when its digest is updated', () => fixture((root, manifest, save) => {
  const bytes = Buffer.from([0xc3, 0x28]);
  fs.writeFileSync(path.join(root, manifest.orientation.path), bytes);
  manifest.orientation.sha256 = sha(bytes); save();
  invalid(() => loadDocumentationBundle(root));
}));

test('portable traversal and absolute asset paths refuse', () => {
  for (const relative of ['../outside.md', '/outside.md', 'topics/../outside.md', 'topics\\outside.md', 'C:/outside.md', '//server/share.md', 'topics//empty.md', 'topics/CON.md']) fixture((root, manifest, save) => {
    if (relative === 'topics/CON.md' && process.platform !== 'win32') {
      const bytes = fs.readFileSync(path.join(root, manifest.topics[0].path));
      fs.writeFileSync(path.join(root, relative), bytes);
      manifest.topics[0].sha256 = sha(bytes);
    }
    manifest.topics[0].path = relative; save();
    assert.throws(() => loadDocumentationBundle(root), error => error instanceof DocumentationBundleError && /invalid contained path|Uncontained or nonportable evidence path/.test(error.message), relative);
  });
});

test('symlinked manifest, source, topic, orientation, parent and bundle root refuse', () => {
  for (const role of ['manifest', 'topic', 'orientation', 'parent', 'root']) fixture((root, manifest) => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-docs-links-'));
    try {
      if (role === 'root') {
        const link = path.join(container, 'linked');
        fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
        invalid(() => loadDocumentationBundle(link));
      } else if (role === 'parent') {
        const original = path.join(root, 'topics'), moved = path.join(container, 'topics');
        fs.renameSync(original, moved);
        fs.symlinkSync(moved, original, process.platform === 'win32' ? 'junction' : 'dir');
        invalid(() => loadDocumentationBundle(root));
      } else {
        const relative = role === 'manifest' ? 'manifest.json' : role === 'topic' ? manifest.topics[0].path : manifest.orientation.path;
        const original = path.join(root, relative), moved = path.join(container, 'file');
        fs.renameSync(original, moved); fs.symlinkSync(moved, original);
        invalid(() => loadDocumentationBundle(root));
      }
    } finally { fs.rmSync(container, { recursive: true, force: true }); }
  });
});
