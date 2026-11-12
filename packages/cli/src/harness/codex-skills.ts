import { COMMANDS, readContract } from "./instructions.js";

/**
 * The Codex skill and contract files (`harnesses/codex/specifications/architecture/codex-integration` §3): one entry
 * skill `specplane` with a table of the workflows, and one `contracts/<command>.md` per offered command. A contract is
 * the packaged harness-neutral contract unchanged, so Codex never gets different steps or permissions. Commands that
 * exist only as a typed command that skips the model are not offered until Codex's native command handling is
 * verified; the skill says so (`harness R35.1`).
 */

const WITHHELD: Readonly<Record<string, string>> = {
  approve: "approval is a typed, user-only command and Codex has no verified way to run one without a model turn",
  requests: "the requests pane is a typed, user-only command and Codex has no verified way to run one without a model turn",
  "spec-view": "spec viewing is a typed, user-only command and Codex has no verified way to run one without a model turn, so it does not claim the viewing capability",
};

const SUMMARY: Readonly<Record<string, string>> = {
  "plan-start": "Start a plan: create its worktree and report where to continue it.",
  "plan-step": "Execute the next selected steps of a plan, one at a time.",
  "plan-finish": "Run the final review of a plan and decide whether it is complete.",
  "plan-abandon": "Abandon a plan after the user confirms.",
  "plan-create": "Create a new plan from the specifications it implements.",
  "plan-status": "Show plans with live status and the next step.",
  "spec-draft-architecture": "Draft an architecture specification from feature specifications.",
  "spec-assist": "Write or change a specification together with the user.",
  "decision-new": "Record a decision the user made, with its context, as a decision record.",
  migrate: "Bring an existing project into Specplane from its specifications, documents and code.",
  validate: "Check the specifications and show warnings and coverage.",
  verify: "Judge an architecture specification against its implementation and record evidence.",
};

export const CODEX_CONTRACTS: readonly string[] = COMMANDS.filter((c) => !(c in WITHHELD));
export const CODEX_WITHHELD: readonly string[] = COMMANDS.filter((c) => c in WITHHELD);

export const SKILL_FILE = "skills/specplane/SKILL.md";
export function contractPath(command: string): string { return `contracts/${command}.md`; }

/** The contract of one offered command, unchanged. */
export function renderCodexContract(command: string): string {
  if (!CODEX_CONTRACTS.includes(command)) throw new Error(`No Codex contract is offered for: ${command}`);
  return `${readContract(command)}\n`;
}

/** The entry skill: frontmatter, how to use a contract, the table of workflows, and what is not offered. */
export function renderCodexSkill(): string {
  const rows = CODEX_CONTRACTS.map((c) => `| \`${c}\` | ${SUMMARY[c] ?? c} | \`contracts/${c}.md\` |`);
  const withheld = CODEX_WITHHELD.map((c) => `- \`${c}\`: not offered in Codex, because ${WITHHELD[c]}. The user can run it in their own terminal.`);
  return [
    "---",
    "name: specplane",
    'description: "Use Specplane workflows for specifications and plans in this repository: read the matching contract, then follow it."',
    "---",
    "# Specplane",
    "",
    "Read `.specplane/config.yaml` through the Specplane tools first and resolve every path from it. Before acting on a workflow, read its contract file below in full and follow its steps in order. A contract names Specplane harness actions; call them as the tools of the `specplane` MCP server and never run the Specplane CLI yourself.",
    "",
    "If a contract needs a capability this setup lacks (for example the MCP tools are not registered), stop and name what is missing. Do not substitute another route, and do not approve anything on the user's behalf.",
    "",
    "| Workflow | Use for | Contract |",
    "|----------|---------|----------|",
    ...rows,
    "",
    ...withheld,
    "",
  ].join("\n");
}
