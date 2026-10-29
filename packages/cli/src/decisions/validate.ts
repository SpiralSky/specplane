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

/** `architecture/file-formats` §6.2. */
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
    if (fm.id !== id) at("error", `ID \`${fm.id}\` does not match path-derived ID \`${id}\`.`);
    const dups = byNumber.get(a.number)!;
    if (dups.length > 1 && dups[0] === a) {
      const names = dups.map((d) => path.basename(d.file)).join("`, `");
      at("error", `Duplicate ADR number \`${a.number}\`: \`${names}\`. Renumber the later one.`);
    }
    const sup = fm.superseded_by ?? "";
    if (fm.status === "superseded" && sup === "") at("error", "`status: superseded` requires a non-empty `superseded_by`.");
    else if (sup !== "" && fm.status !== "superseded") at("error", "A non-empty `superseded_by` requires `status: superseded`.");
    if (sup !== "") {
      const m = /^decision\/(\d{4})$/.exec(sup);
      if (!m || !byNumber.has(m[1])) at("error", `\`superseded_by\` \`${sup}\` does not resolve to an existing ADR.`);
    }
    for (const ref of fm.related_specs ?? []) {
      try {
        resolveSpecId(ref, config, undefined, root);
      } catch (e) {
        if (!(e instanceof SpecplaneError)) throw e;
        at("warning", `\`related_specs\` entry \`${ref}\` does not resolve: ${e.message}`);
      }
    }
  }
  return makeReport(out, adrs.map((a) => `decision/${a.number}`));
}
