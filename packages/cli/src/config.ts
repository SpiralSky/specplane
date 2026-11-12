import * as path from "node:path";
import { parseYaml } from "./yaml.js";
import { configDiffersFromHead, readCommittedConfig } from "./config-source.js";
import { CATALOG, PRESETS, allPresets, customPresetFindings, customRoleFindings } from "./perm/permissions.js";
import { bypassFindings } from "./perm/bypass.js";

/**
 * The project's configuration (`feature/configuration` R25, `architecture/file-formats` §6,
 * `architecture/reference-cli` §3.2). Every setting is optional; a bad one is dropped with a finding and its
 * default applies, so the loader never throws on content.
 */

export const CONFIG_PATH = ".specplane/config.yaml";

export type Kind =
  | { t: "bool" }
  | { t: "enum"; values: readonly string[] }
  | { t: "path" }
  | { t: "outpath" }
  | { t: "filename" }
  | { t: "posint" }
  | { t: "days" }
  | { t: "text"; allowEmpty?: boolean }
  | { t: "preset" }
  | { t: "permissions" }
  | { t: "reqids" }
  | { t: "steering" }
  | { t: "strmap" }
  | { t: "list" }
  | { t: "subprojects" }
  | { t: "boolmap" };

export interface SettingDef {
  key: string;
  kind: Kind;
  /** Default as stored: `null` means "none / unset". */
  def: unknown;
  /** Words for the default when the stored form is not readable ("a folder next to the project"). */
  defText?: string;
  later?: boolean;
  doc: string;
  /** The key is a mapping whose entries are `<key>.<name>` (`strict_mode.<measure>`). */
  dynamic?: boolean;
}

const REL = (v: string): string => v;
export const DEFAULT_PRESET_ID = "architecture-level-llm-control";

