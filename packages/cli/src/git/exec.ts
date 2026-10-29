import { execFileSync } from "node:child_process";
import { GitError } from "../errors.js";

/**
 * Run `git` or `gh` with an argument array (never a shell string), returning stdout.
 * A non-zero exit throws GitError with the command and stderr.
 */
export function run(cmd: "git" | "gh", args: string[], opts: { cwd: string; input?: string }): string {
  try {
    return execFileSync(cmd, args, {
      cwd: opts.cwd,
      encoding: "utf8",
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...(opts.input === undefined ? {} : { input: opts.input }),
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = (err.stderr ? err.stderr.toString() : "").trim() || err.message || "unknown error";
    throw new GitError(`${cmd} ${args.join(" ")}`, stderr);
  }
}
