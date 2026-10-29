import * as fs from "node:fs";
import * as path from "node:path";
import type { AdrRecord } from "../decisions/parse.js";
import { FrontmatterError, FrontmatterMissingError, SpecplaneError } from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
import { finding, makeReport } from "../report.js";
import { findHeading } from "../spec/slug.js";
import { resolveSpecId } from "../spec/resolve.js";
import type { Config, Finding, PlanFrontmatter, ValidationReport } from "../types.js";
import { buildGraph, detectCycle } from "./graph.js";
import { listStepFiles, parsePlan, parseStep } from "./parse.js";
import type { PlanRecord } from "./resolve.js";

/** Sections of a HANDOFF.md: step number -> outcomes in file order. */
export function handoffOutcomes(file: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (!fs.existsSync(file)) return out;
  let step: number | null = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const h = /^## Step (\d+):/.exec(line);
    if (h) {
      step = Number(h[1]);
      out.set(step, [...(out.get(step) ?? []), ""]);
      continue;
    }
    const o = /^\*\*Outcome\*\*:\s*(\S+)/.exec(line);
    if (o && step !== null) {
      const list = out.get(step)!;
      if (list[list.length - 1] === "") list[list.length - 1] = o[1];
    }
  }
  return out;
}

const isParseError = (e: unknown): e is Error => e instanceof FrontmatterError || e instanceof FrontmatterMissingError;

/**
 * Validate plans, steps and their references against the specs on disk (resolved by ID) and the
 * loaded ADRs. `root` is the checkout root.
 */
export function validatePlans(
  plans: PlanRecord[],
  adrs: AdrRecord[],
  config: Config,
  root: string,
): ValidationReport {
  const out: Finding[] = [];
  const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const parsed = new Map<string, PlanFrontmatter>();

  for (const p of plans) {
    try {
      parsed.set(p.id, parsePlan(p.dir).frontmatter);
    } catch (e) {
      if (!isParseError(e)) throw e;
      out.push(finding("error", "schema", rel(p.planFile), e.message, { plan: p.id }));
    }
  }
  const known = new Set(plans.map((p) => p.id));

  for (const p of plans) {
    const fm = parsed.get(p.id);
    if (!fm) continue;
    const at = (severity: "error" | "warning", type: Finding["type"], file: string, message: string) =>
      out.push(finding(severity, type, rel(file), message, { plan: p.id }));

    if ((fm.status === "in_progress" || fm.status === "review") && config.plans.status_source === "git") {
      at("warning", "plan", p.planFile, `Stored status \`${fm.status}\` is ignored while \`plans.status_source\` is \`git\`; status is derived from git state.`);
    }

    for (const dep of fm.depends_on ?? []) {
      if (!known.has(dep)) at("error", "reference", p.planFile, `\`depends_on\` entry \`${dep}\` does not match any plan.`);
      else if (parsed.get(dep)?.status === "abandoned") at("error", "reference", p.planFile, `\`depends_on\` entry \`${dep}\` is an abandoned plan.`);
    }

    for (const ref of fm.specs) {
      try {
        const r = resolveSpecId(ref, config, undefined, root);
        if (readFrontmatter(r.path).data.status === "deprecated") {
          at("warning", "reference", p.planFile, `\`specs\` entry \`${ref}\` is deprecated.`);
        }
      } catch (e) {
        if (!(e instanceof SpecplaneError || isParseError(e))) throw e;
        at("error", "reference", p.planFile, `\`specs\` entry \`${ref}\` does not resolve: ${e.message}`);
      }
    }

    // Steps.
    const handoff = handoffOutcomes(path.join(p.dir, "HANDOFF.md"));
    const numbers = new Map<number, string[]>();
    for (const file of listStepFiles(p.dir)) {
      const prefix = /^(\d+)-/.exec(path.basename(file));
      if (prefix) numbers.set(Number(prefix[1]), [...(numbers.get(Number(prefix[1])) ?? []), path.basename(file)]);
      let step;
      try {
        step = parseStep(file).frontmatter;
      } catch (e) {
        if (!isParseError(e)) throw e;
        at("error", "step", file, e.message);
        continue;
      }
      for (const item of step.context ?? []) {
        if ("spec" in item) {
          const hash = item.spec.indexOf("#");
          const id = hash === -1 ? item.spec : item.spec.slice(0, hash);
          try {
            const r = resolveSpecId(id, config, undefined, root);
            const { data, body } = readFrontmatter(r.path);
            if (data.status === "draft") at("warning", "reference", file, `Context spec \`${id}\` is a draft.`);
            if (hash !== -1 && !findHeading(body, item.spec.slice(hash + 1))) {
              at("warning", "anchor", file, `\`${item.spec}\` does not match a heading in \`${id}\`.`);
            }
          } catch (e) {
            if (!(e instanceof SpecplaneError || isParseError(e))) throw e;
            at("error", "reference", file, `Context spec \`${item.spec}\` does not resolve: ${e.message}`);
          }
        } else if ("decision" in item) {
          const m = /^decision\/(\d{4})$/.exec(item.decision);
          if (!m || !adrs.some((a) => a.number === m[1])) {
            at("error", "reference", file, `Context decision \`${item.decision}\` does not resolve to an ADR.`);
          }
        } else if (!fs.existsSync(path.join(root, item.file))) {
          at("warning", "reference", file, `Context file \`${item.file}\` does not exist (it may not exist yet).`);
        }
      }
      if (step.status === "skipped" || step.status === "blocked") {
        if (!(handoff.get(step.step) ?? []).includes(step.status)) {
          at("error", "step", file, `Step ${step.step} is \`${step.status}\` but HANDOFF.md has no \`## Step ${String(step.step).padStart(2, "0")}\` section with \`**Outcome**: ${step.status}\`.`);
        }
      }
    }
    const max = Math.max(0, ...numbers.keys());
    for (let n = 1; n <= max; n++) {
      if (!numbers.has(n)) at("error", "step", path.join(p.dir, "steps"), `Step numbers must be contiguous from 1: step ${n} is missing.`);
    }
    for (const [n, files] of numbers) {
      if (files.length > 1) at("error", "step", path.join(p.dir, "steps", files[0]), `Duplicate step number ${n}: ${files.join(", ")}.`);
    }
  }

  const cycle = detectCycle(buildGraph([...parsed].map(([id, fm]) => ({ id, depends_on: fm.depends_on }))));
  if (cycle) {
    const first = plans.find((p) => p.id === cycle[0])!;
    out.push(finding("error", "plan", rel(first.planFile), `Dependency cycle: ${cycle.join(" -> ")}.`, { plan: first.id }));
  }
  return makeReport(out, plans.map((p) => p.id));
}
