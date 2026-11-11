import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { run } from "../git/exec.js";

/** The local store, `<git-common-dir>/specplane` (`architecture/reference-cli` §3.3). Never committed. */
export function storeDir(root: string): string {
  const common = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root }).trim();
  return path.join(common, "specplane");
}

/** Relative nested names only; reject traversal and symlink components before accessing the store. */
function storePath(root: string, name: string): string {
  if (!name || path.isAbsolute(name) || name.includes("\\") || name.split("/").some((p) => !p || p === "." || p === "..")) {
    throw new Error(`Invalid local store path: ${name}`);
  }
  const dir = storeDir(root);
  let current = dir;
  for (const part of ["", ...name.split("/")]) {
    current = part ? path.join(current, part) : current;
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Local store path is a symlink: ${current}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return path.join(dir, name);
}

export function readStoreJson<T>(root: string, name: string): T | null {
  const file = storePath(root, name);
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

export function writeStoreJson(root: string, name: string, value: unknown): void {
  const file = storePath(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value) + "\n", { flag: "wx" });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

export function removeStoreJson(root: string, name: string): void {
  fs.rmSync(storePath(root, name), { force: true });
}

/** Serialize read/modify/write across processes. Contention fails rather than losing an update. */
export function updateStoreJson<T>(root: string, name: string, update: (previous: T | null) => T): void {
  const lock = storePath(root, `${name}.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const fd = fs.openSync(lock, "wx");
  try { writeStoreJson(root, name, update(readStoreJson<T>(root, name))); }
  finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }
}

/** Append one complete line with a single write. */
export function appendStoreLine(root: string, name: string, line: string): void {
  const file = storePath(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + "\n");
}

function takeLock(root: string, name: string): () => void {
  const lock = storePath(root, `${name}.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => fs.rmSync(lock, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = Number(fs.readFileSync(lock, "utf8").trim());
      let alive = Number.isInteger(holder) && holder > 0;
      if (alive) { try { process.kill(holder, 0); } catch (k) { alive = (k as NodeJS.ErrnoException).code === "EPERM"; } }
      if (alive || attempt > 0) throw new Error(`Another Specplane command is changing this checkout (lock ${lock}).`);
      fs.rmSync(lock, { force: true });
    }
  }
}

/** Run a state-changing command under a per-checkout lock; a lock left by a dead process is cleared, a live one refuses. */
export function withStoreLock<T>(root: string, name: string, fn: () => T): T {
  const release = takeLock(root, name);
  try { return fn(); } finally { release(); }
}

export async function withStoreLockAsync<T>(root: string, name: string, fn: () => Promise<T>): Promise<T> {
  const release = takeLock(root, name);
  try { return await fn(); } finally { release(); }
}
