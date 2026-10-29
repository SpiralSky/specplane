import * as path from "node:path";
import { loadConfig } from "../config.js";
import { SpecNotFoundError, SpecplaneError } from "../errors.js";
import { abbrev, committedBlob, hasUncommittedChanges } from "../git/blobs.js";
import { checkoutRoot } from "../git/repo.js";
import { checkPins, refTargets, writePins } from "../spec/pins.js";
import { resolveSpecId } from "../spec/resolve.js";
import { loadSpecs } from "../spec/validate.js";
import type { Config, Finding } from "../types.js";

const toPosix = (p: string) => p.split(path.sep).join("/");

/** `spec pin --check`: pin findings only; stale pins and missing pins under `require` fail. */
export function checkAllPins(config: Config, root: string): { findings: Finding[]; failed: boolean } {
  const { specs } = loadSpecs(config, root);
  const findings = specs.flatMap((s) => checkPins(s, config, root));
  const failed = findings.some(
    (f) => f.severity === "error" || f.type === "base-changed" || (f.type === "pin" && config.specs.pin_bases === "require"),
  );
  return { findings, failed };
}

/** Write pins for `id` (all references, or only `only`); returns the `pinned <ref> <hash>` lines. */
export function pinSpec(config: Config, root: string, id: string, only: string[]): string[] {
  const { specs } = loadSpecs(config, root);
  let target;
  try {
    target = resolveSpecId(id, config, undefined, root);
  } catch (e) {
    if (e instanceof SpecplaneError) throw new SpecNotFoundError(id);
    throw e;
  }
  const spec = specs.find((s) => s.file === target.path);
  if (!spec) throw new SpecNotFoundError(id);
  const targets = refTargets(spec, config, root);

  const chosen = only.length === 0 ? targets : only.map((r) => {
    const key = r.split("#")[0];
    const hit = targets.find((t) => t.ref === key || (t.target && safeResolve(r, config, spec.root, root) === t.target.path));
    if (!hit) throw new SpecplaneError_(`\`${r}\` is not extended or implemented by \`${id}\`.`);
    return hit;
  });

  const pins: Record<string, string> = { ...(spec.frontmatter.based_on ?? {}) };
  const lines: string[] = [];
  for (const t of chosen) {
    if (!t.target) throw new SpecNotFoundError(t.ref);
    const rel = toPosix(path.relative(root, t.target.path));
    if (hasUncommittedChanges(rel, root)) throw new SpecplaneError_(`Commit or stash changes to \`${rel}\` first.`);
    const blob = committedBlob(rel, root);
    if (blob === null) throw new SpecplaneError_(`Commit or stash changes to \`${rel}\` first.`);
    const hash = abbrev(blob, root);
    // Refresh an existing key that refers to the same spec, else add the entry as written.
    const key = Object.keys(pins).find((k) => k === t.ref || safeResolve(k, config, spec.root, root) === t.target!.path) ?? t.ref;
    pins[key] = hash;
    lines.push(`pinned ${t.ref} ${hash}`);
  }
  writePins(spec.file, pins);
  return lines;
}

function safeResolve(ref: string, config: Config, specRoot: { name: string; extends?: string }, root: string): string | undefined {
  for (const from of [specRoot.extends, specRoot.name]) {
    if (from === undefined) continue;
    try {
      return resolveSpecId(ref, config, from, root).path;
    } catch {
      /* try the next root */
    }
  }
  return undefined;
}

class SpecplaneError_ extends SpecplaneError {
  readonly exitCode = 1;
}

export function specPinCommand(id: string | undefined, refs: string[], opts: { check?: boolean }): void {
  try {
    const root = checkoutRoot();
    const { config } = loadConfig(root);
    if (opts.check) {
      const { findings, failed } = checkAllPins(config, root);
      for (const f of findings) process.stdout.write(`${f.severity}: ${f.file}: ${f.message}\n`);
      if (!failed) process.stdout.write("All pins are current.\n");
      process.exitCode = failed ? 1 : 0;
      return;
    }
    if (!id) {
      process.stderr.write("Usage: specplane spec pin <id> [<ref-id>...] | specplane spec pin --check\n");
      process.exitCode = 1;
      return;
    }
    for (const line of pinSpec(config, root, id, refs)) process.stdout.write(`${line}\n`);
  } catch (e) {
    if (e instanceof SpecplaneError) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = e.exitCode;
      return;
    }
    throw e;
  }
}

