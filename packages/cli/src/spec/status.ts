import { parseCite } from "./cites.js";
import { specFingerprint } from "./fingerprint.js";
import { loadProject, resolveCite, targetFingerprint, type Project, type SpecDoc } from "./project.js";
import { commitExists, committedSource } from "./source.js";

/** Effective status of a spec, computed from committed content (`architecture/file-formats` §4.5). */

export interface EffectiveStatus {
  status: "approved" | "awaiting-review";
  reasons: string[];
  notes: string[];
  warnings: string[];
}

/** Dependency cites of a spec as written: `covers`, `implements`, `references`, deduplicated. */
export function dependencyCites(data: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  for (const key of ["covers", "implements", "references"]) {
    const v = data?.[key];
    if (Array.isArray(v)) for (const item of v) if (typeof item === "string" && !out.includes(item)) out.push(item);
  }
  return out;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Loads the project at other commits for the hand-format check, once per commit. */
export class CommitProjects {
  private cache = new Map<string, Project | null>();
  constructor(private root: string, private head: Project) {}
  at(commit: string): Project | null {
    if (!this.cache.has(commit)) {
      this.cache.set(commit, commitExists(this.root, commit) ? loadProject(committedSource(this.root, commit), this.head.paths) : null);
    }
    return this.cache.get(commit) ?? null;
  }
}

export function computeStatus(head: Project, doc: SpecDoc, commits: CommitProjects, workingText?: string | null): EffectiveStatus {
  const notes: string[] = [];
  const warnings: string[] = [];
  if (workingText != null && workingText !== doc.text) notes.push("uncommitted changes are ignored");
  const data = doc.fm.data;
  const approval = data?.approval;
  const stored = data?.status;
  if (!data || stored !== "approved" || !isMap(approval)) {
    const rr = data?.["review-reason"];
    const reasons = typeof rr === "string" ? [rr] : Array.isArray(rr) && rr.every((x) => typeof x === "string") && rr.length ? (rr as string[]) : ["never-approved"];
    return { status: "awaiting-review", reasons, notes, warnings };
  }
  const reasons: string[] = [];
  const commit = typeof approval.commit === "string" ? approval.commit : null;
  const atCommit = commit ? commits.at(commit) : null;

  // Step 2: whole-spec content.
  const nowSpecFp = specFingerprint(doc.text);
  const storedFp = typeof approval.fingerprint === "string" ? approval.fingerprint : null;
  if (storedFp) {
    if (!/^spec-v3:sha256:[0-9a-f]{64}$/.test(storedFp)) { reasons.push("edited"); warnings.push(`unknown fingerprint version in approval: ${storedFp}`); }
    else if (storedFp !== nowSpecFp) reasons.push("edited");
  } else {
    const then = atCommit?.source.read(doc.file) ?? null;
    if (then === null) {
      reasons.push("edited");
      warnings.push(atCommit ? `${doc.file} does not exist at approval commit ${commit}; approval cannot be checked` : `approval commit ${commit ?? "(missing)"} is not in history; approval cannot be checked`);
    } else if (specFingerprint(then) !== nowSpecFp) reasons.push("edited");
  }

  // Steps 3 and 4: cited parts and approval of dependencies.
  const cited = isMap(approval.cited) ? approval.cited : null;
  for (const raw of dependencyCites(data)) {
    const cite = parseCite(raw);
    if (!cite) continue;
    const res = resolveCite(head, cite);
    if (!res.ok && res.code === "later-release") continue;
    const nowFp = res.ok ? targetFingerprint(res.target) : null;
    // A dependency added after approval is a metadata change, not an edit (`cli R17`): nothing was recorded to
    // compare it with, so it is not outdated until the spec is approved again.
    let changed: boolean;
    if (cited) {
      const exp = cited[raw];
      changed = typeof exp === "string" && (nowFp === null || exp !== nowFp);
    } else if (!atCommit) changed = false; // approval cannot be checked; step 2 already reported it
    else {
      const thenData = atCommit.specs.get(doc.id)?.fm.data;
      if (!thenData || !dependencyCites(thenData).includes(raw)) changed = false;
      else {
        const then = resolveCite(atCommit, cite);
        changed = !then.ok || nowFp === null || targetFingerprint(then.target) !== nowFp;
      }
    }
    if (changed) reasons.push(`outdated: ${raw}`);
    if (res.ok && res.target.specId && res.target.specId !== doc.id) {
      const dep = head.specs.get(res.target.specId);
      if (dep && !isMap(dep.fm.data?.approval)) reasons.push(`unapproved-dependency: ${raw}`);
    }
  }
  return { status: reasons.length ? "awaiting-review" : "approved", reasons, notes, warnings };
}
