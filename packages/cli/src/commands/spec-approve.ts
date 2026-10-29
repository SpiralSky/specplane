import * as fs from "node:fs";
import * as path from "node:path";
import {
  ApprovalRefusedError,
  SpecNotFoundError,
  SpecStateError,
  UncommittedChangesError,
  reportError,
} from "../errors.js";
import { abbrev, hasUncommittedChanges } from "../git/blobs.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { checkoutRoot } from "../git/repo.js";
import { formatHuman } from "../output/human.js";
import { parseSpec } from "../spec/parse.js";
import { comparePin, displayId, matchKey, refTargets, type RefTarget } from "../spec/pins.js";
import { resolveSpecId } from "../spec/resolve.js";
import { loadSpecs, validateSpec, type LoadedSpec } from "../spec/validate.js";
import type { Config } from "../types.js";
import { load } from "./spec.js";
import { pinSpec } from "./spec-pin.js";

const toPosix = (p: string) => p.split(path.sep).join("/");

/** Rewrite only the frontmatter `status:` line, preserving line endings and every other byte. */
function writeStatus(file: string, status: string): void {
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
  const at = lines.findIndex((l, i) => i > 0 && i < end && /^status\s*:/.test(l));
  if (!/^---[ \t]*$/.test(lines[0] ?? "") || end === -1 || at === -1) {
    throw new Error(`\`${file}\`: no frontmatter status found`);
  }
  lines[at] = `status: ${status}`;
  fs.writeFileSync(file, lines.join(eol));
}

/** Load the resolved spec and every loaded spec, for status and reference lookups. */
function loadOne(rawId: string, config: Config, root: string): { spec: LoadedSpec; specs: LoadedSpec[] } {
  const resolved = resolveSpecId(rawId, config, undefined, root);
  const { specs } = loadSpecs(config, root);
  const spec = specs.find((s) => s.file === resolved.path);
  if (!spec) throw new SpecNotFoundError(rawId);
  return { spec, specs };
}

function statusAt(specs: LoadedSpec[], file: string): string {
  const hit = specs.find((s) => s.file === file);
  return hit ? hit.frontmatter.status : parseSpec(file).frontmatter.status;
}

/** The `based_on` entry for `target`, if the spec has one. */
function pinFor(spec: LoadedSpec, targets: RefTarget[], target: RefTarget, config: Config, root: string): [string, string] | undefined {
  return Object.entries(spec.frontmatter.based_on ?? {}).find(
    ([key]) => matchKey(key, targets, spec, config, root) === target,
  );
}

/** Refuse when a base of an extending overlay is not approved, or a stale pin cannot be refreshed. */
function checkOverlayBases(spec: LoadedSpec, specs: LoadedSpec[], config: Config, root: string, id: string): RefTarget[] {
  const targets = refTargets(spec, config, root).filter((t) => t.kind === "extends");
  for (const target of targets) {
    if (!target.target) continue;
    const baseRel = toPosix(path.relative(root, target.target.path));
    const status = statusAt(specs, target.target.path);
    if (status !== "approved") {
      throw new ApprovalRefusedError(`Cannot approve \`${id}\`: base \`${target.ref}\` is \`${status}\`.`);
    }
    const pin = pinFor(spec, targets, target, config, root);
    if (pin && hasUncommittedChanges(baseRel, root) && comparePin(pin[1], baseRel, root).status === "stale") {
      throw new ApprovalRefusedError(`Cannot approve \`${id}\`: base \`${target.ref}\` changed since it was pinned.`);
    }
  }
  return targets;
}

/** Ordering policy: an architecture spec may not be approved while a spec it implements is not. */
function checkImplemented(spec: LoadedSpec, specs: LoadedSpec[], config: Config, root: string, id: string): void {
  if (!config.specs.architecture.require_approved_features || !spec.id.startsWith("architecture/")) return;
  for (const ref of spec.frontmatter.implements ?? []) {
    let target;
    try {
      target = resolveSpecId(ref, config, spec.root.name, root);
    } catch {
      continue; // unresolved references are reported by validation
    }
    const status = statusAt(specs, target.path);
    if (status !== "approved") {
      throw new ApprovalRefusedError(`Cannot approve \`${id}\`: \`${target.id}\` is \`${status}\`, not \`approved\`.`);
    }
  }
}

/** Commit `file` (and any pins written into it) with the `approve` workflow; returns the short SHA. */
function commitChange(root: string, file: string, summary: string): string {
  const trailers = cliTrailers("approve", "");
  const msg = formatMessage({ type: "docs", scope: "specs", summary, trailers });
  run("git", ["add", "--", file], { cwd: root });
  run("git", ["commit", "-F", "-", "--", file], { cwd: root, input: msg });
  return abbrev(run("git", ["rev-parse", "HEAD"], { cwd: root }).trim(), root);
}

