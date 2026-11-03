/** Portable containment checks for cooperative, lease-coordinated writers.
 * Reject links, aliases and observed replacements; retain the opened regular
 * file through content I/O. This is NOT a sandbox against a same-user process:
 * namespace changes hidden between checks cannot be excluded, and a raced mkdir
 * or exclusive open can leave an empty artifact outside the tree before refusal.
 * Never clean up through a suspect pathname. Stronger hostile-writer isolation
 * requires an OS security boundary, not repeated Node pathname checks.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function parts(relative: string): string[] {
  const components = relative.split('/');
  // Apply the portable subset on every OS, including Windows drive/ADS paths,
  // device aliases and names normalized by Win32 (trailing spaces/dots).
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || /[\x00-\x1f<>:"|?*]/.test(relative) || components.some(p =>
    !p || p === '.' || p === '..' || p.toLowerCase() === '.git' || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))
    fail('INVALID_EVIDENCE', 'Uncontained or nonportable evidence path');
  return components;
}
type Identity = Pick<fs.BigIntStats, 'dev' | 'ino'>;
function same(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function regular(stat: fs.BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== 1n) fail('INVALID_EVIDENCE', 'Nonregular evidence file');
}
export interface ContainedDirectory {
  read(name: string): Buffer;
  writeExclusive(name: string, content: string): void;
  list(): string[];
}
export function withContainedDirectory<T>(root: string, relative: string | null, create: boolean, action: (directory: ContainedDirectory) => T): T {
  const children = relative === null ? [] : parts(relative);
  const absoluteRoot = path.resolve(root);
  const rootStat = fs.lstatSync(absoluteRoot, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('INVALID_EVIDENCE', 'Nonregular evidence root');
  // Resolve ambient aliases (e.g. macOS /tmp) once. Links within the selected
  // root remain forbidden. Recheck the supplied root's identity and resolution.
  const canonicalRoot = fs.realpathSync(absoluteRoot);
  const directories: { file: string; identity: Identity }[] = [{ file: canonicalRoot, identity: rootStat }];
  let active = true;
  function check(): void {
    if (!active) fail('RECOVERY_REQUIRED', 'Contained directory access has expired');
    const rootNow = fs.lstatSync(absoluteRoot, { bigint: true });
    if (!rootNow.isDirectory() || rootNow.isSymbolicLink() || !same(rootNow, rootStat) || path.relative(canonicalRoot, fs.realpathSync(absoluteRoot)) !== '')
      fail('RECOVERY_REQUIRED', 'Evidence root changed during access');
    for (const { file, identity } of directories) {
      const current = fs.lstatSync(file, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !same(current, identity) || path.relative(file, fs.realpathSync(file)) !== '')
        fail('RECOVERY_REQUIRED', 'Evidence directory changed during access');
    }
  }
  let directory = canonicalRoot;
  check();
  for (const component of children) {
    check();
    directory = path.join(directory, component);
    if (create) {
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
    check();
    const stat = fs.lstatSync(directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_EVIDENCE', 'Nonregular evidence directory');
    directories.push({ file: directory, identity: stat });
    check();
  }
  const entry = (name: string) => {
    if (parts(name).length !== 1) fail('INVALID_EVIDENCE', 'Expected one contained filename');
    check();
    return path.join(directory, name);
  };
  function checkFile(file: string, fd: number, expected: Identity): fs.BigIntStats {
    check();
    const opened = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    regular(opened); regular(current);
    if (!same(opened, expected) || !same(current, opened)) fail('RECOVERY_REQUIRED', 'Evidence file changed during access');
    check();
    return opened;
  }
  // These additional flags are absent on Windows. Path and identity validation
  // applies on every OS; correctness does not depend on directory handles/procfs.
  const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  try {
    const result = action({
      read(name) {
        const file = entry(name), before = fs.lstatSync(file, { bigint: true });
        regular(before);
        check();
        const fd = fs.openSync(file, readFlags);
        try {
          const opened = checkFile(file, fd, before);
          const bytes = fs.readFileSync(fd);
          const after = checkFile(file, fd, before);
          if (opened.size !== after.size || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs || BigInt(bytes.length) !== after.size)
            fail('RECOVERY_REQUIRED', 'Evidence bytes changed during read');
          return bytes;
        } finally { fs.closeSync(fd); }
      },
      writeExclusive(name, content) {
        const file = entry(name);
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        try {
          const opened = fs.fstatSync(fd, { bigint: true });
          checkFile(file, fd, opened);
          fs.writeFileSync(fd, content);
          fs.fsyncSync(fd);
          checkFile(file, fd, opened);
        } finally { fs.closeSync(fd); }
      },
      list() {
        check();
        const files = fs.readdirSync(directory).sort();
        check();
        return files;
      },
    });
    check();
    return result;
  } finally { active = false; }
}
export function readContainedFile(root: string, relative: string): Buffer {
  const components = parts(relative), name = components.pop()!;
  return withContainedDirectory(root, components.length ? components.join('/') : null, false, dir => dir.read(name));
}
