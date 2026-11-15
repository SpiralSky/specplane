import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadSettings } from "../config.js";
import { PreconditionError, UsageError } from "../errors.js";
import { readStoreJson, writeStoreJson } from "../repo/store.js";
import { SKILL_COMMANDS, skillPath } from "./claude-skills.js";
import { CODEX_CONTRACTS, contractPath, SKILL_FILE as CODEX_SKILL_FILE } from "./codex-skills.js";
import { getAdapter } from "./adapter.js";
import "./adapters.js";
import { ruleStatuses } from "../perm/llm-rules.js";
import { bypassGuardOn } from "../perm/bypass.js";
import { strictMeasureOn } from "../perm/strict.js";
import { applyOsSafeguards } from "../perm/strict-os.js";
import { steeringInputs, steeringStamp } from "./steering.js";

/**
 * The harness installer (`architecture/reference-cli` §12.6, `architecture/repository-layout` §5): owned files with a
 * version header, and one marked block in a shared instruction file. Text outside the markers is never read for
 * changes or rewritten; an unbalanced block, a symlinked target or a failed check stops setup before anything changes.
 */

export interface OwnedFile { path: string; content: string; mode?: number }
export interface BlockTarget { file: string; text: string }
/** A shared JSON settings file: the template is merged into whatever the user already has (`claude-integration` §5). */
export interface SettingsTarget { path: string; template: Record<string, unknown> }
/** One table in a shared TOML file (Codex `config.toml`): added only when absent, never rewritten (`codex-integration` §1). */
export interface TomlEntryTarget { path: string; table: string; lines: string[] }
/** One server in a shared JSON `.mcp.json` (Claude Code project MCP file): added only when absent, a differing entry is kept and reported (`claude-integration` §1). */
export interface McpJsonTarget { path: string; server: string; entry: Record<string, unknown> }
export interface InstallPlan { harness: string; owned: OwnedFile[]; block?: BlockTarget; settings?: SettingsTarget; toml?: TomlEntryTarget; mcpJson?: McpJsonTarget }
export interface InstallReport { written: string[]; unchanged: string[]; kept: string[]; lines: string[] }
export interface HarnessFinding { severity: "error" | "warning"; message: string; file: string }

export const BEGIN_PREFIX = "<!-- specplane:begin ";
export const END_MARKER = "<!-- specplane:end -->";
const RECORD = "harness-install.json";