export const SETTINGS: readonly SettingDef[] = [
  { key: "paths.requirements", kind: { t: "path" }, def: REL("docs/requirements"), doc: "Folder of the requirements files" },
  { key: "paths.requirements_index", kind: { t: "filename" }, def: null, defText: "none (the rule of file-formats §1.2)", doc: "File name of the central requirements file" },
  { key: "paths.features", kind: { t: "path" }, def: "docs/specifications/features", doc: "Folder of the feature specifications" },
  { key: "paths.architecture", kind: { t: "path" }, def: "docs/specifications/architecture", doc: "Folder of the architecture specifications" },
  { key: "paths.test_logs", kind: { t: "path" }, def: "docs/test-logs", doc: "Folder of test logs kept in git (used only when tests.logs is git)" },
  { key: "plans.dir", kind: { t: "path" }, def: "docs/plans", doc: "Folder of the plans" },
  { key: "plans.worktree_dir", kind: { t: "outpath" }, def: null, defText: "a folder next to the project", doc: "Folder in which plan worktrees are created, one subfolder per plan" },
  { key: "plans.setup_command", kind: { t: "text" }, def: null, defText: "none", doc: "Command run once in a new plan worktree; if it fails the plan does not start" },
  { key: "plans.start_conditions", kind: { t: "bool" }, def: true, doc: "on requires the plan and the specifications it references to be Approved before it starts" },
  { key: "plans.parallelism", kind: { t: "posint" }, def: 1, later: true, doc: "Greatest number of tasks in a plan step run at once" },
  { key: "notifications.push", kind: { t: "bool" }, def: false, doc: "Whether requests are sent as push notifications, in a harness that supports them" },
  { key: "notifications.push_permissions", kind: { t: "permissions" }, def: ["all"], doc: "Permissions whose requests are pushed when notifications.push is on" },
  { key: "steering.custom", kind: { t: "steering" }, def: [], doc: "Custom steering added to a permission or command: items {permission|command, scope, text}; command '*' applies overall; scope is all, a spec type, or a plan id" },
  { key: "permissions.preset", kind: { t: "preset" }, def: DEFAULT_PRESET_ID, doc: "The active preset: one of the four default presets or a custom preset" },
  { key: "harness.install_block", kind: { t: "bool" }, def: true, doc: "off stops setup writing the marked block into shared instruction files" },
  { key: "harness.separation_check", kind: { t: "bool" }, def: true, doc: "Whether the optional feature and architecture separation instructions are used" },
  { key: "harness.instructions", kind: { t: "strmap" }, def: {}, dynamic: true, doc: "Replacement text for the instructions delivered with a command: harness.instructions.<command>" },
  { key: "harness.retrieval_include_references", kind: { t: "bool" }, def: false, doc: "Whether retrieving a specification also includes the sections it references" },
  { key: "authorship.record_llm", kind: { t: "bool" }, def: true, doc: "Whether the harness adds the LLM as an author when it writes or changes a specification" },
  { key: "audit.retention", kind: { t: "days" }, def: 30, doc: "Days audit log entries are kept, or forever" },
  { key: "auto_warn", kind: { t: "bool" }, def: true, doc: "Whether each command ends by reporting the number of warnings" },
  { key: "architecture.llm_may_mark_implemented", kind: { t: "bool" }, def: true, doc: "Whether an LLM may mark an architecture specification implemented once its checks pass" },
  { key: "tests.logs", kind: { t: "enum", values: ["local", "git", "off"] }, def: "local", doc: "Where full test logs are kept" },
  { key: "tests.logs_retention", kind: { t: "days" }, def: 30, doc: "Days local test logs are kept, or forever" },
  { key: "pre_commit.duplicate_requirement_ids", kind: { t: "bool" }, def: false, doc: "Check that refuses a commit in which two requirements share an identifier" },
  { key: "pre_commit.tests", kind: { t: "bool" }, def: false, doc: "Check that refuses a commit when the deterministic tests of an architecture specification fail" },
  { key: "coverage.requirement_only", kind: { t: "reqids" }, def: [], doc: "Requirements annotated as requirement-only; uncovered warnings are still reported" },
  { key: "decisions.enabled", kind: { t: "bool" }, def: false, doc: "Whether user decision records are stored and retrieved" },
  { key: "subprojects", kind: { t: "subprojects" }, def: [], doc: "The named locations in the project that are subprojects: items {name, path}; the folder holds requirements/, features/ and architecture/" },
  { key: "strict_mode.enabled", kind: { t: "bool" }, def: false, later: true, doc: "Strict mode as a whole" },
  { key: "strict_mode", kind: { t: "boolmap" }, def: {}, later: true, dynamic: true, doc: "Each strict mode measure on its own: strict_mode.<measure>" },
  { key: "bypass_guards", kind: { t: "boolmap" }, def: {}, dynamic: true, doc: "Each guardrail against permission bypass on its own (default on): bypass_guards.<measure>" },
];

/** Terms of the old model; reported as unknown with a hint (`file-formats` §6.2). */
const RETIRED = ["authorship", "llm_role", "forbid_architecture", "leak_guard_allow", "spec_roots", "specs", "execution", "verification", "agent", "decisions.dir"];

export interface ConfigFinding { severity: "error" | "warning"; key: string; message: string }

export interface ResolvedSetting { key: string; value: unknown; source: "default" | "set"; def: unknown }

/** Absolute folders for the path settings, checked once at load time. */
export interface ResolvedPaths { requirements: string; features: string; architecture: string; plans: string; testLogs: string }

export interface Config {
  /** Absolute checked folders; set by `loadSettings` (empty strings for `parseConfig` alone and the defaults). */
  abs: ResolvedPaths;
  /** Resolved values by dotted key (`strict_mode.x`, `harness.instructions.x` included). */
  values: Record<string, unknown>;
  /** Dotted keys explicitly written in the file. */
  set: Set<string>;
  paths: { requirements: string; requirementsIndex: string | null; features: string; architecture: string; testLogs: string };
  plans: { dir: string; worktreeDir: string | null; setupCommand: string | null; startConditions: boolean; parallelism: number };
  permissionsPreset: string;
  autoWarn: boolean;
  auditRetention: number | "forever";
}

export interface LoadResult { config: Config; findings: ConfigFinding[] }

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const BOOL_WORDS: Record<string, boolean> = { on: true, off: false, true: true, false: false };

