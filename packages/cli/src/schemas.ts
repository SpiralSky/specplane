/** JSON Schemas from architecture/file-formats (§1.1, §2.1, §3.1, §6.1, §7.1) and AJV helpers. */
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

// ajv-formats is CJS; under NodeNext its default import is typed as the module namespace.
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

export function createAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv;
}

/** Spec ID pattern (architecture/file-formats §1.1); the single source for schema and code. */
export const ID_PATTERN = "^(feature|architecture)/[a-z0-9](?:[a-z0-9-]|/(?!/))*[a-z0-9]$";

const strArray = { type: "array", items: { type: "string" } };
export const FINGERPRINT_PATTERN = "^[a-z0-9][a-z0-9-]*:sha256:[0-9a-f]{64}$";
export const QUALIFIED_SPEC_PATTERN = `^[^:#]*:${ID_PATTERN.slice(1)}`;

export const SPEC_COMMON_SCHEMA = {
  type: "object",
  required: ["id", "title", "status", "author"],
  additionalProperties: true,
  properties: {
    id: { type: "string", pattern: ID_PATTERN },
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["draft", "review", "approved", "deprecated"] },
    author: { type: "string", enum: ["user", "llm", "mixed"] },
    supersedes: strArray,
    extends: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }],
    },
    based_on: {
      type: "object",
      additionalProperties: { type: "string", pattern: "^[0-9a-f]{7,40}$" },
    },
    implementation: {
      type: "object", required: ["status"], additionalProperties: false,
      properties: {
        status: { enum: ["incomplete", "partial", "complete"] },
        assessed_spec_hash: { type: "string", pattern: FINGERPRINT_PATTERN },
        assessed_dependencies: { type: "object", propertyNames: { pattern: QUALIFIED_SPEC_PATTERN }, additionalProperties: { type: "string", pattern: FINGERPRINT_PATTERN } },
        evidence: { type: "array", items: { type: "string", minLength: 1 } },
        implementation_revision: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

export const SPEC_FEATURE_SCHEMA = {
  type: "object",
  properties: {
    allow_architecture: { type: "boolean" },
    architecture_reason: { type: "string" },
  },
} as const;

export const SPEC_ARCHITECTURE_SCHEMA = {
  type: "object",
  required: ["implements"],
  properties: {
    implements: { type: "array", items: { type: "string" }, minItems: 1 },
  },
} as const;

export const PLAN_SCHEMA = {
  type: "object",
  required: ["id", "title", "status", "specs"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}-[a-z0-9][a-z0-9-]*[a-z0-9]$" },
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["draft", "ready", "in_progress", "review", "done", "abandoned"] },
    specs: { type: "array", items: { type: "string" }, minItems: 1 },
    depends_on: strArray,
    target_branch: { type: "string", minLength: 1 },
    comparison_base: { type: "string", pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" },
    execution: {
      type: "object", additionalProperties: false,
      required: ["target_branch", "start_target_branch", "start_base"],
      properties: {
        target_branch: { type: "string", minLength: 1 },
        start_target_branch: { type: "string", minLength: 1 },
        start_base: { type: "string", pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" },
        target_changes: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["from", "to"],
          properties: { from: { type: "string", minLength: 1 }, to: { type: "string", minLength: 1 } },
        } },
      },
    },
  },
} as const;

export const STEP_SCHEMA = {
  type: "object",
  required: ["plan", "step", "title", "status"],
  additionalProperties: false,
  properties: {
    plan: { type: "string" },
    step: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["pending", "done", "skipped", "blocked"] },
    context: {
      type: "array",
      items: {
        type: "object",
        oneOf: [
          { required: ["spec"], properties: { spec: { type: "string" } }, additionalProperties: false },
          { required: ["decision"], properties: { decision: { type: "string" } }, additionalProperties: false },
          { required: ["file"], properties: { file: { type: "string" } }, additionalProperties: false },
        ],
      },
    },
    use_subagent: { type: "boolean" },
  },
} as const;

