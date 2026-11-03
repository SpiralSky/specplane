import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

test('branch syntax cache is operation-scoped and never caches refs or plan-specific restrictions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-cache-'));
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const git = (...args: string[]) => execFileSync(realGit, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    git('commit', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    const bin = path.join(root, 'bin'), log = path.join(root, 'checks');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\n[ "$1" != check-ref-format ] || echo check >> ${quote(log)}\nexec ${quote(realGit)} "$@"\n`, { mode: 0o755 });
    // Supply PATH at process creation: isolated Bun globals need not update the
    // native environment used by implicit child-process options.
    const script = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { execFileSync } from 'node:child_process';
      import { isBranchName, withBranchNameCache } from ${JSON.stringify(new URL('./branch-name.js', import.meta.url).href)};
      import { resolvePlanContext, validateTargetBranch } from ${JSON.stringify(new URL('../plan/context.js', import.meta.url).href)};
      const root = ${JSON.stringify(root)}, log = ${JSON.stringify(log)}, base = ${JSON.stringify(base)};
      const git = (...args) => execFileSync(${JSON.stringify(realGit)}, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const count = () => fs.readFileSync(log, 'utf8').trim().split('\\n').length;
    withBranchNameCache(() => {
      assert.equal(resolvePlanContext(root, { id: 'example', explicit: 'main' }).targetCommit, base);
      assert.equal(isBranchName(root, 'main'), true);
      assert.equal(count(), 1);
      git('commit', '--allow-empty', '-m', 'advance');
      assert.notEqual(resolvePlanContext(root, { id: 'example', explicit: 'main' }).targetCommit, base);
      assert.equal(count(), 1, 'ref freshness must not depend on syntax cache misses');
      validateTargetBranch(root, 'plan/example', 'other');
      assert.throws(() => validateTargetBranch(root, 'plan/example', 'example'), /Invalid integration target/);
      assert.equal(isBranchName(root, '@{-1}'), false);
      assert.equal(isBranchName(root, 'bad..name'), false);
    });
    const before = count();
    assert.throws(() => withBranchNameCache(() => { assert.equal(isBranchName(root, 'main'), true); throw new Error('stop'); }), /stop/);
    assert.equal(isBranchName(root, 'main'), true);
    assert.equal(count(), before + 2, 'successful results cannot escape an operation, including exceptions');
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, stdio: 'pipe', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