/** Flatten a mapping to leaf entries `[dotted key, value]`; settings whose value is a map or list stay whole. */
function defFor(key: string): SettingDef | undefined {
  return SETTINGS.find((s) => s.key === key);
}

function dynamicParent(key: string): SettingDef | undefined {
  const i = key.lastIndexOf(".");
  if (i < 0) return undefined;
  const parent = SETTINGS.find((s) => s.dynamic && s.key === key.slice(0, i));
  return parent;
}

export function isInside(rel: string): boolean {
  const p = path.posix.normalize(rel.replace(/\\/g, "/")).replace(/\/+$/, "");
  return rel.trim() !== "" && !p.startsWith("/") && p !== ".." && !p.startsWith("../") && !/^[A-Za-z]:/.test(p);
}

const normPath = (v: string): string => path.posix.normalize(v.replace(/\\/g, "/")).replace(/\/+$/, "") || ".";

const SUBPROJECT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const REQ_ID = /^R\d+(\.\d+)*$/;
const PRESET_IDS = PRESETS.map((p) => p.id);
const PRESET_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function allowedFor(kind: Kind): string {
  switch (kind.t) {
    case "bool": return "on or off";
    case "enum": return kind.values.join(", ");
    case "path": return "a path inside the repository";
    case "outpath": return "a folder outside the project, absolute or relative to the project";
    case "filename": return "a file name";
    case "posint": return "a whole number above 0";
    case "days": return "a whole number of days above 0, or forever";
    case "text": return "text";
    case "preset": return `${[...new Set(PRESET_IDS)].join(", ")} or a custom preset`;
    case "permissions": return "a list of permission ids, or [all]";
    case "reqids": return "a list of requirement ids such as R12 or R12.1";
    case "steering": return "a list of {permission or command, scope, text}";
    case "strmap": return "a mapping of text";
    case "list": return "a list";
    case "subprojects": return "a list of {name, path} with unique kebab-case names (not root or file) and paths inside the repository that do not overlap";
    case "boolmap": return "a mapping of on/off";
  }
}

