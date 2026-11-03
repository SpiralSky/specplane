import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { ConfigError, NotARepoError } from "./errors.js";
import { validateTargetBranch } from "./plan/context.js";
import { mainRoot } from "./git/repo.js";
import { isBranchName } from "./git/branch-name.js";
import { CONFIG_SCHEMA, describeError, dotted, validator } from "./schemas.js";
import type { Config, SessionMode, Warning } from "./types.js";

export const CONFIG_PATH = ".specplane/config.yaml";

/** Defaults from feature/configuration. */
export const DEFAULT_CONFIG: Config = {
  spec_roots: [{ name: "base", path: "docs/specifications" }],
  specs: {
    llm_review: false,
    pin_bases: "warn",
    feature: {
      authorship: "user",
      llm_role: "assist",
      forbid_architecture: true,
      leak_guard_allow: [],
    },
    architecture: {
      authorship: "either",
      llm_role: "draft",
      require_approved_features: true,
    },
  },
  plans: {
    dir: "plans",
    require_approved_specs: "feature",
    status_source: "git",
    merge: "pull_request",
    dependency_mode: "wait_for_merge",
    archive_done: true,
    setup_hook: "",
    test_command: "",
    forge: "auto",
  },
  execution: {
    backend: "worktree",
    worktree_dir: "../.specplane-worktrees",
    session_mode: "auto",
    notify: {
      on: ["blocked", "consideration", "finish_ready", "failed"],
      transport: "none",
      command: "",
      dedupe: true,
    },
    max_parallel: 1,
    max_budget_usd: null,
  },
  decisions: { dir: "docs/decisions" },
};

/** Resolve session mode without ever upgrading an unattended detection to attended. */
export function resolveSessionMode(configured: Config["execution"]["session_mode"], detected: SessionMode): SessionMode {
  return configured === "unattended" || detected === "unattended" ? "unattended" : "attended";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge, arrays and scalars replace. */
function merge(base: unknown, over: unknown): unknown {
  if (isObject(base) && isObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
    return out;
  }
  return over === undefined ? base : over;
}

/** Remove the value at an AJV-style instance path (array of segments) from `data`. */
function dropKey(data: unknown, segments: string[], key: string): void {
  let cur: unknown = data;
  for (const s of segments) {
    if (!isObject(cur) && !Array.isArray(cur)) return;
    cur = (cur as Record<string, unknown>)[s];
  }
  if (isObject(cur)) delete cur[key];
}

export interface LoadConfigOptions {
  /**
   * `init` scaffolds a repository whose spec roots do not exist yet, so it turns this off
   * (`architecture/reference-cli` init step 2). Defaults to `true`.
   */
  checkSpecRoots?: boolean;
  /** Validate snapshot config without consulting checkout-specific Git state. */
  snapshot?: boolean;
}

function checkCrossFields(config: Config, root: string, opts: LoadConfigOptions): void {
  if (config.plans.target_branch !== undefined) {
    try {
      const name = config.plans.target_branch;
      if (opts.snapshot) {
        if (!isBranchName(root, name)) throw new Error('invalid branch');
      } else validateTargetBranch(root, name);
    }
    catch { throw new ConfigError("plans.target_branch", "must be a valid Git branch name"); }
  }
  if (config.execution.notify.transport === "command" && config.execution.notify.command.trim() === "") {
    throw new ConfigError("execution.notify.command", "must be non-empty when transport is command");
  }
  const names = new Set<string>();
  for (const r of config.spec_roots) {
    if (names.has(r.name)) throw new ConfigError(null, `Duplicate spec root name \`${r.name}\`.`);
    names.add(r.name);
  }
  const byName = new Map(config.spec_roots.map((r) => [r.name, r]));
  for (const r of config.spec_roots) {
    if (r.extends !== undefined && !byName.has(r.extends)) {
      throw new ConfigError("spec_roots", `root \`${r.name}\` extends undeclared root \`${r.extends}\``);
    }
  }
  for (const r of config.spec_roots) {
    const seen = new Set<string>([r.name]);
    for (let next = r.extends; next !== undefined; next = byName.get(next)?.extends) {
      if (seen.has(next)) throw new ConfigError("spec_roots", `cycle in \`extends\` chain of root \`${r.name}\``);
      seen.add(next);
    }
  }
  if (opts.checkSpecRoots !== false) {
    for (const r of config.spec_roots) {
      const abs = path.resolve(root, r.path);
      const rel = path.relative(root, abs);
      const outside = path.isAbsolute(r.path) || rel === ".." || rel.startsWith(`..${path.sep}`);
      if (outside) {
        throw new ConfigError(null, `Spec root \`${r.name}\`: path \`${r.path}\` is outside the repository.`);
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        throw new ConfigError(null, `Spec root \`${r.name}\`: path \`${r.path}\` does not exist.`);
      }
      if (!stat.isDirectory()) {
        throw new ConfigError(null, `Spec root \`${r.name}\`: path \`${r.path}\` is not a directory.`);
      }
    }
  }
  if (config.execution.backend === "worktree" && !opts.snapshot) {
    let main = root;
    try {
      main = mainRoot(root);
    } catch (e) {
      if (!(e instanceof NotARepoError)) throw e;
    }
    const abs = path.resolve(main, config.execution.worktree_dir);
    const rel = path.relative(main, abs);
    const inside = rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
    if (inside) {
      throw new ConfigError(
        null,
        `\`execution.worktree_dir\` must be outside the repository. \`${config.execution.worktree_dir}\` resolves to \`${abs}\` inside it.`,
      );
    }
  }
}

/**
 * Load `<root>/.specplane/config.yaml` (root = checkout root), validate it, and merge with defaults.
 * Unknown keys become warnings and are dropped; other violations throw ConfigError.
 */
export function loadConfig(root: string, opts: LoadConfigOptions = {}): { config: Config; warnings: Warning[] } {
  const file = path.join(root, CONFIG_PATH);
  return parseConfigText(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null, root, opts);
}

/** Parse configuration bytes from a committed tree without consulting working files. */
export function parseConfigText(text: string | null, root: string, opts: LoadConfigOptions = {}): { config: Config; warnings: Warning[] } {
  const warnings: Warning[] = [];
  let raw: unknown = {};
  if (text === null) {
    warnings.push({ message: "No `.specplane/config.yaml` found; using defaults." });
  } else {
    try {
      raw = yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? {};
    } catch (e) {
      throw new ConfigError(CONFIG_PATH, `malformed YAML: ${(e as Error).message.split("\n")[0]}`);
    }
    if (!isObject(raw)) throw new ConfigError(CONFIG_PATH, "must be a mapping");
  }

  const validate = validator(CONFIG_SCHEMA);
  validate(raw);
  for (const e of validate.errors ?? []) {
    if (e.keyword === "additionalProperties") continue;
    throw new ConfigError(dotted(e.instancePath) || CONFIG_PATH, describeError(e));
  }
  for (const e of validate.errors ?? []) {
    const segs = e.instancePath.split("/").filter(Boolean);
    const key = (e.params as { additionalProperty: string }).additionalProperty;
    warnings.push({ message: `Unknown config key \`${[...segs, key].join(".")}\`; ignoring.` });
    dropKey(raw, segs, key);
  }

  const config = merge(DEFAULT_CONFIG, raw) as Config;
  checkCrossFields(config, root, opts);
  return { config, warnings };
}
