import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GitError } from '../errors.js';
import { run } from './exec.js';

test('Git subprocesses use the current PATH for each call and never fall back to the startup PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-exec-environment-'));
  const savedPath = process.env.PATH;
  try {
    for (const marker of ['first', 'second']) {
      const directory = path.join(root, marker);
      fs.mkdirSync(directory);
      // --version is harmless even if a broken runtime selects ambient Git.
      fs.writeFileSync(path.join(directory, 'git'), `#!/bin/sh\nprintf '%s' '${marker}'\n`, { mode: 0o755 });
      process.env.PATH = directory;
      assert.equal(run('git', ['--version'], { cwd: root }), marker);
    }
    const empty = path.join(root, 'empty');
    fs.mkdirSync(empty);
    process.env.PATH = empty;
    assert.throws(() => run('git', ['--version'], { cwd: root }), GitError);
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
