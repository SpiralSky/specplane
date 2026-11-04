import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assembleExtensionPackage, type PackageBuildOptions, type PackageInput } from "./package-builder.js";
import { runtimeInputs } from "./codex-package.js";
import { templatesDir } from "./index.js";

/** Package root relative to the repository: the plugin's `${CLAUDE_PLUGIN_ROOT}/core` layout (plugin.json `mcpServers`). */
export const CLAUDE_PACKAGE_DIR = ".claude/specplane/core";
export const CLAUDE_EXTENSION_ID = "specplane-claude";
/** Package-relative path of the host selection the MCP server reads. */
export const CLAUDE_HOST_EVIDENCE_PATH = "host-evidence/claude-code.json";
/** Entry point the plugin runs; the MCP server locates its package root two directories above it. */
export const CLAUDE_MCP_ENTRY = "dist/harness/claude-mcp-main.js";
/** Reasoning workflows with a fallback skill template; each cites its shared `agent-skills` section. */
export const CLAUDE_REASONING_WORKFLOWS = ["plan-step", "plan-create", "plan-finish", "spec-assist", "spec-draft-architecture", "decision-new"] as const;

/**
 * Host selection recorded for claude-code 2.1.317 (`harnesses/claude/host-evidence/2.1.317/capabilities.json`). Native and
 * background flags stay false: no recorded evidence certifies them, and the manifest keeps `hostCompatibility` empty.
 */
export const CLAUDE_HOST_SELECTION = {
  host: "claude-code",
  version: "2.1.317",
  surface: "cli",
  probes: { nativeCommands: false, backgroundSessions: false },
} as const;

/**
 * Builds the Claude extension package (MCP runtime, dependencies, docs, host selection) into an empty directory. Its
 * manifest and inventory make `validateCompatibility` pass for the reasoning workflows; no skill or command file is
 * included. Synchronous so the installer can stage it inside its install transaction.
 */
export function assembleClaudePackage(outDir: string) {
  const { runtime, docsDir } = runtimeInputs();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-claude-evidence-"));
  try {
    const evidence = path.join(scratch, "claude-code.json");
    fs.writeFileSync(evidence, JSON.stringify({ ...CLAUDE_HOST_SELECTION, source: "harnesses/claude/host-evidence/2.1.317/capabilities.json" }, null, 2) + "\n");
    const inputs: PackageInput[] = [...runtime, { from: evidence, to: CLAUDE_HOST_EVIDENCE_PATH }];
    const options: PackageBuildOptions = {
      outDir,
      extension: { id: CLAUDE_EXTENSION_ID, host: "claude-code" },
      capabilities: { reasoning: true, nativeCommands: false, backgroundSessions: false },
      docsDir,
      runtime: inputs,
      // The bundled rules template is the instruction file; the builder stamps the orientation metadata onto it.
      instructions: { from: path.join(templatesDir("claude"), "rules", "specplane.md"), to: "instructions/specplane.md" },
      procedures: CLAUDE_REASONING_WORKFLOWS.map(workflow => ({
        workflow,
        contracts: [{ sourceId: "base:architecture/agent-skills", anchor: workflow }],
      })),
    };
    return assembleExtensionPackage(options);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Package-relative files the installer names in the installed manifest; the inventory vouches for everything else. */
export const CLAUDE_MANIFEST_FILES = ["specplane-extension.json", "core/inventory.json", CLAUDE_MCP_ENTRY, CLAUDE_HOST_EVIDENCE_PATH];
