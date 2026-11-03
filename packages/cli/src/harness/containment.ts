import * as fs from 'node:fs';
import * as path from 'node:path';
import { SpecplaneError } from '../errors.js';

export class InstallationPathError extends SpecplaneError {
  readonly exitCode = 1;
}

/** Validate directory entries, not existsSync: dangling links are entries too. */
export function assertInstallDestination(root: string, destination: string): void {
  const absoluteRoot = path.resolve(root);
  const relative = path.relative(absoluteRoot, path.resolve(destination));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new InstallationPathError(`Installation path is outside the repository: ${destination}`);
  }
  const rootStat = fs.lstatSync(absoluteRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new InstallationPathError(`Installation root must be a real directory: ${absoluteRoot}`);
  }
  let current = absoluteRoot;
  const parts = relative.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new InstallationPathError(`Installation symlink refused (may resolve outside the repository): ${current}`);
    }
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) {
      throw new InstallationPathError(`Installation path has an unexpected file type: ${current}`);
    }
    if (stat.isFile() && stat.nlink > 1) {
      throw new InstallationPathError(`Installation hard-linked file refused: ${current}`);
    }
  }
}

/** Recheck after directory creation and refuse a last-component link on open. */
export function writeInstallFile(root: string, destination: string, content: string | Uint8Array): void {
  assertInstallDestination(root, destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  assertInstallDestination(root, destination);
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o666);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new InstallationPathError(`Installation file changed: ${destination}`);
    assertInstallDestination(root, destination);
    const current = fs.lstatSync(destination);
    if (current.dev !== stat.dev || current.ino !== stat.ino) throw new InstallationPathError(`Installation file changed: ${destination}`);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, content);
  } finally { fs.closeSync(fd); }
}
