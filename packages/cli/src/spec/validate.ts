import * as fs from "node:fs";
import { assessFile } from "./completion.js";
import * as path from "node:path";
import { FrontmatterError, FrontmatterMissingError, SpecplaneError } from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
import { ID_PATTERN } from "../schemas.js";
import { finding, makeReport } from "../report.js";
import type { Config, Finding, SpecFrontmatter, SpecRootConfig, ValidationReport } from "../types.js";
import { checkArchitectureLeak } from "./leak-guard.js";
import { checkOverlayContradictions } from "./overlay-check.js";
import { isInfoFile, parseSpec } from "./parse.js";
import { resolveSpecId } from "./resolve.js";
import { checkPins } from "./pins.js";
import { hasAnchor, headingSlugs } from "./slug.js";

export interface LoadedSpec {
  /** Absolute path. */
  file: string;
  /** Path relative to the repository root, with forward slashes. */
  rel: string;
  root: SpecRootConfig;
  /** Path-derived ID (`<type>/<slug>`). */
  id: string;
  frontmatter: SpecFrontmatter;
  body: string;
  /** Lines of frontmatter before the body, to map body lines to file lines. */
  lineOffset: number;
}

const TYPE_DIRS: Record<string, string> = { feature: "features", architecture: "architecture" };

const relPath = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : []));
}

function pathDerivedId(rootDir: string, type: string, file: string): string {
  const inside = path.relative(path.join(rootDir, TYPE_DIRS[type]), file).split(path.sep).join("/");
  return `${type}/${inside.replace(/\.md$/, "")}`;
}

/** Parse every spec file of every root; unparseable files become findings. */
export function loadSpecs(config: Config, repoRoot: string): { specs: LoadedSpec[]; findings: Finding[]; checked: string[] } {
  const specs: LoadedSpec[] = [];
  const findings: Finding[] = [];
  const checked: string[] = [];
  for (const root of config.spec_roots) {
    const rootDir = path.join(repoRoot, root.path);
    for (const type of Object.keys(TYPE_DIRS)) {
      for (const file of walk(path.join(rootDir, TYPE_DIRS[type]))) {
        const rel = relPath(repoRoot, file);
        const id = pathDerivedId(rootDir, type, file);
        const isTopInfo = isInfoFile(file) && path.dirname(file) === path.join(rootDir, TYPE_DIRS[type]);
        if (isTopInfo) {
          if (/^﻿?---[ \t]*\r?\n/.test(fs.readFileSync(file, "utf8"))) {
            findings.push(finding("error", "schema", rel, `\`${rel}\` has frontmatter. \`INFO.md\` is not a spec; rename the file if it is meant to be one.`));
          }
          continue;
        }
        checked.push(id);
        try {
          const { frontmatter, body } = parseSpec(file);
          const raw = fs.readFileSync(file, "utf8");
          const at = body === "" ? -1 : raw.lastIndexOf(body);
          const lineOffset = at <= 0 ? 0 : raw.slice(0, at).split("\n").length - 1;
          specs.push({ file, rel, root, id, frontmatter, body, lineOffset });
        } catch (e) {
          if (e instanceof FrontmatterError || e instanceof FrontmatterMissingError) {
            findings.push(finding("error", "schema", rel, e.message, { spec: id }));
          } else throw e;
        }
      }
    }
  }
  return { specs, findings, checked };
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Parse the frontmatter status of a spec file without full validation. */
function statusOf(file: string): string | undefined {
  try {
    return readFrontmatter(file).data.status as string | undefined;
  } catch {
    return undefined;
  }
}

const ANCHOR_REF = new RegExp(`(?<![\\w/:#-])(?:[a-z][a-z0-9-]*:)?${ID_PATTERN.slice(1, -1).replace("(feature|", "(?:feature|")}#([a-z0-9_-]+)`, "g");

/** Warn for `<id>#<slug>` references in the body whose slug matches no heading of the target. */
export function checkBodyAnchors(spec: LoadedSpec, config: Config, repoRoot: string): Finding[] {
  const out: Finding[] = [];
  const cache = new Map<string, string[] | null>();
  let fence: string | null = null;
  spec.body.split(/\r?\n/).forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    for (const m of line.matchAll(ANCHOR_REF)) {
      const ref = m[0].slice(0, m[0].indexOf("#"));
      const slug = m[1].replace(/-+$/, "");
      let slugs: string[] | null | undefined = cache.get(ref);
      if (slugs === undefined) {
        try {
          const t = resolveSpecId(ref, config, spec.root.name, repoRoot);
          slugs = headingSlugs(readFrontmatter(t.path).body);
        } catch {
          slugs = null; // unresolvable references are not anchor findings
        }
        cache.set(ref, slugs);
      }
      if (slugs && !slugs.includes(slug)) {
        out.push(finding("warning", "anchor", spec.rel, `\`${ref}#${slug}\` does not match a heading in \`${ref}\`.`, { spec: spec.id, line: i + 1 + spec.lineOffset }));
      }
    }
  });
  return out;
}

