import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SpecplaneError } from "../errors.js";
import { abbrev, committedBlob, hasUncommittedChanges, readBlob, workingBlob } from "../git/blobs.js";
import { finding } from "../report.js";
import type { Config, Finding } from "../types.js";
import { resolveSpecId, type ResolvedSpec } from "./resolve.js";
import type { LoadedSpec } from "./validate.js";

const toPosix = (p: string) => p.split(path.sep).join("/");

/**
 * Hash of a spec's text with the frontmatter `status:` and `author:` lines removed, so a change
 * that touches only those keys is not a base change.
 */
export function normalisedHash(text: string): string {
  const lines = text.split(/\r?\n/);
  let inFront = false;
  let seenOpen = false;
  const kept = lines.filter((line, i) => {
    if (/^---[ \t]*$/.test(line) && (i === 0 || inFront)) {
      if (i === 0) {
        inFront = true;
        seenOpen = true;
      } else inFront = false;
      return true;
    }
    return !(seenOpen && inFront && /^(status|author)\s*:/.test(line));
  });
  return createHash("sha1").update(kept.join("\n")).digest("hex");
}

export type PinState =
  | { status: "ok"; current: string }
  | { status: "stale"; current: string; diffAvailable: boolean };

/**
 * Compare a pin with the current version of `rel` (repo-relative path). The current version is
 * the committed blob, or the working-tree file when it has uncommitted changes or is untracked.
 */
export function comparePin(pin: string, rel: string, repoRoot: string): PinState {
  const committed = committedBlob(rel, repoRoot);
  const working = committed === null || hasUncommittedChanges(rel, repoRoot);
  const currentFull = working ? workingBlob(rel, repoRoot) : committed!;
  const current = abbrev(currentFull, repoRoot);
  if (currentFull.startsWith(pin.toLowerCase())) return { status: "ok", current };
  const pinned = readBlob(pin, repoRoot);
  if (pinned === null) return { status: "stale", current, diffAvailable: false };
  const now = working ? fs.readFileSync(path.join(repoRoot, rel), "utf8") : readBlob(currentFull, repoRoot);
  if (now !== null && normalisedHash(pinned) === normalisedHash(now)) return { status: "ok", current };
  return { status: "stale", current, diffAvailable: true };
}

