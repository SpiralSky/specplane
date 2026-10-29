import * as fs from "node:fs";
import * as path from "node:path";
import { FrontmatterError } from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
import { ADR_SCHEMA, describeErrors, validator } from "../schemas.js";
import type { AdrFrontmatter, Config } from "../types.js";

export interface AdrRecord {
  file: string;
  /** Four-digit filename prefix. */
  number: string;
  frontmatter: AdrFrontmatter;
  body: string;
}

export function parseAdr(file: string): { frontmatter: AdrFrontmatter; body: string } {
  const { data, body } = readFrontmatter(file);
  const v = validator(ADR_SCHEMA);
  if (!v(data)) throw new FrontmatterError(file, describeErrors(v.errors));
  return { frontmatter: data as unknown as AdrFrontmatter, body };
}

/** Every `<decisions.dir>/NNNN-*.md`, sorted by file name. An absent directory means no ADRs. */
export function listAdrs(config: Config, root: string): AdrRecord[] {
  const dir = path.join(root, config.decisions.dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .map((f) => ({ file: path.join(dir, f), number: f.slice(0, 4), ...parseAdr(path.join(dir, f)) }));
}
