import { execFileSync } from "node:child_process";
import { GitError } from "../errors.js";

/**
 * Run `git` or `gh` with an argument array (never a shell string), returning stdout.
 * A non-zero exit throws GitError with the command and stderr.
 */
export function run(cmd: "git" | "gh", args: string[], opts: { cwd: string; input?: string | Buffer; binary: true; maxBuffer?: number }): Buffer;
export function run(cmd: "git" | "gh", args: string[], opts: { cwd: string; input?: string | Buffer; binary?: false; maxBuffer?: number }): string;
export function run(cmd: "git" | "gh", args: string[], opts: { cwd: string; input?: string | Buffer; binary?: boolean; maxBuffer?: number }): string | Buffer {
  try {
    return execFileSync(cmd, args, {
      cwd: opts.cwd,
      encoding: opts.binary ? "buffer" : "utf8",
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...(opts.input === undefined ? {} : { input: opts.input }),
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = (err.stderr ? err.stderr.toString() : "").trim() || err.message || "unknown error";
    throw new GitError(`${cmd} ${args.join(" ")}`, stderr);
  }
}
