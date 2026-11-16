import { CATALOG, PLAN_PIECES } from "./permissions.js";

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
  for (const t of TYPES) {
    const requirement = t === "requirement" ? " Approving the requirements page is the user's decision." : "";
    const decisions = t === "feature" ? " It also approves decision records, by ID, and plans." : "";
    add(`spec.approve.${t}`, `Approve ${t} specifications that are Awaiting Review.${requirement}`, `Editing a specification, or setting a status by hand (that is \`override.status\`). A group of specifications that cite each other needs the permission of each member's type.${decisions}`, t === "feature" ? ["spec approve", "decision approve", "plan approve"] : ["spec approve"]);
  }
  add("meta.read", "Read specification metadata.", "Writing any metadata.", ["spec meta get"]);
  add("meta.write", "Write any metadata piece that has a granular permission, other than the protected overrides.", "Status, approver and test results (the protected overrides) and the specification body.", ["spec meta set"]);
  for (const [p, label] of Object.entries(PIECES)) {
    add(`meta.write.${p}`, `Write only the ${label} of a specification.`, "Any other metadata piece. The more permissive of this and `meta.write` applies.", ["spec meta set"]);
  }
  add("override.status", "Set a specification status by hand.", "It is never covered by `meta.write`.", ["spec override status"]);
  add("override.approver", "Set the recorded approver by hand.", "It is never covered by `meta.write`.", ["spec override approver"]);
  add("override.approval-commit", "Set the commit shown as the one approved, by hand.", "It changes only what is shown, not the status, and is never covered by `meta.write`.", ["spec override approval-commit"]);
  add("override.test", "Set or clear a test result by hand.", "It is never covered by `meta.write`.", ["spec override test"]);
  add("test.record", "Record a test result.", "Marking a result by hand (that is `override.test`).", ["test run"]);
  add("info.retrieve", "Read information: viewing, review, validation, listing, coverage, test runs and the audit log.", "Changing anything.", ["validate", "warnings", "coverage", "spec list", "spec show", "test run", "audit"]);
  add("plan.meta.read", "Read plan metadata: title, authors, references, specifications, approval and execution status.", "Writing plan metadata.", ["plan meta get"]);
  add("plan.meta.write", "Write any plan metadata piece that has a granular permission.", "The plan body and steps, and execution status and progress, which change through the plan commands.", ["plan meta set"]);
  for (const p of PLAN_PIECES) {
    add(`plan.meta.write.${p}`, `Write only the ${p === "implements" ? "specifications the plan implements or writes" : p} of a plan.`, "Any other plan metadata piece. The more permissive of this and `plan.meta.write` applies.", ["plan meta set"]);
  }
  add("plan.edit", "Edit a plan.", "Creating, starting or deleting it.", ["harness plan edit"]);
  add("plan.create", "Create a plan.", "Starting it.", ["harness plan create"]);
  add("plan.delete", "Delete a plan.", "Abandoning a running one.", ["plan delete"]);
  add("plan.start", "Start a plan.", "Editing it.", ["plan start"]);
  add("plan.abandon", "Abandon a plan.", "Deleting it.", ["plan abandon"]);
  add("plan.complete", "Complete a plan, and merge it.", "Starting or abandoning it.", ["plan finish", "plan merge"]);
  add("plan.budget", "Set the budget of a plan.", "Anything else about the plan.", ["plan budget"]);
  add("plan.resume", "Resume a stopped plan.", "Starting a plan that never ran.", ["plan resume"]);
  add("plan.softstop", "Stop a running plan after the current work.", "Abandoning it.", ["plan stop"]);
  add("decision.add", "Add a decision record the user made.", "Editing or deleting one.", ["decision add"]);
  add("decision.retrieve", "Read decision records: list, search and show.", "Changing them.", ["decision list", "decision show"]);
  add("decision.edit", "Edit a decision record.", "Adding or deleting one.", ["decision edit"]);
  add("decision.delete", "Delete a decision record.", "Adding or editing one.", ["decision delete"]);
  add("config.change", "Change a setting, including the active preset (`permissions.preset`).", "Reading settings, which needs no permission.", ["config set", "config unset", "init"]);
  add("preset.create", "Create a permission preset (`preset create`). Deny refuses; allow creates it directly within the level rule (the preset may state modes only for the LLM role, and none above the LLM role's own); request user sends the full preset with a preview that the user accepts or declines. A created preset is never active.", "Editing or deleting presets, or activating one (activation stays a `config set` request).", ["preset create"]);
  add("role.manage", "Management permission: create, edit, delete and approve custom roles, and change what a preset or a role allows, for roles whose management level is below the actor's. The actor may not give a mode more permissive than its own.", "Changing the actor's own role, or any role at an equal or higher level. It is never set by a preset, and a default mode never grants it. Request user does not apply: a role that has it only as request user is refused.", ["role create", "role edit", "role delete", "role approve", "preset create", "preset edit", "preset delete"]);
  add("role.map", "System permission: map operating system users and LLMs to roles (`role map`, `role rule ...`), for roles whose management level is below the actor's. The Administrator may also map users to the Administrator role.", "Mapping anyone to a role at an equal or higher level than the actor's (the Administrator is exempt for operating system users only), or approving a change. It is never set by a preset, and a default mode never grants it. Request user does not apply.", ["role map", "role unmap", "role rule create", "role rule edit", "role rule delete"]);
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
