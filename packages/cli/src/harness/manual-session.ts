import * as fs from "node:fs";
import * as path from "node:path";
import { worktreeOf } from "../plan/ctx.js";
import { manualCommand as claudeManual } from "./adapter-claude.js";
import { manualCommand as codexManual } from "./adapter-codex.js";

/**
 * The exact commands that open a plan's session by hand, one per harness: only the named adapter when there is one,
 * otherwise each harness installed in the checkout. They reuse each adapter's own manual command.
 */
export function manualSessionCommands(root: string, planId: string, adapter?: string): string[] {
  const dir = worktreeOf(root, planId) ?? "<the plan's worktree>";
  const has = (rel: string): boolean => fs.existsSync(path.join(root, rel));
  const claude = adapter ? adapter === "claude" : has(".claude/hooks/specplane-cli-block.sh") || has(".claude/rules/specplane.md");
  const codex = adapter ? adapter === "codex" : has(".codex/config.toml");
  return [...(claude ? [`Claude Code: ${claudeManual(dir, planId)}`] : []), ...(codex ? [`Codex: ${codexManual(dir)}`] : [])];
}

/** The lines that tell a person how to open the session of a plan an accepted request started. */
export function manualSessionLines(root: string, planId: string, adapter?: string): string[] {
  const cmds = manualSessionCommands(root, planId, adapter);
  return cmds.length ? [`To open the plan's session, run one of:`, ...cmds.map((c) => `  ${c}`)]
    : [`No harness is installed here; open a session in the plan's worktree and run plan-step ${planId}.`];
}
