import { createHash } from "node:crypto";
/** Standing instructions (`architecture/agent-skills` § Standing instructions). */

export const STANDING_VERSION = "v1";

/** Harness-neutral Workflows line used by the base `AGENTS.md` block. */
export const NEUTRAL_WORKFLOWS_LINE =
  "no slash commands are installed; follow the contracts in `architecture/agent-skills`.";

/**
 * Neutral dispatcher used when several harnesses are installed together: the shared file names no host, and each
 * installed harness carries its own invocation details in its own files.
 */
export const COEXISTING_WORKFLOWS_LINE =
  "follow the contracts in `architecture/agent-skills`; invoke them through the skill or commands your host installed (see its own instruction files).";

export function standingText(workflowsLine: string = NEUTRAL_WORKFLOWS_LINE): string {
  return `## Specplane

This repository uses Specplane. Before acting on specs, plans, or ADRs, read \`.specplane/config.yaml\`; resolve every path from it (\`spec_roots\`, \`plans.dir\`, \`decisions.dir\`), never assume one. \`execution\` says how plans run.

- **Authorship**: \`specs.<type>.llm_role\` limits spec writing and review independently of \`authorship\`: \`none\` = read and implement only, with no spec-body edits, review, or suggestions; \`review\` = ask, suggest, and review without independently drafting the spec body; apply a suggested edit only after the user approves that exact change; \`assist\` = write the body only after the user finalises the content and approves the text (refine-then-write); \`draft\` = you may write a draft for review. Setting a spec to \`approved\`, a plan to \`ready\`, or a decision record to \`accepted\` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; record each gap, assumption, or proposed spec edit as a \`spec-gaps.md\` entry in the plan folder. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: work on a plan only in its checkout (branch \`plan/<id>\`), one step at a time, following the plan-step workflow. HANDOFF.md and \`spec-gaps.md\` in the plan folder are the source of truth for progress and gaps.
- **Commits**: follow \`architecture/file-formats\` §8 (Conventional Commits subject plus \`Specplane-*\` trailers).
- **Workflows**: ${workflowsLine}`;
}

/** Release identity embedded in the begin marker so freshness can be checked without regenerating text. */
export interface GuidanceMeta {
  docs: string;
  contract: number;
  /** SHA-256 of the managed text between the markers (see `blockHash`). */
  sha256: string;
}
export type ReleaseIdentity = Pick<GuidanceMeta, "docs" | "contract">;

const metaText = (m?: GuidanceMeta) => (m ? ` docs=${m.docs} contract=${m.contract} sha256=${m.sha256}` : "");
const BEGIN = (version: string, meta?: GuidanceMeta) =>
  `<!-- specplane:begin ${version}${metaText(meta)} — managed by \`specplane init\`; edits inside this block are overwritten -->`;
const META_RE = /^<!-- specplane:begin v\d+ docs=(\S+) contract=(\d+) sha256=([a-f0-9]{64}) — /;

/** SHA-256 of managed block text with line endings normalised and trailing whitespace trimmed. */
export function blockHash(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n").trimEnd()).digest("hex");
}
const END = "<!-- specplane:end -->";
const BEGIN_RE = /^<!-- specplane:begin v(\d+)\b.*-->[ \t]*$/;
const END_RE = /^<!-- specplane:end -->[ \t]*$/;

export type UpsertAction = "created" | "appended" | "updated" | "unchanged" | "malformed";

export interface BlockInfo {
  /** Version number N of `vN`. */
  version: number;
  /** Text between the markers, line endings normalised to `\n`, no trailing newline. */
  text: string;
  /** Release identity from the begin marker; `null` for blocks written without it. */
  meta: GuidanceMeta | null;
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
  const m = META_RE.exec(lines[begins[0]]);
  const meta = m ? { docs: m[1], contract: Number(m[2]), sha256: m[3] } : null;
  return { version, text: lines.slice(begins[0] + 1, ends[0]).join("\n"), meta, begin: begins[0], end: ends[0] };
}

export function upsertBlock(
  content: string | null,
  workflowsLine: string = NEUTRAL_WORKFLOWS_LINE,
  /** When given (explicit refresh), the marker records this release identity and the text hash. */
  release?: ReleaseIdentity,
): { content: string; action: UpsertAction } {
  const eol = content !== null && content.includes("\r\n") ? "\r\n" : "\n";
  const body = standingText(workflowsLine);
  const hash = blockHash(body);
  const info = content === null ? null : findBlock(content);
  // Without a release identity, keep an existing marker only while its recorded hash still describes this text.
  const meta: GuidanceMeta | undefined = release
    ? { ...release, sha256: hash }
    : info && info !== "malformed" && info.meta && info.meta.sha256 === hash ? info.meta : undefined;
  const block = [BEGIN(STANDING_VERSION, meta), ...body.split("\n"), END].join(eol);
  if (content === null) return { content: block + eol, action: "created" };
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