function approveOne(rawId: string, config: Config, root: string, dryRun: boolean): boolean {
  const { spec, specs } = loadOne(rawId, config, root);
  const id = displayId(spec);
  const status = spec.frontmatter.status;
  if (status !== "draft" && status !== "review") {
    throw new SpecStateError(`Spec \`${id}\` is \`${status}\`; only \`draft\` or \`review\` specs can be approved.`);
  }
  if (hasUncommittedChanges(spec.rel, root)) throw new UncommittedChangesError(spec.rel);

  checkImplemented(spec, specs, config, root, id);
  // An "extending overlay" is a spec with frontmatter `extends`; a spec in an overlay root
  // that only implements base specs is not one (`feature/tooling` § `specplane spec approve`).
  const isOverlay = spec.frontmatter.extends !== undefined;
  const targets = isOverlay ? checkOverlayBases(spec, specs, config, root, id) : [];

  const subject = `approve ${id}`;
  if (dryRun) {
    process.stdout.write(`would approve ${id}\n`);
    for (const target of targets) process.stdout.write(`would re-pin base ${target.ref}\n`);
    process.stdout.write(`would commit docs(specs): ${subject}\n`);
    return true;
  }

  const original = fs.readFileSync(spec.file, "utf8");
  if (isOverlay) pinSpec(config, root, id, targets.map((t) => t.ref));
  writeStatus(spec.file, "approved");

  const updated = loadSpecs(config, root).specs.find((s) => s.file === spec.file);
  if (updated) {
    const report = validateSpec(updated, config, root);
    if (!report.valid) {
      fs.writeFileSync(spec.file, original);
      process.stderr.write(formatHuman(report));
      process.exitCode = 1;
      return false;
    }
  }

  const sha = commitChange(root, spec.rel, subject);
  process.stdout.write(`approved ${id} ${sha}\n`);
  return true;
}

export function specApproveCommand(ids: string[], opts: { dryRun?: boolean }): void {
  try {
    const root = checkoutRoot();
    const config = load(root);
    for (const id of ids) {
      if (!approveOne(id, config, root, opts.dryRun === true)) return;
    }
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

/** True when `key` (a `based_on` key) resolves to the spec at `targetPath`. */
function keyRefersTo(key: string, spec: LoadedSpec, config: Config, root: string, targetPath: string): boolean {
  for (const from of [spec.root.extends, spec.root.name]) {
    if (from === undefined) continue;
    try {
      if (resolveSpecId(key, config, from, root).path === targetPath) return true;
    } catch {
      /* try the next root */
    }
  }
  return false;
}

/** Direct dependants: approved architecture specs implementing it, and overlays extending/pinning it. */
function dependants(target: LoadedSpec, config: Config, root: string): LoadedSpec[] {
  const { specs } = loadSpecs(config, root);
  const out: LoadedSpec[] = [];
  for (const spec of specs) {
    if (spec.file === target.file) continue;
    const targets = refTargets(spec, config, root);
    const implementsIt =
      spec.id.startsWith("architecture/") &&
      spec.frontmatter.status === "approved" &&
      targets.some((t) => t.kind === "implements" && t.target?.path === target.file);
    const overlayIt =
      targets.some((t) => t.kind === "extends" && t.target?.path === target.file) ||
      Object.keys(spec.frontmatter.based_on ?? {}).some((key) => keyRefersTo(key, spec, config, root, target.file));
    if (implementsIt || overlayIt) out.push(spec);
  }
  return out;
}

function reopenOne(rawId: string, config: Config, root: string, dryRun: boolean): void {
  const { spec } = loadOne(rawId, config, root);
  const id = displayId(spec);
  const status = spec.frontmatter.status;
  if (status !== "approved") throw new SpecStateError(`Spec \`${id}\` is \`${status}\`, not \`approved\`.`);
  if (hasUncommittedChanges(spec.rel, root)) throw new UncommittedChangesError(spec.rel);

  const subject = `reopen ${id}`;
  if (dryRun) {
    process.stdout.write(`would reopen ${id}\n`);
    process.stdout.write(`would commit docs(specs): ${subject}\n`);
    return;
  }

  writeStatus(spec.file, "review");
  const sha = commitChange(root, spec.rel, subject);
  process.stdout.write(`reopened ${id} ${sha}\n`);
  for (const dep of dependants(spec, config, root)) {
    process.stdout.write(`${displayId(dep)} ${dep.frontmatter.status} — reopen with: specplane spec reopen ${displayId(dep)}\n`);
  }
}

export function specReopenCommand(id: string, opts: { dryRun?: boolean }): void {
  try {
    const root = checkoutRoot();
    reopenOne(id, load(root), root, opts.dryRun === true);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
