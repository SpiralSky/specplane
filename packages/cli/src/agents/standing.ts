/** Standing instructions (`architecture/agent-skills` § Standing instructions). */

export const STANDING_VERSION = "v1";

/** Harness-neutral Workflows line used by the base `AGENTS.md` block. */
export const NEUTRAL_WORKFLOWS_LINE =
  "no slash commands are installed; follow the contracts in `architecture/agent-skills`.";

export function standingText(workflowsLine: string = NEUTRAL_WORKFLOWS_LINE): string {
  return `## Specplane

This repository uses Specplane. Before acting on specs, plans, or ADRs, read \`.specplane/config.yaml\`; resolve every path from it (\`spec_roots\`, \`plans.dir\`, \`decisions.dir\`), never assume one. \`execution\` says how plans run.

- **Authorship**: \`specs.<type>.llm_role\` limits what you may do to specs of that type: \`none\` = do not act on them, decline and say why; \`assist\` = ask, suggest, and review, but do not write the spec body; \`draft\` = you may write a draft for review.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; record each gap. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: work on a plan only in its checkout (branch \`plan/<id>\`), one step at a time, following the plan-step workflow. HANDOFF.md in the plan folder is the source of truth for progress.
- **Commits**: follow \`architecture/file-formats\` §8 (Conventional Commits subject plus \`Specplane-*\` trailers).
- **Workflows**: ${workflowsLine}`;
}

const BEGIN = (version: string) =>
  `<!-- specplane:begin ${version} — managed by \`specplane init\`; edits inside this block are overwritten -->`;
const END = "<!-- specplane:end -->";
const BEGIN_RE = /^<!-- specplane:begin v(\d+)\b.*-->[ \t]*$/;
const END_RE = /^<!-- specplane:end -->[ \t]*$/;

export type UpsertAction = "created" | "appended" | "updated" | "unchanged" | "malformed";

export interface BlockInfo {
  /** Version number N of `vN`. */
  version: number;
  /** Text between the markers, line endings normalised to `\n`, no trailing newline. */
  text: string;
  /** Index of the begin and end marker lines. */
  begin: number;
  end: number;
}

/** Locate the managed block: `null` when absent, `"malformed"` when markers are unbalanced or repeated. */
export function findBlock(content: string): BlockInfo | null | "malformed" {
  const lines = content.split(/\r?\n/);
  const begins: number[] = [];
  const ends: number[] = [];
  lines.forEach((l, i) => {
    if (BEGIN_RE.test(l)) begins.push(i);
    else if (END_RE.test(l)) ends.push(i);
  });
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return "malformed";
  const version = Number(BEGIN_RE.exec(lines[begins[0]])![1]);
  return { version, text: lines.slice(begins[0] + 1, ends[0]).join("\n"), begin: begins[0], end: ends[0] };
}

export function upsertBlock(
  content: string | null,
  workflowsLine: string = NEUTRAL_WORKFLOWS_LINE,
): { content: string; action: UpsertAction } {
  const eol = content !== null && content.includes("\r\n") ? "\r\n" : "\n";
  const block = [BEGIN(STANDING_VERSION), ...standingText(workflowsLine).split("\n"), END].join(eol);
  if (content === null) return { content: block + eol, action: "created" };
  const info = findBlock(content);
  if (info === "malformed") return { content, action: "malformed" };
  if (info === null) {
    const sep = content === "" ? "" : content.endsWith("\n") ? eol : eol + eol;
    return { content: content + sep + block + eol, action: "appended" };
  }
  const lines = content.split(/\r?\n/);
  const current = lines.slice(info.begin, info.end + 1).join(eol);
  if (current === block) return { content, action: "unchanged" };
  lines.splice(info.begin, info.end - info.begin + 1, ...block.split(eol));
  return { content: lines.join(eol), action: "updated" };
}

export type StandingState = "ok" | "missing" | "outdated" | "malformed";

/** Compare a file's content with the current standing instructions. */
export function checkStanding(content: string | null, workflowsLine: string = NEUTRAL_WORKFLOWS_LINE): StandingState {
  if (content === null) return "missing";
  const info = findBlock(content);
  if (info === null) return "missing";
  if (info === "malformed") return "malformed";
  if (info.version < Number(STANDING_VERSION.slice(1))) return "outdated";
  return info.text.trimEnd() === standingText(workflowsLine).trimEnd() ? "ok" : "outdated";
}
