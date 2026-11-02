import * as path from "node:path";
import { FrontmatterError } from "../errors.js";
import * as fs from "node:fs";
import { parseFrontmatter } from "../frontmatter.js";
import {
  SPEC_ARCHITECTURE_SCHEMA,
  SPEC_COMMON_SCHEMA,
  SPEC_FEATURE_SCHEMA,
  describeErrors,
  validator,
} from "../schemas.js";
import type { SpecFrontmatter } from "../types.js";

/** `INFO.md` (exact, case-sensitive) is documentation, not a spec. Callers decide by directory. */
export function isInfoFile(filePath: string): boolean {
  return path.basename(filePath) === "INFO.md";
}

export function parseSpec(filePath: string): { frontmatter: SpecFrontmatter; body: string } {
  return parseSpecContent(fs.readFileSync(filePath, "utf8"), filePath);
}

export function parseSpecContent(content: string, filePath = "<snapshot>"): { frontmatter: SpecFrontmatter; body: string } {
  const { data, body } = parseFrontmatter(content, filePath);

  const check = (schema: object) => {
    const v = validator(schema);
    if (!v(data)) throw new FrontmatterError(filePath, describeErrors(v.errors));
  };
  check(SPEC_COMMON_SCHEMA);
  const id = data.id as string;
  if (id.startsWith("feature/")) {
    check(SPEC_FEATURE_SCHEMA);
    const reason = data.architecture_reason;
    if (data.allow_architecture === true && !(typeof reason === "string" && reason.trim() !== "")) {
      throw new FrontmatterError(filePath, "`architecture_reason` must be non-empty when `allow_architecture` is true");
    }
  } else {
    check(SPEC_ARCHITECTURE_SCHEMA);
  }
  return { frontmatter: data as unknown as SpecFrontmatter, body };
}
