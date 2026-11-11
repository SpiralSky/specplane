import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { loadSettings } from "../config.js";
import { PreconditionError, UsageError } from "../errors.js";
import { readStoreJson, writeStoreJson } from "../repo/store.js";
import { steeringInputs, steeringStamp } from "./steering.js";

/**
 * The harness installer (`architecture/reference-cli` §12.6, `architecture/repository-layout` §5): owned files with a
 * version header, and one marked block in a shared instruction file. Text outside the markers is never read for
 * changes or rewritten; an unbalanced block, a symlinked target or a failed check stops setup before anything changes.
 */

export interface OwnedFile { path: string; content: string }
export interface BlockTarget { file: string; text: string }
export interface InstallPlan { harness: string; owned: OwnedFile[]; block?: BlockTarget }
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
    "If the project has no Specplane configuration, do not apply Specplane rules.",
    "",
    `Steering stamp: ${stamp}`,
  ].join("\n");
}

function beginMarker(version: string): string {
  return `${BEGIN_PREFIX}v${version} — managed by \`specplane init\`; edits inside this block are overwritten -->`;
}

/** The files one named harness needs. Host-specific content beyond the standing text arrives with its integration unit. */
export function planFor(root: string, harness: string): InstallPlan {
  const stamp = steeringStamp(steeringInputs(root));
  const text = standingText(stamp);
  if (harness === "claude") return { harness, owned: [{ path: ".claude/rules/specplane.md", content: `${text}\n` }] };
  if (harness === "codex") return { harness, owned: [], block: { file: "AGENTS.md", text } };
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
function splitHeader(text: string): { header: RegExpMatchArray | null; body: string; shebang: string } {
  const lines = text.split("\n");
  const shebang = lines[0]?.startsWith("#!") ? `${lines.shift()}\n` : "";
  const m = lines[0]?.match(HEADER) ?? null;
  if (m) lines.shift();
  return { header: m, body: lines.join("\n"), shebang };
}

function withHeader(file: string, content: string, version: string): string {
  const stamp = content.match(/Steering stamp: ([0-9a-f]{64})/)?.[1] ?? null;
  const split = splitHeader(content);
  const header = headerFor(file, split.body, version, stamp);
  return header ? `${split.shebang}${header}\n${split.body}` : content;
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

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, content, { flag: "wx" }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

interface Pending { rel: string; content: string; kind: "owned" | "block" }

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
    if (!fs.existsSync(abs)) { pending.push({ rel: f.path, content: next, kind: "owned" }); continue; }
    const current = fs.readFileSync(abs, "utf8");
    const { header, body } = splitHeader(current);
    if (current === next) report.unchanged.push(f.path);
    else if (!header || (header[3] && header[3] !== sha(body))) {
      report.kept.push(f.path);
      report.lines.push(`Kept ${f.path}: ${header ? "it was edited after Specplane wrote it" : "it was not written by Specplane"}. Remove it and run init again to replace it.`);
    } else pending.push({ rel: f.path, content: next, kind: "owned" });
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

  for (const p of pending) { atomicWrite(path.join(root, p.rel), p.content); report.written.push(p.rel); }
  const files = [...plan.owned.map((f) => f.path), ...(plan.block && report.written.concat(report.unchanged).includes(plan.block.file) ? [plan.block.file] : [])];
  const record = readStoreJson<Record<string, string[]>>(root, RECORD) ?? {};
  writeStoreJson(root, RECORD, { ...record, [harness]: files.filter((f) => !report.kept.includes(f)) });
  return report;
}

/** Findings for validation (`harness` family): missing installed files, an older version, a stamp mismatch, marker problems. */
export function inspectInstallation(root: string): HarnessFinding[] {
  const out: HarnessFinding[] = [];
  const version = specplaneVersion();
  let stamp: string | null = null;
  try { stamp = steeringStamp(steeringInputs(root)); } catch { /* A failed generation is reported by the steering warnings. */ }
  const seen = (file: string, writtenVersion: string, writtenStamp: string | null): void => {
    if (writtenVersion !== version) out.push({ severity: "warning", file, message: `${file} was written by Specplane ${writtenVersion}, not the installed ${version}; run \`specplane init --harness <name>\` again` });
    else if (stamp && writtenStamp !== stamp) out.push({ severity: "warning", file, message: `${file} has a steering stamp that differs from the current steering; run \`specplane init --harness <name>\` again` });
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
  return out;
}