export interface RefTarget {
  /** Entry as written, without any `#anchor`. */
  ref: string;
  kind: "extends" | "implements";
  target?: ResolvedSpec;
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** The spec's `extends` and `implements` entries with their resolved targets. */
export function refTargets(spec: LoadedSpec, config: Config, repoRoot: string): RefTarget[] {
  const fm = spec.frontmatter;
  const out: RefTarget[] = [];
  const add = (kind: "extends" | "implements", raw: string, fromRoot: string | undefined) => {
    const ref = raw.split("#")[0];
    let target: ResolvedSpec | undefined;
    if (fromRoot !== undefined) {
      try {
        target = resolveSpecId(ref, config, fromRoot, repoRoot);
      } catch (e) {
        if (!(e instanceof SpecplaneError)) throw e;
      }
    }
    out.push({ ref, kind, target });
  };
  for (const r of asList(fm.extends)) add("extends", r, spec.root.extends);
  for (const r of fm.implements ?? []) add("implements", r, spec.root.name);
  return out;
}

/** ID shown in messages: qualified with the root name for specs in an extending root. */
export const displayId = (spec: LoadedSpec): string =>
  spec.root.extends !== undefined ? `${spec.root.name}:${spec.id}` : spec.id;

/** Find the target a `based_on` key refers to (compared after resolution). */
export function matchKey(key: string, targets: RefTarget[], spec: LoadedSpec, config: Config, repoRoot: string): RefTarget | undefined {
  const exact = targets.find((t) => t.ref === key.split("#")[0]);
  if (exact) return exact;
  for (const from of [spec.root.extends, spec.root.name]) {
    if (from === undefined) continue;
    try {
      const r = resolveSpecId(key, config, from, repoRoot);
      const hit = targets.find((t) => t.target?.path === r.path);
      if (hit) return hit;
    } catch (e) {
      if (!(e instanceof SpecplaneError)) throw e;
    }
  }
  return undefined;
}

/** Stale and missing pins, invalid `based_on` entries, and the approval guard for one spec. */
export function checkPins(spec: LoadedSpec, config: Config, repoRoot: string): Finding[] {
  const out: Finding[] = [];
  const id = displayId(spec);
  const at = (severity: "error" | "warning", type: Finding["type"], message: string) =>
    out.push(finding(severity, type, spec.rel, message, { spec: spec.id }));
  const targets = refTargets(spec, config, repoRoot);
  const pinned = new Set<RefTarget>();
  const stale: string[] = [];

  for (const [key, pin] of Object.entries(spec.frontmatter.based_on ?? {})) {
    if (!/^[0-9a-f]{7,40}$/.test(pin)) {
      at("error", "pin", `Invalid \`based_on\` entry \`${key}\` in \`${id}\`: \`${pin}\` is not a 7-40 character hex string.`);
      continue;
    }
    const hit = matchKey(key, targets, spec, config, repoRoot);
    if (!hit) {
      at("error", "pin", `Invalid \`based_on\` entry \`${key}\` in \`${id}\`: not listed in \`extends\` or \`implements\`.`);
      continue;
    }
    pinned.add(hit);
    if (!hit.target) {
      at("warning", "pin", `\`${id}\` pins \`${key}\`, which does not resolve; update \`extends\`/\`implements\` and re-pin.`);
      continue;
    }
    const state = comparePin(pin, toPosix(path.relative(repoRoot, hit.target.path)), repoRoot);
    if (state.status === "ok") continue;
    stale.push(key);
    const msg = `\`${id}\` was reviewed against an older \`${key}\`; review \`git diff ${pin} ${state.current}\` then run \`specplane spec pin ${id}\`.`;
    at("warning", "base-changed", state.diffAvailable ? msg : `${msg} (diff unavailable: \`${pin}\` is not in the local object store).`);
  }

  if (config.specs.pin_bases !== "off") {
    for (const t of targets) {
      if (pinned.has(t)) continue;
      if (config.specs.pin_bases === "warn" && t.kind !== "extends") continue;
      at(config.specs.pin_bases === "require" ? "error" : "warning", "pin", `\`${id}\` has no \`based_on\` pin for \`${t.ref}\`; run \`specplane spec pin ${id}\`.`);
    }
  }
  out.push(...approveGuard(spec, stale));
  return out;
}

/** An approved spec with a stale pin is an error, whatever `specs.pin_bases` says. */
export function approveGuard(spec: LoadedSpec, staleRefs: string[]): Finding[] {
  if (spec.frontmatter.status !== "approved") return [];
  return staleRefs.map((ref) =>
    finding("error", "base-changed", spec.rel, `Cannot approve \`${displayId(spec)}\`: base \`${ref}\` changed since it was pinned.`, { spec: spec.id }),
  );
}

const quoteKey = (k: string) => (/^[A-Za-z0-9_/.-]+$/.test(k) ? k : JSON.stringify(k));

/**
 * Rewrite only the `based_on` key of the frontmatter of `file`; other text, formatting, and key
 * order are untouched. Inserts the key after `extends`/`implements` (else at the end of the
 * frontmatter) when absent; an empty `pins` removes it.
 */
export function writePins(file: string, pins: Record<string, string>): void {
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
  if (!/^---[ \t]*$/.test(lines[0] ?? "") || end === -1) throw new Error(`\`${file}\`: no frontmatter block found`);
  /** Index just past the top-level key block starting at `i`. */
  const blockEnd = (i: number) => {
    let j = i + 1;
    while (j < end && /^(\s|$)/.test(lines[j])) j++;
    return j;
  };
  const keyAt = (k: string) => lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${k}\\s*:`).test(l));
  const entries = Object.entries(pins);
  const newLine = entries.length ? `based_on: { ${entries.map(([k, v]) => `${quoteKey(k)}: "${v}"`).join(", ")} }` : null;

  const existing = keyAt("based_on");
  if (existing !== -1) {
    lines.splice(existing, blockEnd(existing) - existing, ...(newLine ? [newLine] : []));
  } else if (newLine) {
    const after = Math.max(...["extends", "implements"].map(keyAt).map((i) => (i === -1 ? -1 : blockEnd(i))));
    lines.splice(after === -1 ? end : after, 0, newLine);
  }
  fs.writeFileSync(file, lines.join(eol));
}
