/** Shared types, derived from architecture/file-formats §1-§7 and architecture/reference-cli. */

export type SpecStatus = "draft" | "review" | "approved" | "deprecated";
export type SpecAuthor = "user" | "llm" | "mixed";
export type PlanStatus = "draft" | "ready" | "in_progress" | "review" | "shelved" | "done" | "abandoned";
export type StepStatus = "pending" | "done" | "skipped" | "blocked";
export type AdrStatus = "proposed" | "accepted" | "superseded" | "deprecated";
export type Authorship = "user" | "llm" | "either";
export type LlmRole = "review" | "assist" | "draft" | "none";
export type SessionMode = "attended" | "unattended";
export type NotificationEvent = "blocked" | "consideration" | "finish_ready" | "done" | "failed";

export interface SpecRootConfig {
  name: string;
  path: string;
  extends?: string;
}

export interface Config {
  spec_roots: SpecRootConfig[];
  specs: {
    llm_review: boolean;
    pin_bases: "off" | "warn" | "require";
    feature: {
      authorship: Authorship;
      llm_role: LlmRole;
      forbid_architecture: boolean;
      leak_guard_allow: string[];
    };
    architecture: {
      authorship: Authorship;
      llm_role: LlmRole;
      require_approved_features: boolean;
    };
  };
  plans: {
    dir: string;
    target_branch?: string;
    require_approved_specs: "none" | "feature" | "feature_and_architecture";
    status_source: "git" | "frontmatter";
    merge: "pull_request" | "local_merge";
    dependency_mode: "wait_for_merge" | "stack";
    archive_done: boolean;
    setup_hook: string;
    test_command: string;
    forge: "auto" | "github" | "none";
  };
  execution: {
    backend: "worktree" | "branch" | "external";
    worktree_dir: string;
    session_mode: "auto" | "unattended";
    notify: {
      on: NotificationEvent[];
      transport: "none" | "harness" | "command";
      command: string;
      dedupe: boolean;
    };
    max_parallel: number;
    max_budget_usd: number | null;
  };
  decisions: { dir: string };
}

/** Non-fatal diagnostic produced while loading configuration. */
export interface Warning {
  message: string;
}

export interface SpecFrontmatter {
  id: string;
  title: string;
  status: SpecStatus;
  author: SpecAuthor;
  supersedes?: string[];
  extends?: string | string[];
  /** Spec ID -> abbreviated git blob hash (7-40 hex). */
  based_on?: Record<string, string>;
  implementation?: ImplementationDeclaration;
  // Feature specs
  allow_architecture?: boolean;
  architecture_reason?: string;
  // Architecture specs
  implements?: string[];
}

export interface ImplementationDeclaration {
  status: "incomplete" | "partial" | "complete";
  assessed_spec_hash?: string;
  assessed_dependencies?: Record<string, string>;
  evidence?: string[];
  implementation_revision?: string;
}

export interface ExecutionBinding {
  target_branch: string;
  start_target_branch: string;
  start_base: string;
  target_changes?: { from: string; to: string }[];
}

export interface PlanFrontmatter {
  id: string;
  title: string;
  status: PlanStatus;
  shelved_from?: "ready" | "in_progress" | "review";
  specs: string[];
  depends_on?: string[];
  target_branch?: string;
  comparison_base?: string;
  execution?: ExecutionBinding;
}

export type StepContextItem =
  | { spec: string }
  | { decision: string }
  | { file: string };

export interface StepFrontmatter {
  plan: string;
  step: number;
  title: string;
  status: StepStatus;
  context?: StepContextItem[];
  use_subagent?: boolean;
}

export interface AdrFrontmatter {
  id: string;
  title: string;
  date: string;
  status: AdrStatus;
  superseded_by?: string;
  related_specs?: string[];
}

export type Severity = "error" | "warning";

export type FindingType =
  | "config" | "schema" | "id" | "reference" | "authorship" | "ordering"
  | "path" | "tech_name" | "identifier" | "schema_syntax" | "overlay"
  | "base-changed" | "pin" | "anchor" | "skill-drift" | "plan" | "step"
  | "adr" | "freshness" | "implementation-reassessment" | "implementation-unverifiable";

export interface Finding {
  file: string;
  message: string;
  severity: Severity;
  type: FindingType;
  spec?: string;
  plan?: string;
  adr?: string;
  line?: number;
}

export interface ValidationReport {
  valid: boolean;
  errors: Finding[];
  warnings: Finding[];
  /** Subjects (spec IDs, plan IDs, ADR IDs, files) that were checked; human output only. */
  checked?: string[];
  implementations?: Array<{ id: string; root: string; path: string } & import("./core/completion.js").ImplementationAssessment>;
}
