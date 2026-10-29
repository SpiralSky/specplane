import { CommitFormatError } from "../errors.js";
import { run } from "./exec.js";

/** Ordered trailer key/value pairs; `formatMessage` re-orders known keys per file-formats §8.2. */
export type Trailers = Record<string, string>;

export interface CommitParts {
  type: string;
  scope?: string;
  summary: string;
  body?: string;
  trailers: Trailers;
}

const TRAILER_ORDER = [
  "Specplane-Workflow",
  "Specplane-Plan",
  "Specplane-Step",
  "Specplane-Stack-Base",
  "Specplane-Agent",
  "Specplane-Session",
];
const MAX_SUBJECT = 72;

/** Build a commit message: Conventional Commits subject, optional body, trailer paragraph (§8). */
export function formatMessage(parts: CommitParts): string {
  const subject = `${parts.type}${parts.scope ? `(${parts.scope})` : ""}: ${parts.summary}`;
  const housekeeping = subject.startsWith("chore(specplane):");
  if (subject.length > MAX_SUBJECT && !housekeeping) {
    throw new CommitFormatError(`subject is ${subject.length} characters (max ${MAX_SUBJECT}): ${subject}`);
  }
  const keys = Object.keys(parts.trailers);
  const known = TRAILER_ORDER.filter((k) => keys.includes(k));
  const others = keys.filter((k) => !TRAILER_ORDER.includes(k)); // attribution trailers come last
  const trailerLines = [...known, ...others].map((k) => `${k}: ${parts.trailers[k]}`);
  const paragraphs = [subject];
  if (parts.body?.trim()) paragraphs.push(parts.body.trim());
  if (trailerLines.length > 0) paragraphs.push(trailerLines.join("\n"));
  return paragraphs.join("\n\n") + "\n";
}

/** Trailers the CLI adds to its own commits; agent and session only when the env vars are non-empty. */
export function cliTrailers(workflow: string, planId: string, env: NodeJS.ProcessEnv = process.env): Trailers {
  const t: Trailers = { "Specplane-Workflow": workflow };
  if (planId) t["Specplane-Plan"] = planId;
  if (env.SPECPLANE_AGENT) t["Specplane-Agent"] = env.SPECPLANE_AGENT;
  if (env.SPECPLANE_SESSION) t["Specplane-Session"] = env.SPECPLANE_SESSION;
  return t;
}

/** All trailers of the commit at `ref`; the last value wins for repeated keys. */
export function readTrailers(ref: string, cwd: string = process.cwd()): Map<string, string> {
  const out = run("git", ["log", "-1", "--format=%(trailers:only,unfold)", ref], { cwd });
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line.trim());
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

/** Newest commit reachable from `branch` whose `Specplane-Workflow` trailer equals `workflow`. */
export function findLatest(branch: string, workflow: string, cwd: string = process.cwd()): string | null {
  const out = run(
    "git",
    ["log", "--format=%H%x00%(trailers:key=Specplane-Workflow,valueonly)", branch],
    { cwd },
  );
  let sha: string | null = null;
  let value = "";
  const flush = (): string | null => (sha && value === workflow ? sha : null);
  for (const line of out.split("\n")) {
    const nul = line.indexOf("\0");
    if (nul >= 0) {
      const hit = flush();
      if (hit) return hit;
      sha = line.slice(0, nul);
      value = line.slice(nul + 1).trim();
    } else if (line.trim()) {
      value = line.trim(); // repeated key: last wins
    }
  }
  return flush();
}
