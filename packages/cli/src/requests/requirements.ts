import { loadSpecPaths } from "../spec/paths.js";
import { loadProject } from "../spec/project.js";
import { committedSource } from "../spec/source.js";

/** Required permissions come from the action, never from request permission metadata (requests R52.2/R52.3). */
export type ActionNeeds = (string | string[])[];

export class InvalidRequestAction extends Error {
  constructor(message: string) { super(message); this.name = "InvalidRequestAction"; }
}

const invalid = (message: string): never => { throw new InvalidRequestAction(message); };
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

/**
 * Validate the parameter shape before deriving permissions. Execution must still check current-state preconditions
 * (patch applicability, plan status, config value, etc.). Permission alternatives retain the guard's granular/general
 * semantics rather than freezing whichever permission the sender happened to have.
 */
export function actionNeeds(root: string, command: string, params: unknown): ActionNeeds {
  if (!params || typeof params !== "object" || Array.isArray(params)) invalid("Request parameters must be an object.");
  const p = params as Record<string, unknown>;
  const requireText = (key: string): string => text(p[key]) ? p[key] as string : invalid(`\`${command}\` needs a non-empty string \`${key}\`.`);
  const optional = (key: string, check: (v: unknown) => boolean): void => {
    if (p[key] !== undefined && !check(p[key])) invalid(`Invalid \`${key}\` for \`${command}\`.`);
  };
  const bool = (key: string): void => optional(key, (v) => typeof v === "boolean");
  const oneOf = (key: string, values: string[], required = false): void => {
    if (required || p[key] !== undefined) {
      if (!values.includes(p[key] as string)) invalid(`\`${key}\` for \`${command}\` must be one of: ${values.join(", ")}.`);
    }
  };
  const specLayer = (key: string): string => {
    const id = requireText(key);
    const head = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
    const doc = head.specs.get(id);
    if (!doc) return invalid(`Specification \`${id}\` does not exist.`);
    return doc.layer;
  };

  switch (command) {
    case "spec approve":
      if (!strings(p.ids) || !p.ids.length) invalid("`spec approve` needs a non-empty list of specification IDs.");
      return ["spec.approve"];
    case "spec reopen": return [`spec.edit.${specLayer("id")}`];
    case "spec edit":
      requireText("patch");
      return [`spec.edit.${specLayer("spec")}`];
    case "spec meta set": {
      specLayer("id");
      const field = requireText("field");
      if (!["title", "authors", "references", "covers", "approval.date", "approval.commit"].includes(field)) invalid(`Metadata field \`${field}\` cannot be set.`);
      if (typeof p.value !== "string") invalid("`spec meta set` needs a string `value`.");
      const piece = field.startsWith("approval.") ? "approval" : field;
      return [[`meta.write.${piece}`, "meta.write"]];
    }
    case "spec override status":
    case "spec override approver":
    case "spec override test":
      specLayer("id");
      if (!strings(p.args) || !p.args.length) invalid(`\`${command}\` needs a non-empty list of arguments.`);
      return [`override.${command.slice("spec override ".length)}`];
    case "config set":
      requireText("key");
      // Guard-generated requests carry both parsed `new` and original `arg`; manual requests may carry `new` only.
      if (p.arg !== undefined && p.arg !== null && typeof p.arg !== "string") invalid("`config set` needs a string `arg`.");
      if (typeof p.arg !== "string" && !("new" in p)) invalid("`config set` needs `arg` or `new`.");
      return ["config.change"];
    case "config unset": requireText("key"); return ["config.change"];
    case "plan create": {
      if (!strings(p.words)) invalid("`plan create` needs a list of words.");
      const words = (p.words as string[]).flatMap((w) => w.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      if (words.length < 2 || words.length > 4) invalid("A plan name is two to four words.");
      optional("title", text);
      for (const key of ["implements", "writes", "references"]) optional(key, strings);
      return ["plan.create"];
    }
    case "plan approve": requireText("id"); return ["spec.approve"];
    case "plan start":
      requireText("id"); optional("target", text); bool("forceDeps"); return ["plan.start"];
    case "plan stop":
      requireText("id"); oneOf("kind", ["soft", "user", "hard", "failure"]);
      optional("reason", text); optional("needs", text); return ["plan.softstop"];
    case "plan resume": requireText("id"); return ["plan.resume"];
    case "plan retarget": requireText("id"); requireText("target"); return ["plan.resume"];
    case "plan budget":
      requireText("id"); requireText("resource"); bool("remove");
      if (!p.remove && !(typeof p.soft === "number" && Number.isFinite(p.soft) && p.soft > 0 &&
        typeof p.hard === "number" && Number.isFinite(p.hard) && p.hard >= p.soft)) invalid("A budget needs finite values with 0 < soft <= hard.");
      return ["plan.budget"];
    case "plan finish":
      requireText("id"); bool("complete"); optional("back", text);
      if ((p.complete === true) === text(p.back)) invalid("Give exactly one of complete or back.");
      return ["plan.complete"];
    case "plan merge":
      requireText("id"); oneOf("mode", ["pr", "local"], true); bool("force"); return ["plan.complete"];
    case "plan abandon":
    case "plan delete":
      requireText("id"); bool("force"); return [command === "plan abandon" ? "plan.abandon" : "plan.delete"];
    case "plan step-done":
      requireText("id");
      if (typeof p.step !== "number" || !Number.isSafeInteger(p.step) || p.step <= 0) invalid("`step` must be a positive integer.");
      oneOf("outcome", ["done", "partial"], true); optional("summary", text); optional("type", text);
      return ["plan.step"];
    default: return invalid(`\`${command}\` is not an action that can be requested.`);
  }
}