export function specplaneVersion(): string {
  return (JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The fixed, short standing text of `harness §2`; the same for every harness. */
export function standingText(stamp: string): string {
  return [
    "## Specplane",
    "",
    "This repository uses Specplane. Before acting on specs or plans, read `.specplane/config.yaml` through the harness and resolve every path from it; never assume one.",
    "Look up your steering for your role and follow it. Use the Specplane harness actions, never the Specplane CLI.",
    "Load the documentation essentials with `docs.essentials` at the start of a session; when you lack information, search the rest with `docs.search` instead of guessing.",
    "If the project has no Specplane configuration, do not apply Specplane rules.",
    "",
    `Steering stamp: ${stamp}`,
  ].join("\n");
}

function beginMarker(version: string): string {
  return `${BEGIN_PREFIX}v${version} — managed by \`specplane init\`; edits inside this block are overwritten -->`;
}

/** Where the Claude Code templates live: next to the compiled CLI when packaged, else the repository's own folder. */
export function claudeTemplateDir(): string {
  for (const rel of ["../templates/claude", "../../../../harnesses/claude/templates"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(path.join(dir, "settings.json"))) return dir;
  }
  throw new PreconditionError(["The Claude Code templates were not found next to the Specplane CLI; reinstall Specplane."]);
}

/** The Claude Code files (`claude-integration` §1): rules, one skill per command contract, hook scripts, settings. */
function claudePlan(stamp: string): InstallPlan {
  const dir = claudeTemplateDir();
  const read = (rel: string): string => fs.readFileSync(path.join(dir, rel), "utf8");
  const owned: OwnedFile[] = [];
  // The steering stamp sits after the shared standing text, before the Claude Code part.
  owned.push({ path: ".claude/rules/specplane.md", content: read("rules/specplane.md").replace("\n\n### Claude Code", `\n\nSteering stamp: ${stamp}\n\n### Claude Code`) });
  for (const command of SKILL_COMMANDS) owned.push({ path: `.claude/${skillPath(command)}`, content: read(skillPath(command)) });
  for (const name of fs.readdirSync(path.join(dir, "hooks")).filter((n) => n.endsWith(".sh")).sort()) {
    owned.push({ path: `.claude/hooks/${name}`, content: read(`hooks/${name}`), mode: 0o755 });
  }
  return {
    harness: "claude", owned, settings: { path: ".claude/settings.json", template: JSON.parse(read("settings.json")) as Record<string, unknown> },
    mcpJson: { path: CLAUDE_MCP, server: "specplane", entry: { command: "specplane", args: ["mcp"], env: { SPECPLANE_ADAPTER: "claude" } } },
  };
}

/** Where the Codex templates live: next to the compiled CLI when packaged, else the repository's own folder. */
export function codexTemplateDir(): string {
  for (const rel of ["../templates/codex", "../../../../harnesses/codex/templates"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(path.join(dir, CODEX_SKILL_FILE))) return dir;
  }
  throw new PreconditionError(["The Codex templates were not found next to the Specplane CLI; reinstall Specplane."]);
}

/**
 * The Codex files (`codex-integration` §1): the entry skill with one contract per offered command, the marked block in
 * `AGENTS.md`, and the one MCP registration entry in the project's Codex configuration. The server is started by the
 * installed CLI name so the file holds no machine-specific path.
 */
function codexPlan(text: string): InstallPlan {
  const dir = codexTemplateDir();
  const read = (rel: string): string => fs.readFileSync(path.join(dir, rel), "utf8");
  const owned: OwnedFile[] = [{ path: `.agents/${CODEX_SKILL_FILE}`, content: read(CODEX_SKILL_FILE) }];
  for (const command of CODEX_CONTRACTS) owned.push({ path: `.agents/skills/specplane/${contractPath(command)}`, content: read(contractPath(command)) });
  return {
    harness: "codex", owned, block: { file: "AGENTS.md", text },
    toml: { path: CODEX_CONFIG, table: "mcp_servers.specplane", lines: ['command = "specplane"', 'args = ["mcp"]', 'env = { SPECPLANE_ADAPTER = "codex" }', 'default_tools_approval_mode = "approve"'] },
  };
}

export const CODEX_CONFIG = ".codex/config.toml";
export const CLAUDE_MCP = ".mcp.json";

/** The files one named harness needs. */
export function planFor(root: string, harness: string): InstallPlan {
  const stamp = steeringStamp(steeringInputs(root));
  const text = standingText(stamp);
  if (harness === "claude") return claudePlan(stamp);
  if (harness === "codex") return codexPlan(text);
  throw new UsageError(`Unknown harness: ${harness}. Supported: claude, codex.`);
}

/** The header an owned file carries: Specplane version, steering stamp and a hash of the body to detect customisation. */
function headerFor(file: string, body: string, version: string, stamp: string | null): string | null {
  const meta = `specplane:file v${version}${stamp ? ` stamp:${stamp}` : ""} sha:${sha(body)}`;
  const ext = path.extname(file);
  if (ext === ".md") return `<!-- ${meta} -->`;
  if ([".sh", ".yaml", ".yml", ".py", ".toml"].includes(ext)) return `# ${meta}`;
  return null; // Formats without comments (JSON) carry no header.
}

const HEADER = /specplane:file v(\S+)(?: stamp:([0-9a-f]+))?(?: sha:([0-9a-f]+))?/;
/**
 * Split an owned file into its lead (a shebang or Markdown frontmatter, which must stay first), the header line and the
 * body. `hashed` is what the body hash covers: frontmatter is part of it, since a user's edit there is a customisation.
 */
function splitHeader(text: string): { header: RegExpMatchArray | null; body: string; lead: string; hashed: string } {
  let lead = "";
  let rest = text;
  if (rest.startsWith("#!")) { const i = rest.indexOf("\n") + 1; lead = i ? rest.slice(0, i) : rest; rest = i ? rest.slice(i) : ""; }
  else if (rest.startsWith("---\n")) { const end = rest.indexOf("\n---\n", 4); if (end !== -1) { lead = rest.slice(0, end + 5); rest = rest.slice(end + 5); } }
  const nl = rest.indexOf("\n");
  const m = (nl === -1 ? rest : rest.slice(0, nl)).match(HEADER);
  if (m) rest = nl === -1 ? "" : rest.slice(nl + 1);
  return { header: m, body: rest, lead, hashed: lead.startsWith("---") ? lead + rest : rest };
}

function withHeader(file: string, content: string, version: string): string {
  const stamp = content.match(/Steering stamp: ([0-9a-f]{64})/)?.[1] ?? null;
  const split = splitHeader(content);
  const header = headerFor(file, split.hashed, version, stamp);
  return header ? `${split.lead}${header}\n${split.body}` : content;
}

/** Refuse a target that is, or sits below, a symlink: setup never writes through one. */
function refuseSymlinks(root: string, rel: string): void {
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new PreconditionError([`Refusing to write through a symlink: ${rel} (${part} is a symlink). Nothing was changed.`]);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
}

export interface BlockParts { before: string; inner: string | null; after: string }
/** Locate the marked block (`after` keeps its leading newline, so the bytes after the end marker are untouched); unbalanced, repeated or misordered markers are an error. */
export function splitBlock(file: string, text: string): BlockParts {
  const lines = text.split("\n");
  const begins = lines.flatMap((l, i) => (l.startsWith(BEGIN_PREFIX) ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === END_MARKER ? [i] : []));
  if (!begins.length && !ends.length) return { before: text, inner: null, after: "" };
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new PreconditionError([`${file} has unbalanced or repeated Specplane block markers (${begins.length} begin, ${ends.length} end). Fix the markers by hand; nothing was changed.`]);
  }
  return {
    before: lines.slice(0, begins[0]).join("\n") + (begins[0] > 0 ? "\n" : ""),
    inner: lines.slice(begins[0], ends[0] + 1).join("\n"),
    after: lines.length > ends[0] + 1 ? `\n${lines.slice(ends[0] + 1).join("\n")}` : "",
  };
}

function atomicWrite(file: string, content: string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, content, { flag: "wx" }); if (mode) fs.chmodSync(tmp, mode); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

/**
 * Add one server to the project's `.mcp.json`. Other servers and keys are kept in order. An existing `specplane` entry
 * is never overwritten: a different one is reported and left; invalid JSON leaves the file alone with a report.
 */
export function mergeMcpJson(existing: string | null, target: McpJsonTarget): { text: string | null; lines: string[]; skipped: boolean } {
  const render = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
  if (existing === null) return { text: render({ mcpServers: { [target.server]: target.entry } }), lines: [], skipped: false };
  let current: Record<string, any>;
  try {
    const parsed = JSON.parse(existing) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    current = parsed as Record<string, any>;
  } catch {
    return { text: null, lines: [`Skipped ${target.path} (invalid JSON; add the \`${target.server}\` MCP server by hand)`], skipped: true };
  }
  const servers = current.mcpServers;
  if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers))) {
    return { text: null, lines: [`Skipped ${target.path} (mcpServers is not an object; add the \`${target.server}\` MCP server by hand)`], skipped: true };
  }
  if (servers && Object.prototype.hasOwnProperty.call(servers, target.server)) {
    const same = JSON.stringify(servers[target.server]) === JSON.stringify(target.entry);
    return { text: null, lines: same ? [] : [`Kept the existing \`${target.server}\` server in ${target.path}: it differs from the one Specplane registers. Remove it and run init again to replace it.`], skipped: false };
  }
  (current.mcpServers ??= {})[target.server] = target.entry;
  return { text: render(current), lines: [], skipped: false };
}

