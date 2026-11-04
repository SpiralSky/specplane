import { createHash } from "node:crypto";
import * as path from "node:path";
import { STANDING_VERSION } from "../agents/standing.js";
import type { InstallTransaction } from "./containment.transaction.js";

/**
 * Coexistence and legacy rollout (`architecture/reference-cli` § Explicit upgrade transaction). The installed manifest
 * records only what the installer observed on disk; it never claims a host loaded or enabled anything.
 */

export const INSTALLED_MANIFEST_DIR = ".specplane/installed";
export const installedManifestPath = (harness: string): string => `${INSTALLED_MANIFEST_DIR}/${harness}.json`;

/** What the installer saw for one owned file. `installed` covers created, updated and already-current bytes. */
export interface ObservedFile {
  /** Repo-relative POSIX path. */
  path: string;
  outcome: "installed" | "customized";
  /** SHA-256 of the bytes that will be (or already are) on disk after the transaction. */
  sha256: string;
  /** Public command this file provides, when it is a public prompt skill. */
  command?: string;
}

export interface ReplacementEvidence {
  /** True only when the replacement handler or reasoning asset was observed loadable by the host. */
  usable: boolean;
  /** Where that was observed (host version, probe name); required when `usable`. */
  source?: string;
}

export type LegacyAction = "keep" | "retire" | "preserve";
export interface LegacyDecision { path: string; command?: string; action: LegacyAction; reason: string }

export interface Collision { path: string; command?: string; action: string }

export const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Decide the fate of one legacy public skill. A skill is retired only when it is an unmodified owned file and the
 * replacement has been observed usable; a customized file is always preserved as a collision.
 */
export function decideLegacy(file: ObservedFile, replacement: ReplacementEvidence | undefined): LegacyDecision {
  const base = { path: file.path, ...(file.command ? { command: file.command } : {}) };
  if (file.outcome === "customized") return { ...base, action: "preserve", reason: "customized or unrecognized file; never renamed, overwritten or deleted" };
  if (!replacement?.usable || !replacement.source) return { ...base, action: "keep", reason: "no observed evidence that the replacement is usable; the public skill stays available" };
  return { ...base, action: "retire", reason: `replacement observed usable (${replacement.source})` };
}

/** The exact action for a collision; the affected command stays unavailable until it is taken. */
export function collisionFor(file: ObservedFile, harness: string): Collision {
  return {
    path: file.path,
    ...(file.command ? { command: file.command } : {}),
    action: `Compare \`${file.path}\` with the bundled ${harness} template, merge or move it aside, then rerun \`specplane init --harness ${harness}\`.`,
  };
}

export function collisionLine(c: Collision): string {
  return `Collision ${c.path}: ${c.command ? `\`${c.command}\` stays unavailable. ` : ""}${c.action}`;
}

export interface InstalledManifest {
  schema: 1;
  harness: string;
  standing: string;
  /** Evidence only: the installer observed these files; the host was not asked. */
  state: { installed: true; enabled: "unobserved" };
  files: { path: string; sha256: string; outcome: ObservedFile["outcome"] }[];
  collisions: Collision[];
  legacy: LegacyDecision[];
}

export function buildInstalledManifest(harness: string, files: ObservedFile[], replacement?: ReplacementEvidence): InstalledManifest {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema: 1,
    harness,
    standing: STANDING_VERSION,
    state: { installed: true, enabled: "unobserved" },
    files: sorted.map(({ path: p, sha256: d, outcome }) => ({ path: p, sha256: d, outcome })),
    collisions: sorted.filter((f) => f.outcome === "customized").map((f) => collisionFor(f, harness)),
    legacy: sorted.filter((f) => f.command).map((f) => decideLegacy(f, replacement)),
  };
}

/** Stage the installed manifest. Call it after every other file of the harness is staged: the transaction writes in staging order, so the manifest lands last. */
export function stageInstalledManifest(root: string, tx: InstallTransaction, manifest: InstalledManifest): void {
  tx.stage(path.join(root, installedManifestPath(manifest.harness)), JSON.stringify(manifest, null, 2) + "\n", { owned: true });
}