/** Checks 1-9 of `architecture/reference-cli` § Spec validation for one spec. */
export function validateSpec(spec: LoadedSpec, config: Config, repoRoot: string): ValidationReport {
  const out: Finding[] = [];
  const fm = spec.frontmatter;
  const at = (severity: "error" | "warning", type: Finding["type"], message: string): void => {
    out.push(finding(severity, type, spec.rel, message, { spec: spec.id }));
  };
  const resolve = (id: string, fromRoot: string) => {
    try {
      return resolveSpecId(id, config, fromRoot, repoRoot);
    } catch (e) {
      if (e instanceof SpecplaneError) return e;
      throw e;
    }
  };
  const checkAnchor = (ref: string, file: string) => {
    const hash = ref.indexOf("#");
    if (hash === -1) return;
    const slug = ref.slice(hash + 1);
    try {
      if (!hasAnchor(readFrontmatter(file).body, slug)) {
        at("warning", "anchor", `\`${ref.slice(0, hash)}#${slug}\` does not match a heading in \`${ref.slice(0, hash)}\`.`);
      }
    } catch {
      /* unreadable target is reported by its own validation */
    }
  };

  const checkDeprecated = (ref: string, file: string) => {
    try {
      if (readFrontmatter(file).data.status === "deprecated") {
        at("warning", "reference", `\`${fm.id}\` references deprecated spec \`${ref.split("#")[0]}\`.`);
      }
    } catch {
      /* unreadable target is reported by its own validation */
    }
  };

  // 1. ID matches path-derived ID.
  if (fm.id !== spec.id) at("error", "id", `ID \`${fm.id}\` does not match path-derived ID \`${spec.id}\`.`);

  // 2. allow_architecture needs a reason (the parser enforces it; reported here when it was bypassed).
  if (fm.allow_architecture === true && !(fm.architecture_reason ?? "").trim()) {
    at("error", "schema", "`architecture_reason` must be non-empty when `allow_architecture` is true.");
  }

  // 3. implements resolve.
  if (fm.id.startsWith("architecture/")) {
    for (const ref of fm.implements ?? []) {
      const r = resolve(ref, spec.root.name);
      if (r instanceof Error) at("error", "reference", `\`implements\` entry \`${ref}\` does not resolve: ${r.message}`);
      else {
        checkAnchor(ref, r.path);
        checkDeprecated(ref, r.path);
      }
    }
  }

  // 4. supersedes resolve.
  for (const ref of fm.supersedes ?? []) {
    const r = resolve(ref, spec.root.name);
    if (r instanceof Error) at("error", "reference", `\`supersedes\` entry \`${ref}\` does not resolve: ${r.message}`);
    else checkAnchor(ref, r.path);
  }

  // 5 + 8. extends: root must itself extend; target resolves within the extends chain.
  for (const ref of asList(fm.extends)) {
    if (spec.root.extends === undefined) {
      at("error", "reference", `\`extends\` entry \`${ref}\` is not allowed: root \`${spec.root.name}\` is standalone (it has no \`extends\`).`);
      continue;
    }
    const r = resolve(ref, spec.root.extends);
    if (r instanceof Error) at("error", "reference", `\`extends\` entry \`${ref}\` does not resolve in the extends chain of root \`${spec.root.name}\`: ${r.message}`);
    else {
      checkAnchor(ref, r.path);
      checkDeprecated(ref, r.path);
    }
  }

  // 6. Shadowing.
  const roots = new Map(config.spec_roots.map((r) => [r.name, r]));
  const seen = new Set<string>([spec.root.name]);
  for (let r = spec.root.extends ? roots.get(spec.root.extends) : undefined; r && !seen.has(r.name); r = r.extends ? roots.get(r.extends) : undefined) {
    seen.add(r.name);
    const [type, ...rest] = spec.id.split("/");
    if (fs.existsSync(path.join(repoRoot, r.path, TYPE_DIRS[type], `${rest.join("/")}.md`))) {
      at("error", "id", `\`${spec.id}\` in root \`${spec.root.name}\` shadows the spec of the same ID in root \`${r.name}\`; overlay specs must have their own ID.`);
    }
  }

  // 7. Authorship consistency.
  const type = spec.id.startsWith("feature/") ? "feature" : "architecture";
  if (config.specs[type].authorship === "user" && fm.author === "llm" && (fm.status === "review" || fm.status === "approved")) {
    at("warning", "authorship", `\`${spec.id}\` is \`author: llm\` but \`specs.${type}.authorship\` is \`user\`; a human must take over (set \`author: mixed\` or \`user\`) before the spec leaves \`draft\`.`);
  }

  // 8 (cont.). Pins: invalid keys, stale and missing pins, approval guard.
  out.push(...checkPins(spec, config, repoRoot));

  // 9 (cont.). `<id>#<slug>` references in the body.
  out.push(...checkBodyAnchors(spec, config, repoRoot));
  return makeReport(out);
}

