import { allSpecs, findDoc } from "../spec/project.js";
import { run } from "../git/exec.js";
import { SpecNotFoundError } from "../errors.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { makePatch } from "../spec/edit.js";
import { lastApprovalCommit } from "../spec/notes.js";
import { worktreeSource } from "../spec/source.js";
import { headContext } from "../verify/implementation.js";
import { listSpecViews, specView } from "./spec-read.js";
import type { CommandResult } from "./runner.js";

/**
 * The spec viewing command (`harness R21`, `R21.1`; `architecture/reference-cli` §12.2): the user reads one specification
 * with its status and, when the text has changed since the last approval, the change as a highlighted diff. It is a read
 * under `info.retrieve` (`harness R26.2`) and has no permission of its own.
 */

const paint = (color: boolean, code: number, text: string): string => (color ? `\u001b[${code}m${text}\u001b[0m` : text);

/** Highlight a unified diff: additions green, deletions red, hunk headers cyan; the file headers are dropped. */
export function highlightDiff(patch: string, color: boolean): string[] {
  const out: string[] = [];
  for (const line of patch.replace(/\n$/, "").split("\n")) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line)) continue;
    out.push(line.startsWith("@@") ? paint(color, 36, line) : line.startsWith("+") ? paint(color, 32, line) : line.startsWith("-") ? paint(color, 31, line) : line);
  }
  return out;
}

/** `spec-view` with no argument: every spec with its status, so the person can pick one. */
export function specViewIndex(root: string): CommandResult {
  const no = refusal(root, "Viewing specs");
  if (no) return no;
  const views = listSpecViews(root);
  const w = Math.max(0, ...views.map((v) => v.id.length));
  return {
    ok: true, data: views, permission: "info.retrieve",
    lines: [...views.map((v) => `${v.id.padEnd(w)}  ${v.status}`), "View one with `spec-view <id>`."],
  };
}

function refusal(root: string, what: string): CommandResult | null {
  const g = guard(activePreset(root), cliActor(root), ["info.retrieve"], what);
  return g.kind === "allow" ? null : { ok: false, findings: [g.kind === "deny" ? g.message : `${what} needs approval from the user.`], permission: "info.retrieve" };
}

/** `spec-view <id>`: header, then the change since the last approval (or since HEAD for a requirement file), then the text. */
export function specViewCommand(root: string, id: string, color = false): CommandResult {
  const no = refusal(root, "Viewing a spec");
  if (no) return no;
  const { project } = headContext(root);
  const hits = findDoc(project, id) ? [findDoc(project, id)!] : [...allSpecs(project)].filter((d) => d.slug === id);
  if (hits.length !== 1) throw new SpecNotFoundError(id);
  const doc = hits[0];
  const v = specView(root, doc);
  const current = worktreeSource(root).read(doc.file) ?? "";

  // The baseline is the last approved text. A requirement file has no approval record and is always approved, so its baseline is HEAD.
  let baseline: string | null = null;
  let baselineName = "the last approval";
  if (doc.layer === "requirement") { baseline = doc.text; baselineName = "HEAD"; }
  else {
    const commit = lastApprovalCommit(root, doc.id);
    if (commit) { try { baseline = run("git", ["show", `${commit}:${doc.file}`], { cwd: root }); } catch { baseline = null; } }
  }

  const lines = [
    `${v.id}  ${v.title}`, `file: ${v.file}`,
    `status: ${v.status}${v.reasons.length ? ` (${v.reasons.join("; ")})` : ""}`,
    `authors: ${v.authors.join(", ") || "none"}`,
  ];
  if (v.approver) lines.push(`approved by: ${v.approver}${v.approval_date ? ` on ${v.approval_date}` : ""}`);
  lines.push("");
  let changed = false;
  if (baseline === null && doc.layer !== "requirement") {
    changed = true;
    lines.push("Never approved: the whole text is new, so nothing is highlighted.", "");
  } else if (baseline !== null && baseline !== current) {
    changed = true;
    lines.push(paint(color, 33, `Changed since ${baselineName}:`), ...highlightDiff(makePatch(doc.file, baseline, current), color), "");
  } else lines.push(`No change since ${baselineName}.`, "");
  lines.push("---", ...current.replace(/\n$/, "").split("\n"));
  return { ok: true, data: { ...v, changed, text: current }, lines, permission: "info.retrieve" };
}
