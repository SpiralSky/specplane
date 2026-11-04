import * as fs from "node:fs";
import * as path from "node:path";
import { type Harness, Report, skillDirsIn, templatesDir, withInstallTransaction } from "./index.js";
import { assertInstallDestination, InstallationPathError } from "./containment.js";
import type { InstallTransaction } from "./containment.transaction.js";

/** Workflows line for the standing instructions when the Claude harness is installed. */
export const CLAUDE_WORKFLOWS_LINE =
  "`/spec-assist`, `/spec-draft-architecture`, `/plan-create`, `/plan-step`, `/plan-finish`, `/validate`, `/approve`, `/plan-start`, `/decision-new`, `/plan-status`, `/plan-abandon`; without them, follow the contracts in `architecture/agent-skills`.";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

const scriptNames = (group: unknown): string[] => {
  const hooks = isObj(group) && Array.isArray(group.hooks) ? group.hooks : [];
  return hooks.flatMap((h) =>
    isObj(h) && typeof h.command === "string" ? (h.command.match(/[\w.-]+\.sh/g) ?? []) : [],
  );
};

export interface MergeResult {
  /** New settings content, or null when nothing should be written. */
  content: string | null;
  added: number;
  /** Extra report lines (e.g. kept statusLine). */
  notes: string[];
  invalid: boolean;
}

/** Merge the template settings into existing settings text (`architecture/claude-integration` § Settings merge). */
export function mergeSettings(existing: string | null, template: Json): MergeResult {
  if (existing === null) return { content: JSON.stringify(template, null, 2) + "\n", added: 0, notes: [], invalid: false };
  let cur: unknown;
  try {
    cur = JSON.parse(existing);
  } catch {
    return { content: null, added: 0, notes: [], invalid: true };
  }
  if (!isObj(cur)) return { content: null, added: 0, notes: [], invalid: true };
  let added = 0;
  const notes: string[] = [];

  const tHooks = isObj(template.hooks) ? template.hooks : {};
  for (const [event, groups] of Object.entries(tHooks)) {
    if (!Array.isArray(groups)) continue;
    if (cur.hooks !== undefined && !isObj(cur.hooks)) return { content: null, added: 0, notes: [], invalid: true };
    if (isObj(cur.hooks) && cur.hooks[event] !== undefined && !Array.isArray(cur.hooks[event])) {
      return { content: null, added: 0, notes: [], invalid: true };
    }
    const have = ((isObj(cur.hooks) ? (cur.hooks[event] as unknown[] | undefined) : undefined) ?? []).flatMap(scriptCommands);
    for (const group of groups) {
      const names = scriptNames(group);
      if (names.some((n) => have.some((c) => c.includes(n)))) continue;
      if (!isObj(cur.hooks)) cur.hooks = {};
      const hooks = cur.hooks as Json;
      if (!Array.isArray(hooks[event])) hooks[event] = [];
      (hooks[event] as unknown[]).push(group);
      added++;
    }
  }

  const tAllow = isObj(template.permissions) && Array.isArray(template.permissions.allow) ? template.permissions.allow : [];
  if (tAllow.length > 0) {
    if (cur.permissions !== undefined && !isObj(cur.permissions)) return { content: null, added: 0, notes: [], invalid: true };
    const perms = isObj(cur.permissions) ? cur.permissions : {};
    if (perms.allow !== undefined && !Array.isArray(perms.allow)) return { content: null, added: 0, notes: [], invalid: true };
    const allow = (perms.allow as unknown[] | undefined) ?? [];
    let addedAllow = 0;
    for (const entry of tAllow) {
      if (allow.includes(entry)) continue;
      allow.push(entry);
      addedAllow++;
    }
    if (addedAllow > 0) {
      perms.allow = allow;
      cur.permissions = perms;
      added += addedAllow;
    }
  }

  if (template.statusLine !== undefined) {
    if (!("statusLine" in cur)) {
      cur.statusLine = template.statusLine;
      added++;
    } else {
      notes.push("Kept existing statusLine (see specplane-statusline.sh to combine)");
    }
  }
  return { content: added > 0 ? JSON.stringify(cur, null, 2) + "\n" : null, added, notes, invalid: false };
}

function scriptCommands(group: unknown): string[] {
  const hooks = isObj(group) && Array.isArray(group.hooks) ? group.hooks : [];
  return hooks.flatMap((h) => (isObj(h) && typeof h.command === "string" ? [h.command] : []));
}

function installSettings(root: string, tx: InstallTransaction, report: Report, tplDir: string): void {
  const abs = path.join(root, ".claude", "settings.json");
  const template = JSON.parse(fs.readFileSync(path.join(tplDir, "settings.json"), "utf8")) as Json;
  const current = tx.read(abs);
  const res = mergeSettings(current === null ? null : current.toString("utf8"), template);
  if (res.invalid) {
    report.add("Skipped .claude/settings.json (invalid JSON; add the Specplane registration by hand)");
    return;
  }
  for (const n of res.notes) report.add(n);
  if (current === null) {
    tx.stage(abs, res.content!);
    report.created(abs);
  } else if (res.content !== null) {
    tx.stage(abs, res.content);
    report.add(`Updated .claude/settings.json (${res.added} entries added)`);
  } else {
    report.skipped(abs, "already registered");
  }
}

export const claude: Harness = {
  name: "claude",
  detect: (root) => fs.existsSync(path.join(root, ".claude")),
  workflowsLine: CLAUDE_WORKFLOWS_LINE,
  install(root, report) {
    const tplDir = templatesDir("claude");
    const files = listFiles(tplDir);
    // Refuse the complete harness before any writes if any destination is unsafe.
    try { for (const rel of files) assertInstallDestination(root, path.join(root, ".claude", rel)); }
    catch (error) {
      if (!(error instanceof InstallationPathError)) throw error;
      report.add(`Skipped Claude integration (${error.message}; no harness files written)`);
      return;
    }
    withInstallTransaction(root, report, (tx) => {
      for (const rel of files) {
        if (rel === "settings.json") continue;
        const dest = path.join(root, ".claude", rel);
        const src = fs.readFileSync(path.join(tplDir, rel));
        const exec = rel.startsWith("hooks/") && rel.endsWith(".sh");
        switch (tx.classify(dest, src)) {
          case "absent":
            tx.stage(dest, src, { owned: true, ...(exec ? { mode: 0o755 } : {}) });
            report.created(dest);
            break;
          case "owned-stale":
            tx.stage(dest, src, { owned: true, ...(exec ? { mode: 0o755 } : {}) });
            report.updated(dest);
            break;
          case "customized":
            report.skipped(dest, "customized or unrecognized file preserved; compare with bundled Claude template before updating");
            break;
          default:
            report.skipped(dest, "up to date");
            if (exec) tx.stage(dest, src, { owned: true, mode: 0o755 });
        }
      }
      installSettings(root, tx, report, tplDir);
      report.add("Claude Code integration files written to `.claude/`.");
    });
  },
  skillDirs: (root) => skillDirsIn(root, ".claude/skills"),
  rulesFile: ".claude/rules/specplane.md",
  rulesTemplate: "rules/specplane.md",
};