/** Normalise one value for `kind`, or return the problem. Strings are accepted for scalar kinds so `config set` can share it. */
export function checkValue(kind: Kind, v: unknown): { ok: true; value: unknown } | { ok: false; problem: string } {
  const bad = (problem: string) => ({ ok: false as const, problem });
  const good = (value: unknown) => ({ ok: true as const, value });
  switch (kind.t) {
    case "bool": {
      if (typeof v === "boolean") return good(v);
      if (typeof v === "string" && v in BOOL_WORDS) return good(BOOL_WORDS[v]);
      return bad(`${JSON.stringify(v)} is not on or off`);
    }
    case "enum":
      return typeof v === "string" && kind.values.includes(v) ? good(v) : bad(`${JSON.stringify(v)} is not one of ${kind.values.join(", ")}`);
    case "path": {
      if (typeof v !== "string" || v.trim() === "") return bad("must be a non-empty path");
      return isInside(v) ? good(normPath(v)) : bad(`${JSON.stringify(v)} is not inside the repository`);
    }
    case "outpath": {
      // Plan worktrees live outside the project (`architecture/repository-layout` §3); a folder that resolves inside it is refused when a plan starts.
      if (typeof v !== "string" || v.trim() === "") return bad("must be a non-empty path");
      return good(v.trim());
    }
    case "filename":
      return typeof v === "string" && v !== "" && !/[\\/]/.test(v) ? good(v) : bad(`${JSON.stringify(v)} is not a plain file name`);
    case "posint":
      return typeof v === "number" && Number.isInteger(v) && v > 0 ? good(v) : bad(`${JSON.stringify(v)} is not a whole number above 0`);
    case "days":
      if (v === "forever") return good(v);
      return typeof v === "number" && Number.isInteger(v) && v > 0 ? good(v) : bad(`${JSON.stringify(v)} is not a whole number of days above 0 or forever`);
    case "text":
      return typeof v === "string" && (kind.allowEmpty || v.trim() !== "") ? good(v) : bad(kind.allowEmpty ? "must be text" : "must be non-empty text");
    case "preset":
      return typeof v === "string" && PRESET_NAME.test(v) ? good(v) : bad(`preset ${JSON.stringify(v)} is not a preset name`);
    case "permissions": {
      if (!Array.isArray(v)) return bad("must be a list");
      const missing = v.filter((p) => p !== "all" && !CATALOG.includes(String(p)));
      return missing.length ? bad(`permission ${missing.map((m) => JSON.stringify(m)).join(", ")} does not exist`) : good(v);
    }
    case "reqids": {
      if (!Array.isArray(v)) return bad("must be a list");
      const badIds = v.filter((x) => typeof x !== "string" || !REQ_ID.test(x));
      return badIds.length ? bad(`${badIds.map((m) => JSON.stringify(m)).join(", ")} is not a requirement id`) : good(v);
    }
    case "steering": {
      if (!Array.isArray(v)) return bad("must be a list");
      for (const [i, item] of v.entries()) {
        if (!isMap(item)) return bad(`item ${i + 1} must be a mapping`);
        const hasP = typeof item.permission === "string", hasC = typeof item.command === "string";
        if (hasP === hasC) return bad(`item ${i + 1} needs exactly one of permission or command`);
        if (hasP && !CATALOG.includes(item.permission as string)) return bad(`item ${i + 1}: permission ${JSON.stringify(item.permission)} does not exist`);
        if (typeof item.text !== "string" || item.text.trim() === "") return bad(`item ${i + 1} needs non-empty text`);
        if (item.scope !== undefined && (typeof item.scope !== "string" || item.scope.trim() === "")) return bad(`item ${i + 1}: scope must be all, a spec type or a plan id`);
      }
      return good(v);
    }
    case "strmap":
      return isMap(v) && Object.values(v).every((x) => typeof x === "string") ? good(v) : bad("must be a mapping of text");
    case "list":
      return Array.isArray(v) ? good(v) : bad("must be a list");
    case "subprojects": {
      if (!Array.isArray(v)) return bad("must be a list");
      const names = new Set<string>();
      const dirs: string[] = [];
      const out: { name: string; path: string }[] = [];
      for (const [i, item] of v.entries()) {
        if (!isMap(item)) return bad(`item ${i + 1} must be a mapping with name and path`);
        const { name, path: where } = item;
        if (typeof name !== "string" || !SUBPROJECT_NAME.test(name) || name === "root" || name === "file") return bad(`item ${i + 1}: name ${JSON.stringify(name)} must be kebab-case and not root or file`);
        if (names.has(name)) return bad(`item ${i + 1}: name \`${name}\` is used twice`);
        if (typeof where !== "string" || !isInside(where)) return bad(`item ${i + 1}: path ${JSON.stringify(where)} is not inside the repository`);
        const dir = normPath(where);
        if (dir === ".") return bad(`item ${i + 1}: path must not be the repository root`);
        if (dirs.some((d) => d === dir || d.startsWith(`${dir}/`) || dir.startsWith(`${d}/`))) return bad(`item ${i + 1}: path \`${dir}\` overlaps another subproject`);
        names.add(name);
        dirs.push(dir);
        out.push({ name, path: dir });
      }
      return good(out);
    }
    case "boolmap": {
      if (!isMap(v)) return bad("must be a mapping");
      const out: Record<string, boolean> = {};
      for (const [k, x] of Object.entries(v)) {
        const c = checkValue({ t: "bool" }, x);
        if (!c.ok) return bad(`${k}: ${c.problem}`);
        out[k] = c.value as boolean;
      }
      return good(out);
    }
  }
}

/** The setting definition for a dotted key, including entries of dynamic maps; with the kind of that entry. */
export function lookup(key: string): { def: SettingDef; kind: Kind; entry: boolean } | undefined {
  const d = defFor(key);
  if (d) return { def: d, kind: d.kind, entry: false };
  const p = dynamicParent(key);
  if (p) return { def: p, kind: p.kind.t === "strmap" ? { t: "text", allowEmpty: p.key === "harness.instructions" } : { t: "bool" }, entry: true };
  return undefined;
}

