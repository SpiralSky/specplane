import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../git/exec.js";

/** The local store, `<git-common-dir>/specplane` (`architecture/reference-cli` §3.3). Never committed. */
export function storeDir(root: string): string {
  const common = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root }).trim();
  return path.join(common, "specplane");
}

export function readStoreJson<T>(root: string, name: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(storeDir(root), name), "utf8")) as T; } catch { return null; }
}

export function writeStoreJson(root: string, name: string, value: unknown): void {
  const dir = storeDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value) + "\n");
  fs.renameSync(tmp, path.join(dir, name));
}

/** Append one complete line with a single write. */
export function appendStoreLine(root: string, name: string, line: string): void {
  const dir = storeDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, name), line + "\n");
}