/** Validate every spec in every root, then the cross-spec policies. */
export function validateSpecs(config: Config, root: string): ValidationReport {
  const { specs, findings, checked } = loadSpecs(config, root);
  const out: Finding[] = [...findings];
  const byFile = new Map(specs.map((s) => [s.file, s]));
  const implementations: NonNullable<ValidationReport["implementations"]> = [];

  for (const s of specs) {
    const r = validateSpec(s, config, root);
    out.push(...r.errors, ...r.warnings);
    const assessment = assessFile(s.id, s.root.name, s.file, config, root);
    implementations.push({ id: s.id, root: s.root.name, path: s.rel, ...assessment });
    if (assessment.assessment_status === "reassessment_needed" || assessment.assessment_status === "unverifiable") {
      out.push(finding("warning", assessment.assessment_status === "unverifiable" ? "implementation-unverifiable" : "implementation-reassessment", s.rel, `Implementation assessment ${assessment.assessment_status}: ${assessment.assessment_reasons.map(reason => reason.message).join(" ")}`, { spec: s.id }));
    }
  }

  // Ordering policy.
  if (config.specs.architecture.require_approved_features) {
    for (const s of specs) {
      if (!s.id.startsWith("architecture/") || s.frontmatter.status !== "approved") continue;
      for (const ref of s.frontmatter.implements ?? []) {
        try {
          const target = resolveSpecId(ref, config, s.root.name, root);
          const status = byFile.get(target.path)?.frontmatter.status ?? statusOf(target.path);
          if (status !== undefined && status !== "approved") {
            out.push(finding("error", "ordering", s.rel, `Cannot approve \`${s.id}\`: \`${target.id}\` is \`${status}\`, not \`approved\`.`, { spec: s.id }));
          }
        } catch {
          /* unresolved references are reported by validateSpec */
        }
      }
    }
  }

  // Leak guard.
  if (config.specs.feature.forbid_architecture) {
    for (const s of specs) {
      if (!s.id.startsWith("feature/") || s.frontmatter.allow_architecture === true) continue;
      for (const w of checkArchitectureLeak(s.body, config.specs.feature.leak_guard_allow)) {
        out.push(finding("warning", w.type, s.rel, w.message, { spec: s.id, line: w.line + s.lineOffset }));
      }
    }
  }

  // Overlay contradiction heuristics.
  for (const s of specs) {
    for (const ref of asList(s.frontmatter.extends)) {
      if (s.root.extends === undefined) continue;
      let base: LoadedSpec | undefined;
      try {
        base = byFile.get(resolveSpecId(ref, config, s.root.extends, root).path);
      } catch {
        continue;
      }
      if (!base) continue;
      for (const m of checkOverlayContradictions(s.body, base.body)) {
        const clip = (t: string) => (t.length > 80 ? t.slice(0, 77) + "..." : t);
        const [ov, bs] = m.inOverlay ? [m.negative, m.other] : [m.other, m.negative];
        out.push(
          finding("warning", "overlay", s.rel, `\`${s.id}\` may contradict \`${base.id}\`: "${clip(ov.text)}" (overlay) vs "${clip(bs.text)}" (base).`, {
            spec: s.id,
            line: ov.line + s.lineOffset,
          }),
        );
      }
    }
  }
  const report = makeReport(out, checked);
  report.implementations = implementations.sort((a, b) => a.id.localeCompare(b.id) || a.root.localeCompare(b.root));
  return report;
}