/** Flatten parsed YAML into `[dotted key, value]` pairs; only mappings are walked, so lists and scalars are leaves. */
function flatten(raw: Record<string, unknown>): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (isMap(v) && defFor(key)?.kind.t !== "steering") walk(v, key);
      else out.push([key, v]);
    }
  };
  walk(raw, "");
  return out;
}

function defaultValues(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of SETTINGS) out[s.key] = s.def;
  return out;
}

/** Make each dynamic map setting hold the entries written under it. */
function collectDynamics(values: Record<string, unknown>, set: Set<string>): void {
  for (const s of SETTINGS.filter((x) => x.dynamic)) {
    const entries: Record<string, unknown> = {};
    for (const k of Object.keys(values)) {
      if (k.startsWith(`${s.key}.`) && !defFor(k)) { entries[k.slice(s.key.length + 1)] = values[k]; set.add(s.key); }
    }
    values[s.key] = entries;
  }
}

function build(values: Record<string, unknown>, set: Set<string>): Config {
  collectDynamics(values, set);
  const v = values as Record<string, any>;
  return {
    values, set, abs: { requirements: "", features: "", architecture: "", plans: "", testLogs: "" },
    paths: { requirements: v["paths.requirements"], requirementsIndex: v["paths.requirements_index"], features: v["paths.features"], architecture: v["paths.architecture"], testLogs: v["paths.test_logs"] },
    plans: { dir: v["plans.dir"], worktreeDir: v["plans.worktree_dir"], setupCommand: v["plans.setup_command"], startConditions: v["plans.start_conditions"], parallelism: v["plans.parallelism"] },
    permissionsPreset: v["permissions.preset"],
    autoWarn: v["auto_warn"],
    auditRetention: v["audit.retention"],
  };
}

/** Defaults for a project with no configuration at all. */
export const DEFAULT_SETTINGS: Config = build(defaultValues(), new Set());

/** Parse configuration text (`null` = no file). Never throws on content. */
export function parseConfig(text: string | null): LoadResult {
  const findings: ConfigFinding[] = [];
  const values = defaultValues();
  const set = new Set<string>();
  if (text === null) return { config: build(values, set), findings };
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) {
    findings.push({ severity: "error", key: CONFIG_PATH, message: `${CONFIG_PATH} is not valid YAML: ${(e as Error).message.split("\n")[0]}; using the defaults` });
    return { config: build(values, set), findings };
  }
  if (raw === null || raw === undefined) return { config: build(values, set), findings };
  if (!isMap(raw)) {
    findings.push({ severity: "error", key: CONFIG_PATH, message: `${CONFIG_PATH} must be a mapping of settings; using the defaults` });
    return { config: build(values, set), findings };
  }
  for (const [key, v] of flatten(raw)) {
    const hit = lookup(key);
    if (!hit) {
      const top = key.split(".")[0];
      const retired = RETIRED.includes(top) || RETIRED.includes(key) || RETIRED.includes(key.split(".").pop() ?? "");
      if (key === "roles.os_user_mapping") findings.push({ severity: "warning", key, message: `\`${key}\` is kept locally on each machine, not in the project's configuration; ignored (\`specplane role map\`)` });
      else if (key.startsWith("roles.llm_rules")) findings.push({ severity: "warning", key, message: `LLM role rules are files under .specplane/roles/rules/, not a setting; ignored (\`specplane role rule create\`)` });
      else findings.push({ severity: "warning", key, message: `unknown setting \`${key}\`${retired ? " (a term of the retired model, not read)" : ""}; ignored` });
      continue;
    }
    const c = checkValue(hit.kind, v);
    if (!c.ok) {
      findings.push({ severity: "error", key, message: `setting \`${key}\` is malformed: ${c.problem}; allowed: ${allowedFor(hit.kind)}; using the default` });
      continue;
    }
    values[key] = c.value;
    set.add(key);
  }
  // paths must not overlap (`reference-cli` §3.2).
  const folders = ["paths.requirements", "paths.features", "paths.architecture", "plans.dir"];
  for (let i = 0; i < folders.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = values[folders[i]] as string, b = values[folders[j]] as string;
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        const bad = set.has(folders[i]) ? folders[i] : set.has(folders[j]) ? folders[j] : null;
        if (bad) {
          const other = bad === folders[i] ? folders[j] : folders[i];
          findings.push({ severity: "error", key: bad, message: `setting \`${bad}\` is malformed: \`${values[bad]}\` overlaps \`${other}\` (\`${values[other]}\`); allowed: folders that do not contain each other; using the default` });
          values[bad] = defFor(bad)!.def;
          set.delete(bad);
        }
        break;
      }
    }
  }
  return { config: build(values, set), findings };
}

