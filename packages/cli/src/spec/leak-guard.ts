/** Architecture-leak guard (`architecture/reference-cli` § Architecture-leak guard). */

export type LeakType = "path" | "tech_name" | "identifier" | "schema_syntax";

export interface LeakWarning {
  type: LeakType;
  /** 1-based line within the checked body. */
  line: number;
  match: string;
  message: string;
}

/** Specplane's own config keys and frontmatter fields (snake_case ones; others cannot match). */
const BUILTIN_NAMES = [
  "spec_roots", "llm_review", "pin_bases", "llm_role", "forbid_architecture", "leak_guard_allow",
  "require_approved_features", "require_approved_specs", "status_source", "dependency_mode",
  "archive_done", "setup_hook", "test_command", "worktree_dir", "based_on", "allow_architecture",
  "architecture_reason", "depends_on", "superseded_by", "related_specs", "use_subagent",
  "local_merge", "pull_request", "wait_for_merge", "in_progress", "feature_and_architecture",
  ".specplane/config.yaml", "PLAN.md", "PLANS.md", "HANDOFF.md", "AGENTS.md", "INFO.md",
];

/** Matched case-insensitively unless listed in CASE_SENSITIVE (common English words). */
const TECH_NAMES = [
  "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "C++", "C#", "Ruby", "PHP", "SQLite",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "React", "Vue", "Angular", "Express", "FastAPI",
  "Django", "Next.js", "npm", "pip", "cargo", "Docker", "Kubernetes", "JSON Schema",
];
const CASE_SENSITIVE = new Set(["Go", "Express"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blank = (s: string) => s.replace(/[^\n]/g, " ");

const PATH_FILE = /(?<![\w/])(?:\.{1,2}\/|\/)?[\w.-]+(?:\/[\w.-]+)+\.[a-z0-9]{1,5}\b/g;
const PATH_DIR = /(?<![\w/])\.?\/?[\w.-]+\/[\w./-]*\/(?=\s|$|[`)])/g;
const BARE_FILE = /(?<![\w/.-])[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|json|yaml|yml|toml|sh|sql|html|css)\b/g;
const IDENTS = [
  /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g,
  /\b(?:[A-Z][a-z0-9]+){2,}\b/g,
  /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g,
  /\$\w+/g,
  /\w+\(\)/g,
];

/** Blank fenced code blocks and link targets, preserving line numbers. */
function preprocess(body: string, allow: string[], linkText = false): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(blank(line));
    } else out.push(fence === null ? line : blank(line));
  }
  let text = out.join("\n");
  if (linkText) text = text.replace(/\[([^\]\n]*)\](?=\([^)\n]*\))/g, (_m, t: string) => "[" + blank(t) + "]");
  text = text.replace(/\]\([^)\n]*\)/g, (m) => "]" + blank(m.slice(1)));
  const terms = [...new Set([...allow, ...BUILTIN_NAMES])].filter((t) => t !== "").sort((a, b) => b.length - a.length);
  for (const t of terms) {
    text = text.replace(new RegExp(`(?<![\\w])${esc(t)}(?![\\w])`, "g"), blank);
  }
  return text;
}

function techRegex(name: string): RegExp {
  return new RegExp(`(?<![\\w])${esc(name)}(?![\\w])`, CASE_SENSITIVE.has(name) ? "g" : "gi");
}

export function checkArchitectureLeak(body: string, allow: string[]): LeakWarning[] {
  const lines = preprocess(body, allow).split("\n");
  const bareLines = preprocess(body, allow, true).split("\n");
  const seen = new Set<string>();
  const out: LeakWarning[] = [];
  const add = (type: LeakType, line: number, match: string, label: string) => {
    const key = `${type}\0${line}\0${match}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, line, match, message: `Possible architecture detail (${type}): "${match}"` + label });
  };
  lines.forEach((text, i) => {
    const n = i + 1;
    for (const re of [PATH_FILE, PATH_DIR]) for (const m of text.matchAll(re)) add("path", n, m[0], "");
    for (const m of (bareLines[i] ?? "").matchAll(BARE_FILE)) {
      if (/\.md$/i.test(m[0]) || TECH_NAMES.some((t) => t.toLowerCase() === m[0].toLowerCase())) continue;
      if (out.some((w) => w.type === "path" && w.line === n && w.match.includes(m[0]))) continue;
      add("path", n, m[0], "");
    }
    for (const name of TECH_NAMES) for (const m of text.matchAll(techRegex(name))) add("tech_name", n, m[0], "");
    const techs = new Set(out.filter((w) => w.type === "tech_name" && w.line === n).map((w) => w.match.toLowerCase()));
    for (const re of IDENTS) for (const m of text.matchAll(re)) if (!techs.has(m[0].toLowerCase())) add("identifier", n, m[0], "");
    const s = /^\s*(?:type|\$ref|properties|required):/.exec(text);
    if (s) add("schema_syntax", n, s[0].trim(), "");
  });
  return out;
}
