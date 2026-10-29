import * as fs from "node:fs";
import * as path from "node:path";
import { FrontmatterError, FrontmatterMissingError, SpecplaneError } from "../errors.js";
import { finding, makeReport } from "../report.js";
import { resolveSpecId } from "../spec/resolve.js";
import type { Config, Finding, ValidationReport } from "../types.js";
import { parseAdr } from "./parse.js";
import type { AdrRecord } from "./parse.js";

/** Load ADRs, turning unparseable files into findings (unlike `listAdrs`, which throws). */
export function loadAdrs(config: Config, root: string): { adrs: AdrRecord[]; findings: Finding[]; files: string[] } {
  const dir = path.join(root, config.decisions.dir);
  const adrs: AdrRecord[] = [];
  const findings: Finding[] = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort() : [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      adrs.push({ file, number: f.slice(0, 4), ...parseAdr(file) });
    } catch (e) {
      if (!(e instanceof FrontmatterError || e instanceof FrontmatterMissingError)) throw e;
      findings.push(finding("error", "schema", path.relative(root, file).split(path.sep).join("/"), e.message, { adr: `decision/${f.slice(0, 4)}` }));
    }
  }
  return { adrs, findings, files };
}

/**
 * Supersession cycles (`architecture/file-formats` §6.2): walk `superseded_by` from each ADR in
 * number order, mark visited ADRs, and report each cycle once, rotated to start at its
 * lowest-numbered ADR.
 */
function findCycles(adrs: AdrRecord[]): { cycle: string[]; file: string }[] {
  const byId = new Map<string, AdrRecord>();
  for (const a of adrs) byId.set(`decision/${a.number}`, a);
  const visited = new Set<string>();
  const reported = new Set<string>();
  const out: { cycle: string[]; file: string }[] = [];
  const ordered = [...adrs].sort((a, b) => a.number.localeCompare(b.number));
  for (const start of ordered) {
    if (visited.has(`decision/${start.number}`)) continue;
    const chain: string[] = [];
    const index = new Map<string, number>();
    let cur: AdrRecord | undefined = start;
    while (cur) {
      const id = `decision/${cur.number}`;
      if (index.has(id)) {
        const cycle = chain.slice(index.get(id)!);
        const min = cycle.reduce((m, c) => (c < m ? c : m));
        const at = cycle.indexOf(min);
        const rotated = [...cycle.slice(at), ...cycle.slice(0, at), min];
        const key = rotated.join(" -> ");
        if (!reported.has(key)) {
          reported.add(key);
          out.push({ cycle: rotated, file: byId.get(min)!.file });
        }
        break;
      }
      if (visited.has(id)) break;
      index.set(id, chain.length);
      chain.push(id);
      visited.add(id);
      const sup: string = cur.frontmatter.superseded_by ?? "";
      cur = /^decision\/\d{4}$/.test(sup) ? byId.get(sup) : undefined;
    }
  }
  return out;
}

/** `architecture/file-formats` §6.2, with the message texts of `feature/decisions`. */
export function validateAdrs(adrs: AdrRecord[], config: Config, root: string, extra: Finding[] = []): ValidationReport {
  const out: Finding[] = [...extra];
  const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const byNumber = new Map<string, AdrRecord[]>();
  for (const a of adrs) byNumber.set(a.number, [...(byNumber.get(a.number) ?? []), a]);

  for (const a of adrs) {
    const id = `decision/${a.number}`;
    const at = (severity: "error" | "warning", message: string) =>
      out.push(finding(severity, "adr", rel(a.file), message, { adr: id }));
    const fm = a.frontmatter;
    if (fm.id !== id) {
      at(
        "error",
        `ADR file \`${path.basename(a.file)}\` has id \`${fm.id}\`; the id number must match the filename.`,
      );
    }
    const dups = byNumber.get(a.number)!;
    if (dups.length > 1 && dups[0] === a) {
      const names = dups.map((d) => path.basename(d.file)).join("`, `");
      at("error", `Duplicate ADR number \`${a.number}\`: \`${names}\`. Renumber the later one.`);
    }
    const sup = fm.superseded_by ?? "";
    if (fm.status === "superseded" && sup === "") {
      at("error", `ADR \`${id}\` is superseded but has no \`superseded_by\`.`);
    } else if (sup !== "" && fm.status !== "superseded") {
      at("warning", `ADR \`${id}\` has \`superseded_by\` but status \`${fm.status}\`.`);
    }
    if (sup !== "") {
      const m = /^decision\/(\d{4})$/.exec(sup);
      if (!m || !byNumber.has(m[1])) at("error", `ADR \`${id}\` is superseded by unknown ADR \`${sup}\`.`);
    }
    for (const ref of fm.related_specs ?? []) {
      try {
        resolveSpecId(ref, config, undefined, root);
      } catch (e) {
        if (!(e instanceof SpecplaneError)) throw e;
        at("warning", `ADR \`${id}\` references unknown spec \`${ref}\`.`);
      }
    }
  }

  for (const { cycle, file } of findCycles(adrs)) {
    out.push(
      finding("error", "adr", rel(file), `Supersession cycle: ${cycle.map((c) => `\`${c}\``).join(" -> ")}.`, {
        adr: cycle[0],
      }),
    );
  }

  return makeReport(out, adrs.map((a) => `decision/${a.number}`));
}