/**
 * Read the configuration committed at HEAD of the checkout at `root` (`architecture/reference-cli` §3.2). A missing
 * file means all defaults; a working-tree file that differs from HEAD is ignored with a warning finding. The paths are
 * resolved and checked here, once, and the result is the one `Config` the command passes down.
 */
export function loadSettings(root: string): LoadResult {
  const result = parseConfig(readCommittedConfig(root));
  if (configDiffersFromHead(root)) {
    result.findings.push({ severity: "warning", key: CONFIG_PATH, message: `${CONFIG_PATH} differs from HEAD; the uncommitted change is ignored until it is committed` });
  }
  result.config.abs = resolvePaths(root, result.config, result.findings);
  for (const f of customPresetFindings(root)) result.findings.push({ severity: "error", key: f.file, message: f.message });
  for (const f of bypassFindings(result.config.values["bypass_guards"] as Record<string, boolean> | undefined)) result.findings.push({ severity: "warning", key: "bypass_guards", message: f });
  for (const f of customRoleFindings(root)) result.findings.push({ severity: f.severity, key: f.file, message: f.message });
  // A preset ID that names no default or custom preset is malformed, and the default preset applies (`file-formats` §7.3).
  const id = result.config.permissionsPreset;
  if (!allPresets(root).some((p) => p.id === id)) {
    if (result.config.set.has("permissions.preset")) result.findings.push({ severity: "error", key: "permissions.preset", message: `setting \`permissions.preset\` is malformed: preset ${JSON.stringify(id)} does not exist; allowed: ${allowedFor({ t: "preset" })}; using the default` });
    result.config.permissionsPreset = DEFAULT_PRESET_ID;
    result.config.values["permissions.preset"] = DEFAULT_PRESET_ID;
  }
  return result;
}

/** Absolute, checked locations for the folder settings: inside the checkout, no symbolic link out of it. */
function resolvePaths(root: string, config: Config, findings: ConfigFinding[]): ResolvedPaths {
  const base = path.resolve(root);
  const one = (key: string, rel: string): string => {
    const abs = path.resolve(base, rel);
    const within = path.relative(base, abs);
    if (within.startsWith("..") || path.isAbsolute(within)) {
      findings.push({ severity: "error", key, message: `setting \`${key}\` is malformed: \`${rel}\` resolves outside the repository; allowed: a path inside the repository` });
      return path.resolve(base, String(defFor(key)!.def));
    }
    return abs;
  };
  return {
    requirements: one("paths.requirements", config.paths.requirements),
    features: one("paths.features", config.paths.features),
    architecture: one("paths.architecture", config.paths.architecture),
    plans: one("plans.dir", config.plans.dir),
    testLogs: one("paths.test_logs", config.paths.testLogs),
  };
}

/** Every setting with its value, source and default (`configuration R25`), dynamic map entries included. */
export function listSettings(config: Config): Array<ResolvedSetting & { later: boolean; doc: string }> {
  const out: Array<ResolvedSetting & { later: boolean; doc: string }> = [];
  for (const s of SETTINGS) {
    out.push({ key: s.key, value: config.values[s.key], source: config.set.has(s.key) ? "set" : "default", def: s.def, later: !!s.later, doc: s.doc });
  }
  return out;
}

export function describeDefault(def: SettingDef): string {
  return def.defText ?? formatValue(def.def);
}

export function formatValue(v: unknown): string {
  if (v === true) return "on";
  if (v === false) return "off";
  if (v === null || v === undefined) return "none";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
