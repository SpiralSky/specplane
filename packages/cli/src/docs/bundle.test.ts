import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { DocumentationBundleError, loadDocumentationBundle, minimumDocumentationTopics, type DocumentationManifest } from './bundle.js';

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

test('released docs package has ordered minimum topics, exact snapshots and matching release versions', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const release = JSON.parse(fs.readFileSync(new URL('../../core-release.json', import.meta.url), 'utf8'));
  const bundle = loadDocumentationBundle(undefined, { core_version: pkg.version, docs_version: release.docsVersion, contract_version: release.contractVersion });
  assert.deepEqual(bundle.topics.map(topic => topic.id), minimumDocumentationTopics);
  assert.match(bundle.orientation, /plans are optional/);
  for (const topic of bundle.topics) {
    assert.equal(topic.content, fs.readFileSync(path.join(assetRoot, topic.path), 'utf8'));
    for (const source of topic.sources) assert.equal(sha(fs.readFileSync(path.join(assetRoot, source.path))), source.sha256);
  }
});

test('all executable documentation examples resolve delivered commands and options', () => {
  const bundle = loadDocumentationBundle();
  let examples = 0;
  for (const content of [bundle.orientation, ...bundle.topics.map(topic => topic.content)]) {
    for (const block of content.matchAll(/```sh\n([\s\S]*?)```/g)) for (const line of block[1].trim().split('\n')) {
      const [executable, ...args] = line.split(/\s+/);
      assert.equal(executable, 'specplane');
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
  assert.ok(examples >= 8);
  assert.match(bundle.orientation, /pending/);
  assert.match(bundle.orientation, /unavailable/);
});

test('bundle loads copied bytes outside any repository without configuration', () => fixture(root => {
  const bundle = loadDocumentationBundle(root);
  assert.equal(bundle.topics.length, 5);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  assert.equal(fs.existsSync(path.join(root, '.specplane')), false);
}));

test('closed metadata, versions, IDs, required topics and related links refuse corruption', () => {
  const edits: ((manifest: DocumentationManifest) => void)[] = [
    manifest => { (manifest as unknown as Record<string, unknown>).extra = true; },
    manifest => { manifest.format_version = 2 as 1; },
    manifest => { manifest.contract_version = 0; },
    manifest => { manifest.topics[1].id = manifest.topics[0].id; },
    manifest => { manifest.topics[0].id = 'search'; },
    manifest => { manifest.topics[0].id = '../escape'; },
    manifest => { manifest.topics.pop(); },
    manifest => { manifest.topics[0].related = ['missing']; },
    manifest => { manifest.topics[0].sources[0].id = 'architecture/reference-cli'; },
    manifest => { manifest.topics[0].sources = []; },
    manifest => { manifest.topics[0].path = manifest.orientation.path; },
    manifest => { manifest.topics[1].path = manifest.topics[0].path; },
    manifest => { manifest.topics[0].sources[0].path = manifest.topics[0].path; },
  ];
  for (const edit of edits) fixture((root, manifest, save) => { edit(manifest); save(); invalid(() => loadDocumentationBundle(root)); });
  fixture(root => invalid(() => loadDocumentationBundle(root, { core_version: '9.0.0', docs_version: '0.1.0', contract_version: 1 })));
});

test('missing and corrupt manifest, orientation, topic and source bytes refuse without fallback', () => {
  for (const mode of ['missing', 'changed']) for (const role of ['manifest', 'orientation', 'topic', 'source']) fixture((root, manifest) => {
    const relative = role === 'manifest' ? 'manifest.json' : role === 'orientation' ? manifest.orientation.path : role === 'topic' ? manifest.topics[0].path : manifest.topics[0].sources[0].path;
    if (mode === 'missing') fs.unlinkSync(path.join(root, relative));
    else fs.writeFileSync(path.join(root, relative), 'corrupt');
    invalid(() => loadDocumentationBundle(root));
  });
});

test('canonical source IDs bind one exact snapshot across topics', () => {
  fixture((root, manifest, save) => {
    const source = manifest.topics[1].sources[0];
    const otherPath = 'sources/other-reference-cli.md';
    fs.copyFileSync(path.join(root, source.path), path.join(root, otherPath));
    source.path = otherPath;
    save();
    invalid(() => loadDocumentationBundle(root));
  });
  fixture((root, manifest, save) => {
    manifest.topics[1].sources[0].id = 'base:architecture/other-contract';
    save();
    invalid(() => loadDocumentationBundle(root));
  });
  fixture((root, manifest, save) => {
    // A canonical contract may be cited at different sections of the same snapshot.
    manifest.topics[0].sources[0].anchor = 'Shared product documentation operations';
    manifest.topics[1].sources[0].anchor = 'Core API and host protocol';
    save();
    assert.equal(loadDocumentationBundle(root).topics.length, minimumDocumentationTopics.length);
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
  for (const role of ['manifest', 'source', 'topic', 'orientation', 'parent', 'root']) fixture((root, manifest) => {
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
        const relative = role === 'manifest' ? 'manifest.json' : role === 'source' ? manifest.topics[0].sources[0].path : role === 'topic' ? manifest.topics[0].path : manifest.orientation.path;
        const original = path.join(root, relative), moved = path.join(container, 'file');
        fs.renameSync(original, moved); fs.symlinkSync(moved, original);
        invalid(() => loadDocumentationBundle(root));
      }
    } finally { fs.rmSync(container, { recursive: true, force: true }); }
  });
});
