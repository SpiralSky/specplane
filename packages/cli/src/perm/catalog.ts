import { CATALOG } from "./permissions.js";

/**
 * Documentation of every permission (`feature/configuration` R54, `architecture/reference-cli` §7.2, §7.4).
 * Each entry says what the permission allows and does not, which commands use it, and the key of its steering text.
 */

export interface PermDoc {
  id: string;
  allows: string;
  doesNotAllow: string;
  commands: string[];
  /** Key of the generated steering text (`feature/steering` R51); the text itself is delivered by the steering code. */
  steeringKey: string;
}

const TYPES = ["requirement", "feature", "architecture"] as const;
const PIECES: Record<string, string> = { title: "title", authors: "authors", references: "references", covers: "covers", approval: "approval date and commit" };

function docs(): PermDoc[] {
  const out: PermDoc[] = [];
  const add = (id: string, allows: string, doesNotAllow: string, commands: string[]) =>
    out.push({ id, allows, doesNotAllow, commands, steeringKey: `steering.${id}` });
  for (const t of TYPES) {
    add(`spec.create.${t}`, `Create a ${t} specification file.`, `Editing or deleting one, or approving it. A new LLM-written specification starts Awaiting Review.`, ["harness spec create"]);
    add(`spec.edit.${t}`, `Change the body of a ${t} specification, which makes it Awaiting Review again.`, `Creating or deleting one, writing metadata, or approving it.`, ["harness spec edit", "spec reopen"]);
    add(`spec.delete.${t}`, `Delete a ${t} specification file.`, `Creating or editing one.`, ["harness spec delete"]);
  }
  add("spec.approve", "Approve specifications that are Awaiting Review.", "Editing a specification, or setting a status by hand (that is `override.status`).", ["spec approve"]);
  add("meta.read", "Read specification metadata.", "Writing any metadata.", ["spec meta get"]);
  add("meta.write", "Write any metadata piece that has a granular permission, other than the protected overrides.", "Status, approver and test results (the protected overrides) and the specification body.", ["spec meta set"]);
  for (const [p, label] of Object.entries(PIECES)) {
    add(`meta.write.${p}`, `Write only the ${label} of a specification.`, "Any other metadata piece. The more permissive of this and `meta.write` applies.", ["spec meta set"]);
  }
  add("override.status", "Set a specification status by hand.", "It is never covered by `meta.write`.", ["spec override status"]);
  add("override.approver", "Set the recorded approver by hand.", "It is never covered by `meta.write`.", ["spec override approver"]);
  add("override.test", "Set or clear a test result by hand.", "It is never covered by `meta.write`.", ["spec override test"]);
  add("test.record", "Record a test result.", "Marking a result by hand (that is `override.test`).", ["test run"]);
  add("info.retrieve", "Read information: viewing, review, validation, listing, coverage, test runs and the audit log.", "Changing anything.", ["validate", "warnings", "coverage", "spec list", "spec show", "test run", "audit"]);
  add("plan.meta.read", "Read plan metadata (later release).", "Writing plan metadata.", ["plan meta get"]);
  add("plan.meta.write", "Write plan metadata (later release).", "The plan body.", ["plan meta set"]);
  add("plan.edit", "Edit a plan.", "Creating, starting or deleting it.", ["harness plan edit"]);
  add("plan.create", "Create a plan.", "Starting it.", ["harness plan create"]);
  add("plan.delete", "Delete a plan.", "Abandoning a running one.", ["plan delete"]);
  add("plan.start", "Start a plan.", "Editing it.", ["plan start"]);
  add("plan.abandon", "Abandon a plan.", "Deleting it.", ["plan abandon"]);
  add("plan.complete", "Complete a plan, and merge it.", "Starting or abandoning it.", ["plan finish", "plan merge"]);
  add("plan.budget", "Set the budget of a plan.", "Anything else about the plan.", ["plan budget"]);
  add("plan.resume", "Resume a stopped plan.", "Starting a plan that never ran.", ["plan resume"]);
  add("plan.softstop", "Stop a running plan after the current work.", "Abandoning it.", ["plan stop"]);
  add("plan.step", "Record a finished plan step: mark it done and commit its handoff entry.", "Starting, resuming or completing the plan.", ["plan step-done"]);
  add("decision.add", "Add a decision record (later release).", "Editing or deleting one.", ["decision add"]);
  add("decision.retrieve", "Read decision records (later release).", "Changing them.", ["decision show"]);
  add("decision.edit", "Edit a decision record (later release).", "Adding or deleting one.", ["decision edit"]);
  add("decision.delete", "Delete a decision record (later release).", "Adding or editing one.", ["decision delete"]);
  add("config.change", "Change a setting, including the active preset (`permissions.preset`).", "Reading settings, which needs no permission.", ["config set", "config unset", "init"]);
  return out;
}

export const PERMISSION_DOCS: readonly PermDoc[] = docs();

export function permissionDoc(id: string): PermDoc | undefined {
  return PERMISSION_DOCS.find((d) => d.id === id);
}

/** Catalog permissions without a description or steering key (a validation warning, `reference-cli` §7.4). */
export function undocumentedPermissions(): string[] {
  const have = new Map(PERMISSION_DOCS.map((d) => [d.id, d]));
  return CATALOG.filter((id) => { const d = have.get(id); return !d || !d.allows || !d.steeringKey; });
}