export const ADR_SCHEMA = {
  type: "object",
  required: ["id", "title", "date", "status"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^decision/\\d{4}$" },
    title: { type: "string", minLength: 1 },
    date: { type: "string", format: "date" },
    status: { type: "string", enum: ["proposed", "accepted", "superseded", "deprecated"] },
    superseded_by: { type: "string" },
    related_specs: strArray,
  },
} as const;

const enumOf = (...values: string[]) => ({ type: "string", enum: values });
const authorship = enumOf("user", "llm", "either");
const llmRole = enumOf("review", "assist", "draft", "none");

export const CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    spec_roots: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "path"],
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          extends: { type: "string" },
        },
      },
    },
    specs: {
      type: "object",
      additionalProperties: false,
      properties: {
        llm_review: { type: "boolean" },
        pin_bases: enumOf("off", "warn", "require"),
        feature: {
          type: "object",
          additionalProperties: false,
          properties: {
            authorship,
            llm_role: llmRole,
            forbid_architecture: { type: "boolean" },
            leak_guard_allow: strArray,
          },
        },
        architecture: {
          type: "object",
          additionalProperties: false,
          properties: {
            authorship,
            llm_role: llmRole,
            require_approved_features: { type: "boolean" },
          },
        },
      },
    },
    plans: {
      type: "object",
      additionalProperties: false,
      properties: {
        dir: { type: "string" },
        target_branch: { type: "string", minLength: 1 },
        require_approved_specs: enumOf("none", "feature", "feature_and_architecture"),
        status_source: enumOf("git", "frontmatter"),
        merge: enumOf("pull_request", "local_merge"),
        dependency_mode: enumOf("wait_for_merge", "stack"),
        archive_done: { type: "boolean" },
        setup_hook: { type: "string" },
        test_command: { type: "string" },
        forge: enumOf("auto", "github", "none"),
      },
    },
    execution: {
      type: "object",
      additionalProperties: false,
      properties: {
        backend: enumOf("worktree", "branch", "external"),
        worktree_dir: { type: "string" },
        session_mode: enumOf("auto", "unattended"),
        notify: {
          type: "object",
          additionalProperties: false,
          properties: {
            on: {
              type: "array",
              items: enumOf("blocked", "consideration", "finish_ready", "done", "failed"),
              uniqueItems: true,
            },
            transport: enumOf("none", "harness", "command"),
            command: { type: "string" },
            dedupe: { type: "boolean" },
          },
        },
        max_parallel: { type: "integer", minimum: 1 },
        max_budget_usd: { type: ["number", "null"], exclusiveMinimum: 0 },
      },
    },
    decisions: {
      type: "object",
      additionalProperties: false,
      properties: { dir: { type: "string" } },
    },
  },
} as const;

const ajv = createAjv();
const cache = new Map<object, ValidateFunction>();

/** Compile (once) and return a validator for a schema constant. */
export function validator(schema: object): ValidateFunction {
  let v = cache.get(schema);
  if (!v) {
    v = ajv.compile(schema);
    cache.set(schema, v);
  }
  return v;
}

/** Dotted path for an AJV instancePath ("/plans/merge" -> "plans.merge"). */
export function dotted(instancePath: string): string {
  return instancePath.split("/").filter(Boolean).join(".");
}

/** One-line human description of an AJV error. */
export function describeError(e: ErrorObject): string {
  if (e.keyword === "required") return `missing required field \`${(e.params as { missingProperty: string }).missingProperty}\``;
  if (e.keyword === "additionalProperties") return `unknown field \`${(e.params as { additionalProperty: string }).additionalProperty}\``;
  const where = dotted(e.instancePath);
  const extra = e.keyword === "enum" ? `: ${((e.params as { allowedValues: unknown[] }).allowedValues).join(", ")}` : "";
  return `${where ? `\`${where}\` ` : ""}${e.message ?? "is invalid"}${extra}`;
}

export function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map(describeError).join("; ");
}
