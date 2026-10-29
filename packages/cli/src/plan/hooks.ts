import { spawnSync } from "node:child_process";
import { SetupHookError } from "../errors.js";

/**
 * Run the `execution.setup_hook` command through the user's shell in `cwd`.
 * Hook output goes to stderr (stdout is reserved for data). A non-zero exit or a spawn
 * failure throws SetupHookError; removing the worktree is the caller's job.
 */
export function runSetupHook(cmd: string, cwd: string): void {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: ["ignore", 2, 2] });
  if (r.error || r.status !== 0) throw new SetupHookError(cmd, r.status);
}
