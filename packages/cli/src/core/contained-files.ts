/** Descriptor-anchored I/O. Prevents path replacement from redirecting an operation.
 * Linux procfs is required; never fall back to a check-then-open pathname.
 * This is not isolation against a process that can move an opened inode outside
 * the tree, change its contents, or alter the mount namespace.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function parts(relative: string): string[] {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..' || p === '.git'))
    fail('INVALID_EVIDENCE', 'Uncontained evidence path');
  return relative.split('/');
}
export interface ContainedDirectory {
  read(name: string): Buffer;
  writeExclusive(name: string, content: string): void;
  list(): string[];
}
export function withContainedDirectory<T>(root: string, relative: string | null, create: boolean, action: (directory: ContainedDirectory) => T): T {
  if (process.platform !== 'linux') fail('UNSUPPORTED_CAPABILITY', 'Descriptor-anchored evidence access requires Linux procfs');
  try {
    const probe = fs.openSync('/proc/self/fd', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    fs.closeSync(probe);
  } catch { fail('UNSUPPORTED_CAPABILITY', 'Descriptor-anchored evidence access requires accessible Linux procfs'); }
  const children = relative === null ? [] : parts(relative);
  const descriptors: number[] = [];
  const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
  try {
    let fd = fs.openSync('/', directoryFlags); descriptors.push(fd);
    const absolute = path.resolve(root).split('/').filter(Boolean);
    for (const [i, component] of [...absolute, ...children].entries()) {
      const entry = `/proc/self/fd/${fd}/${component}`;
      if (create && i >= absolute.length) {
        try { fs.mkdirSync(entry, { mode: 0o700 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      }
      fd = fs.openSync(entry, directoryFlags); descriptors.push(fd);
    }
    const entry = (name: string) => {
      if (parts(name).length !== 1) fail('INVALID_EVIDENCE', 'Expected one contained filename');
      return `/proc/self/fd/${fd}/${name}`;
    };
    return action({
      read(name) {
        const file = fs.openSync(entry(name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
          const stat = fs.fstatSync(file);
          if (!stat.isFile() || stat.nlink !== 1) fail('INVALID_EVIDENCE', 'Nonregular evidence file');
          return fs.readFileSync(file);
        } finally { fs.closeSync(file); }
      },
      writeExclusive(name, content) {
        const file = fs.openSync(entry(name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
        try { fs.writeFileSync(file, content); fs.fsyncSync(file); }
        finally { fs.closeSync(file); }
        fs.fsyncSync(fd);
      },
      list: () => fs.readdirSync(`/proc/self/fd/${fd}`).sort(),
    });
  } finally { for (const fd of descriptors.reverse()) fs.closeSync(fd); }
}
export function readContainedFile(root: string, relative: string): Buffer {
  const components = parts(relative), name = components.pop()!;
  return withContainedDirectory(root, components.length ? components.join('/') : null, false, dir => dir.read(name));
}
