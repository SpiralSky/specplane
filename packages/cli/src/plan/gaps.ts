import * as fs from "node:fs";

/** Entry of a `spec-gaps.md` (`architecture/file-formats` §4.2). */
export interface GapEntry {
  n: number;
  caseTitle: string;
  kind: string;
  /** Step number as written; `null` when the field is missing or not numeric. */
  step: number | null;
  case: string;
  resolution: string;
  targets: string[];
  status: string;
  /** 1-based line of the entry heading. */
  line: number;
}

export interface GapProblem {
  severity: "error" | "warning";
  message: string;
  line?: number;
}

export const GAP_KINDS = ["gap", "assumption", "proposal"] as const;
export const GAP_STATUSES = ["open", "applied", "rejected"] as const;

const FIELDS = ["Kind", "Step", "Case", "Resolution", "Target spec", "Status"] as const;
type Field = (typeof FIELDS)[number];

/** Spec IDs of a `**Target spec**` value: backticked or plain IDs, comma-separated. */
function parseTargets(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim().replace(/^`|`$/g, "").trim())
    .filter(Boolean);
}

interface Block {
  heading: string;
  line: number;
  fields: Map<Field, string>;
}

/**
 * Parse `spec-gaps.md` (`architecture/file-formats` §4.2). Format problems are returned as
 * findings; references (step numbers, target specs) are checked by `validatePlans`.
 */
export function parseGaps(file: string): { entries: GapEntry[]; problems: GapProblem[] } {
  const problems: GapProblem[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;

  fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      const h = /^##\s+(.*)$/.exec(text);
      if (h) {
        current = { heading: h[1].trim(), line: i + 1, fields: new Map() };
        blocks.push(current);
        return;
      }
      if (!current) return;
      const f = /^\*\*(Kind|Step|Case|Resolution|Target spec|Status)\*\*:\s*(.*)$/.exec(text);
      if (f) current.fields.set(f[1] as Field, f[2].trim());
    });

  const entries: GapEntry[] = [];
  let previous = 0;
  for (const block of blocks) {
    const m = /^G(\d+):\s*(.+)$/.exec(block.heading);
    if (!m) {
      problems.push({ severity: "error", message: `spec-gaps.md: heading \`${block.heading}\` must be \`## G<n>: <case>\`.`, line: block.line });
      continue;
    }
    const n = Number(m[1]);
    if (n <= previous) {
      problems.push({ severity: "error", message: `spec-gaps.md: entry G${n} is duplicated or out of order.`, line: block.line });
    }
    previous = n;
    for (const field of FIELDS) {
      if (!block.fields.has(field)) {
        problems.push({ severity: "error", message: `spec-gaps.md: G${n} has no **${field}**.`, line: block.line });
      }
    }
    const value = (field: Field): string => block.fields.get(field) ?? "";
    const kind = value("Kind");
    if (kind !== "" && !(GAP_KINDS as readonly string[]).includes(kind)) {
      problems.push({ severity: "error", message: `spec-gaps.md: G${n} has Kind \`${kind}\`; expected ${GAP_KINDS.join(", ")}.`, line: block.line });
    }
    const status = value("Status");
    if (status !== "" && !(GAP_STATUSES as readonly string[]).includes(status)) {
      problems.push({ severity: "error", message: `spec-gaps.md: G${n} has Status \`${status}\`; expected ${GAP_STATUSES.join(", ")}.`, line: block.line });
    }
    const rawStep = value("Step");
    const step = /^\d+$/.test(rawStep) ? Number(rawStep) : null;
    if (rawStep !== "" && step === null) {
      problems.push({ severity: "error", message: `spec-gaps.md: G${n} has Step \`${rawStep}\`; expected a step number.`, line: block.line });
    }
    entries.push({
      n,
      caseTitle: m[2].trim(),
      kind,
      step,
      case: value("Case"),
      resolution: value("Resolution"),
      targets: parseTargets(value("Target spec")),
      status,
      line: block.line,
    });
  }
  return { entries, problems };
}

/** One line per open entry, as the finish flow lists them (`architecture/reference-cli` § Finish). */
export function formatOpenGaps(entries: GapEntry[]): string[] {
  return entries.filter((g) => g.status === "open").map((g) => `G${g.n} (${g.kind}, ${g.targets.join(", ")}): ${g.case}`);
}
