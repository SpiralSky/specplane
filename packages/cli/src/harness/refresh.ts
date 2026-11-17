import * as fs from "node:fs";
import * as path from "node:path";
import { loadSettings } from "../config.js";
import { applyOsSafeguards } from "../perm/strict-os.js";
import { strictMeasureOn } from "../perm/strict.js";
import {
  atomicWrite, beginMarker, END_MARKER, installedHarnesses, planFor, refuseSymlinks, sha, specplaneVersion, splitBlock, splitHeader, standingText, withHeader,
} from "./install.js";

/**
 * Installed files follow the package (`harness R72`, `architecture/reference-cli` §12.6 "Refresh"). A file Specplane
 * wrote at an older version whose content still matches its recorded hash is rewritten by the render `init` uses, so
 * the result equals `init`; an edited file is never written and is listed. Only the owned files and the managed block of
 * `install.ts` are considered: specs, requirements, configuration, role files and merged settings are never touched.
 */
export interface RefreshResult { refreshed: string[]; edited: string[]; lines: string[] }

export function refreshInstalled(root: string): RefreshResult {
  const result: RefreshResult = { refreshed: [], edited: [], lines: [] };
  const version = specplaneVersion();
  for (const harness of installedHarnesses(root)) {
    let plan;
    try { plan = planFor(root, harness); } catch { continue; }
    let wrote = false;
    for (const f of plan.owned) {
      try {
        refuseSymlinks(root, f.path);
        const abs = path.join(root, f.path);
        if (!fs.existsSync(abs)) continue; // A missing file is reported by validation, not recreated.
        const { header, hashed } = splitHeader(fs.readFileSync(abs, "utf8"));
        if (!header || header[1] === version) continue; // Not Specplane's, or current.
        if (!header[3] || header[3] !== sha(hashed)) { result.edited.push(f.path); continue; }
        atomicWrite(abs, withHeader(f.path, f.content, version), f.mode);
        result.refreshed.push(f.path); wrote = true;
      } catch { /* an unreadable or symlinked file is left alone; init reports it */ }
    }
    block: if (plan.block) {
      try {
        if (!loadSettings(root).config.values["harness.install_block"]) break block;
        refuseSymlinks(root, plan.block.file);
        const abs = path.join(root, plan.block.file);
        if (!fs.existsSync(abs)) break block;
        const current = fs.readFileSync(abs, "utf8");
        const parts = splitBlock(plan.block.file, current);
        if (parts.inner === null) break block;
        const [begin, ...rest] = parts.inner.split("\n");
        rest.pop(); // the end marker
        const body = rest.join("\n");
        const writtenVersion = begin.match(/ v(\S+)/)?.[1];
        if (!writtenVersion || writtenVersion === version) break block;
        const recorded = begin.match(/ sha:([0-9a-f]+)/)?.[1];
        // A marker from before hashes existed is refreshable only when its body is the standing text that was written then.
        const untouched = recorded ? recorded === sha(body) : body === standingText(body.match(/Steering stamp: ([0-9a-f]{64})/)?.[1] ?? "");
        if (!untouched) { result.edited.push(plan.block.file); break block; }
        const block = `${beginMarker(version, plan.block.text)}\n${plan.block.text}\n${END_MARKER}`;
        atomicWrite(abs, `${parts.before}${block}${parts.after}`);
        result.refreshed.push(plan.block.file); wrote = true;
      } catch { /* unbalanced markers and the like are reported by validation */ }
    }
    if (wrote && strictMeasureOn(root, "os_permissions")) applyOsSafeguards(root);
  }
  if (result.refreshed.length) result.lines.push(`Specplane refreshed installed files to ${version}: ${result.refreshed.join(", ")}.`);
  if (result.edited.length) result.lines.push(`Not refreshed (edited after Specplane wrote them): ${result.edited.join(", ")}; run \`specplane init --harness <name>\` to replace them.`);
  return result;
}

/** The one short line a harness action adds to its result (`refreshed` names the files); nothing when no file changed. */
export function refreshNote(root: string): { refreshed?: string[]; refreshNote?: string; notRefreshed?: string[] } {
  try {
    const r = refreshInstalled(root);
    return { ...(r.refreshed.length ? { refreshed: r.refreshed, refreshNote: r.lines[0] } : {}), ...(r.edited.length ? { notRefreshed: r.edited } : {}) };
  } catch { return {}; }
}
