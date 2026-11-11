import { COMMANDS, readContract } from "./instructions.js";

/**
 * The Claude Code command skills (`harnesses/claude/specifications/architecture/claude-integration` §3): one
 * `specplane-<command>` skill per command contract. The body is the packaged contract itself, so a skill never changes a
 * contract's steps or permissions; the frontmatter is Claude Code invocation detail. `disable-model-invocation` never
 * grants a permission, the guard decides.
 */

interface SkillMeta { description: string; argumentHint: string; modelInvocable: boolean }

const META: Readonly<Record<string, SkillMeta>> = {
  approve: { description: "Approve specifications, plans or decision records by ID. Only the user runs this command.", argumentHint: "<id>...", modelInvocable: false },
  requests: { description: "Open the requests pane. Only the user runs this command.", argumentHint: "[list | show <id> | accept <id> | decline <id>]", modelInvocable: false },
  "plan-start": { description: "Start a plan: create its worktree and open its session.", argumentHint: "<plan-id>", modelInvocable: false },
  "plan-step": { description: "Execute the next selected steps of a plan, one at a time.", argumentHint: "[plan-id]", modelInvocable: false },
  "plan-finish": { description: "Run the final review of a plan and decide whether it is complete.", argumentHint: "[plan-id]", modelInvocable: false },
  "plan-abandon": { description: "Abandon a plan after the user confirms.", argumentHint: "<plan-id>", modelInvocable: false },
  "plan-create": { description: "Create a new plan from the specifications it implements.", argumentHint: "<what the plan is for>", modelInvocable: false },
  "spec-draft-architecture": { description: "Draft an architecture specification from feature specifications.", argumentHint: "<feature spec id>...", modelInvocable: false },
  "spec-assist": { description: "Write or change a specification together with the user. Use when the user asks to write, refine or review a spec.", argumentHint: "<spec or description>", modelInvocable: true },
  validate: { description: "Check the specifications and show warnings and coverage. Use when the user asks to validate or check the specs.", argumentHint: "", modelInvocable: true },
  "plan-status": { description: "Show plans with live status and the next step. Use when the user asks where a plan stands.", argumentHint: "[plan-id]", modelInvocable: true },
  verify: { description: "Judge an architecture specification against its implementation and record evidence. Use when the user asks to verify a spec.", argumentHint: "<architecture spec id>", modelInvocable: true },
};

export const SKILL_COMMANDS: readonly string[] = COMMANDS;

export function skillPath(command: string): string { return `skills/specplane-${command}/SKILL.md`; }

/** The `SKILL.md` text of one command: Claude Code frontmatter, then the contract unchanged. */
export function renderSkill(command: string): string {
  const meta = META[command];
  if (!meta) throw new Error(`No skill declared for command: ${command}`);
  const front = [
    "---",
    `name: specplane-${command}`,
    `description: ${JSON.stringify(meta.description)}`,
    ...(meta.argumentHint ? [`argument-hint: ${JSON.stringify(meta.argumentHint)}`] : []),
    `disable-model-invocation: ${meta.modelInvocable ? "false" : "true"}`,
    "---",
  ];
  return `${front.join("\n")}\n${readContract(command)}\n`;
}