interface Pending { rel: string; content: string; kind: "owned" | "block" | "settings" | "toml" | "mcp"; mode?: number }

/**
 * Add the one table of `target` to a Codex TOML file. An existing table of that name is left alone (the user may have
 * changed it); the text elsewhere is never read for changes or rewritten.
 */
export function mergeTomlEntry(existing: string | null, target: TomlEntryTarget): { text: string | null; lines: string[] } {
  const body = [`[${target.table}]`, ...target.lines].join("\n");
  if (existing === null) return { text: `# Registered by specplane init; delete this table to remove the Specplane tools.\n${body}\n`, lines: [] };
  const header = new RegExp(`^\\s*\\[\\s*${target.table.replace(/\./g, "\\s*\\.\\s*")}\\s*\\]\\s*(#.*)?$`, "m");
  if (header.test(existing)) return { text: null, lines: [] };
  const sep = existing === "" || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${existing}${sep}# Registered by specplane init; delete this table to remove the Specplane tools.\n${body}\n`, lines: [] };
}

/**
 * Merge the template settings into the user's file (`claude-integration` §5). Returns the new text, or null when nothing
 * changes or the file must be left alone; `lines` says why. Unknown keys and their order are kept.
 */
export function mergeSettings(existing: string | null, template: Record<string, unknown>): { text: string | null; lines: string[] } {
  const render = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
  if (existing === null) return { text: render(template), lines: [] };
  let current: Record<string, any>;
  try {
    const parsed = JSON.parse(existing) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    current = parsed as Record<string, any>;
  } catch {
    return { text: null, lines: ["Skipped .claude/settings.json (invalid JSON; add the Specplane registration by hand)"] };
  }
  const lines: string[] = [];
  let changed = false;
  const tplHooks = (template.hooks ?? {}) as Record<string, any[]>;
  for (const [event, groups] of Object.entries(tplHooks)) {
    const hooks = (current.hooks ??= {}) as Record<string, any[]>;
    const present = (hooks[event] ??= []);
    const commands = JSON.stringify(present);
    for (const group of groups) {
      const names = ((group.hooks ?? []) as { command?: string }[]).map((h) => path.basename(String(h.command ?? "").replace(/["']/g, "")));
      if (names.some((n) => n && commands.includes(n))) continue;
      present.push(group);
      changed = true;
    }
  }
  const allow = ((template.permissions as { allow?: string[] } | undefined)?.allow ?? []);
  if (allow.length) {
    const perms = (current.permissions ??= {}) as { allow?: string[] };
    const have = (perms.allow ??= []);
    for (const entry of allow) if (!have.includes(entry)) { have.push(entry); changed = true; }
  }
  if (template.statusLine !== undefined) {
    if (current.statusLine === undefined) { current.statusLine = template.statusLine; changed = true; }
    else if (JSON.stringify(current.statusLine) !== JSON.stringify(template.statusLine)) lines.push("Kept existing statusLine");
  }
  return { text: changed ? render(current) : null, lines };
}

/**
 * Install one harness. Everything is checked first (markers, symlinks, customisation); only then are files written, so a
 * refusal changes nothing. Running it twice changes nothing the second time.
 */
export function installHarness(root: string, harness: string): InstallReport {
  const plan = planFor(root, harness);
  const version = specplaneVersion();
  const report: InstallReport = { written: [], unchanged: [], kept: [], lines: [] };
  const pending: Pending[] = [];

  for (const f of plan.owned) {
    refuseSymlinks(root, f.path);
    const abs = path.join(root, f.path);
    const next = withHeader(f.path, f.content, version);
    if (!fs.existsSync(abs)) { pending.push({ rel: f.path, content: next, kind: "owned", mode: f.mode }); continue; }
    const current = fs.readFileSync(abs, "utf8");
    const { header, hashed } = splitHeader(current);
    if (current === next) report.unchanged.push(f.path);
    else if (!header || (header[3] && header[3] !== sha(hashed))) {
      report.kept.push(f.path);
      report.lines.push(`Kept ${f.path}: ${header ? "it was edited after Specplane wrote it" : "it was not written by Specplane"}. Remove it and run init again to replace it.`);
    } else pending.push({ rel: f.path, content: next, kind: "owned", mode: f.mode });
  }

  if (plan.settings) {
    refuseSymlinks(root, plan.settings.path);
    const abs = path.join(root, plan.settings.path);
    const merged = mergeSettings(fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null, plan.settings.template);
    report.lines.push(...merged.lines);
    if (merged.text !== null) pending.push({ rel: plan.settings.path, content: merged.text, kind: "settings" });
    else if (!merged.lines.some((l) => l.startsWith("Skipped"))) report.unchanged.push(plan.settings.path);
  }

  if (plan.toml) {
    refuseSymlinks(root, plan.toml.path);
    const abs = path.join(root, plan.toml.path);
    const merged = mergeTomlEntry(fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null, plan.toml);
    if (merged.text !== null) pending.push({ rel: plan.toml.path, content: merged.text, kind: "toml" });
    else report.unchanged.push(plan.toml.path);
  }

  if (plan.mcpJson) {
    refuseSymlinks(root, plan.mcpJson.path);
    const abs = path.join(root, plan.mcpJson.path);
    const merged = mergeMcpJson(fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null, plan.mcpJson);
    report.lines.push(...merged.lines);
    if (merged.text !== null) pending.push({ rel: plan.mcpJson.path, content: merged.text, kind: "mcp" });
    else if (!merged.skipped) report.unchanged.push(plan.mcpJson.path);
  }

  if (plan.block) {
    if (!loadSettings(root).config.values["harness.install_block"]) {
      report.lines.push(`Skipped the Specplane block in ${plan.block.file}: harness.install_block is off, so the standing instructions are not installed for ${harness}.`);
    } else {
      refuseSymlinks(root, plan.block.file);
      const abs = path.join(root, plan.block.file);
      const block = `${beginMarker(version)}\n${plan.block.text}\n${END_MARKER}`;
      if (!fs.existsSync(abs)) pending.push({ rel: plan.block.file, content: `${block}\n`, kind: "block" });
      else {
        const current = fs.readFileSync(abs, "utf8");
        const parts = splitBlock(plan.block.file, current);
        const next = parts.inner === null
          ? `${current}${current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n"}${block}\n`
          : `${parts.before}${block}${parts.after}`;
        if (next === current) report.unchanged.push(plan.block.file);
        else pending.push({ rel: plan.block.file, content: next, kind: "block" });
      }
    }
  }

  for (const p of pending) { atomicWrite(path.join(root, p.rel), p.content, p.mode); report.written.push(p.rel); }
  const files = [...plan.owned.map((f) => f.path), ...(plan.toml ? [plan.toml.path] : []), ...(plan.mcpJson ? [plan.mcpJson.path] : []), ...(plan.block && report.written.concat(report.unchanged).includes(plan.block.file) ? [plan.block.file] : [])];
  const record = readStoreJson<Record<string, string[]>>(root, RECORD) ?? {};
  writeStoreJson(root, RECORD, { ...record, [harness]: files.filter((f) => !report.kept.includes(f)) });
  // Rewritten hooks and settings are writable again; strict mode keeps them read-only (`roles-and-permissions R55.1`).
  if (report.written.length && strictMeasureOn(root, "os_permissions")) applyOsSafeguards(root);
  return report;
}

/** Installed harnesses: recorded setups plus a Claude install detected by its hook. */
function installedHarnesses(root: string): string[] {
  const names = new Set(Object.keys(readStoreJson<Record<string, string[]>>(root, RECORD) ?? {}));
  if (fs.existsSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"))) names.add("claude");
  return [...names].sort();
}

/** One note per installed harness that lacks push notifications; `notifications.push` then does nothing (`harness R35.1`, `requests R52.5`). */
export function pushMissingNotes(root: string): string[] {
  const out: string[] = [];
  for (const h of installedHarnesses(root)) {
    const adapter = getAdapter(h);
    if (adapter && !adapter.capabilities(root).push) out.push(`\`notifications.push\` is set, but ${h} does not support push notifications, so no push notification is sent`);
  }
  return out;
}

/** Findings for validation (`harness` family): missing installed files, an older version, a stamp mismatch, marker problems. */
export function inspectInstallation(root: string): HarnessFinding[] {
  const out: HarnessFinding[] = [];
  const version = specplaneVersion();
  let stamp: string | null = null;
  try { stamp = steeringStamp(steeringInputs(root)); } catch { /* A failed generation is reported by the steering warnings. */ }
  const seen = (file: string, writtenVersion: string, writtenStamp: string | null): void => {
    if (writtenVersion !== version) out.push({ severity: "warning", file, message: `${file} was written by Specplane ${writtenVersion}, not the installed ${version}; run \`specplane init --harness <name>\` again` });
    else if (stamp && writtenStamp && writtenStamp !== stamp) out.push({ severity: "warning", file, message: `${file} has a steering stamp that differs from the current steering; run \`specplane init --harness <name>\` again` });
  };
  const recorded = readStoreJson<Record<string, string[]>>(root, RECORD) ?? {};
  for (const files of Object.values(recorded)) {
    for (const f of files) if (!fs.existsSync(path.join(root, f))) out.push({ severity: "warning", file: f, message: `${f} was installed by a harness setup and is missing` });
  }
  const candidates = new Set<string>([".claude/rules/specplane.md", "AGENTS.md", ...Object.values(recorded).flat()]);
  for (const f of [...candidates].sort()) {
    const abs = path.join(root, f);
    let text: string;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    try {
      const parts = splitBlock(f, text);
      if (parts.inner !== null) {
        const begin = parts.inner.split("\n")[0];
        seen(f, begin.match(/ v(\S+) /)?.[1] ?? "unknown", parts.inner.match(/Steering stamp: ([0-9a-f]{64})/)?.[1] ?? null);
        continue;
      }
    } catch (e) { out.push({ severity: "error", file: f, message: (e as Error).message }); continue; }
    const { header } = splitHeader(text);
    if (header) seen(f, header[1], header[2] ?? null);
  }
  // The Claude guards against permission bypass live in one hook; without it only the core's marker check applies (`R58`).
  if (fs.existsSync(path.join(root, ".claude/hooks/specplane-cli-block.sh")) && !fs.existsSync(path.join(root, ".claude/hooks/specplane-bypass-guard.sh"))
    && (["headless_block", "marker_protect", "store_protect", "hook_protect"] as const).some((m) => bypassGuardOn(root, m))) {
    out.push({ severity: "warning", file: ".claude/hooks/specplane-bypass-guard.sh", message: "the Claude hook that guards against permission bypass is not installed, so headless sessions and direct store edits are not blocked; run `specplane init --harness claude` again" });
  }
  // An approved LLM role rule on the subagent, agent type or delegation matches nothing where the harness cannot tell
  // subagents apart (`roles-and-permissions R58`).
  try {
    const harnesses = new Set(Object.keys(recorded));
    if (fs.existsSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"))) harnesses.add("claude");
    const used = ruleStatuses(root).filter((s) => s.approved && (["subagent", "agent_type", "delegated"] as const).some((k) => k in s.rule.match));
    for (const h of [...harnesses].sort()) {
      const adapter = getAdapter(h);
      if (!used.length || !adapter || adapter.capabilities(root)["subagent-identity"]) continue;
      out.push({ severity: "warning", file: h === "claude" ? ".claude/hooks/specplane-caller.sh" : h, message: `LLM role rule ${used.map((s) => s.rule.id).join(", ")} states subagent, agent_type or delegated, but ${h} cannot tell subagents apart for them${h === "claude" ? "; run \`specplane init --harness claude\` again to install the caller hook" : ""}` });
    }
  } catch { /* roles that cannot be read are reported by their own checks */ }
  try {
    if (loadSettings(root).config.values["notifications.push"] === true) for (const m of pushMissingNotes(root)) out.push({ severity: "warning", file: ".specplane/config.yaml", message: m });
  } catch { /* an unreadable config is reported by the config checks */ }
  return out;
}
