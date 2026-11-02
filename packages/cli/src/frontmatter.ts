import * as fs from "node:fs";
import * as yaml from "js-yaml";
import { FrontmatterError, FrontmatterMissingError } from "./errors.js";

/** Split a markdown file into raw frontmatter data and body. */
export function readFrontmatter(filePath: string): { data: Record<string, unknown>; body: string } {
  return parseFrontmatter(fs.readFileSync(filePath, "utf8"), filePath);
}

/** Parse a supplied snapshot without accessing the filesystem. */
export function parseFrontmatter(content: string, filePath = "<snapshot>"): { data: Record<string, unknown>; body: string } {
  const start = /^﻿?---[ \t]*(?:\r\n|\n|\r)/.exec(content);
  if (!start) throw new FrontmatterMissingError(filePath);
  try {
    const rest = content.slice(start[0].length);
    const end = /^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(rest);
    if (!end) throw new Error("missing closing frontmatter delimiter");
    // js-yaml normally coerces non-string keys. Inspect nodes before coercion.
    const stack: { children: unknown[] }[] = [];
    const data = yaml.load(rest.slice(0, end.index), { schema: yaml.JSON_SCHEMA, listener: (event, state) => {
      if (event === "open") stack.push({ children: [] });
      else {
        const node = stack.pop()!;
        if (state.kind === "mapping") {
          for (let i = 0; i < node.children.length; i += 2) {
            if (typeof node.children[i] !== "string") throw new Error("mapping keys must be strings");
          }
        }
        stack.at(-1)?.children.push(state.result);
      }
    } });
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("frontmatter is not a mapping");
    }
    const seen = new Set<object>();
    const validate = (value: unknown): void => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number");
      if (value && typeof value === "object") {
        if (seen.has(value)) throw new Error("cyclic YAML value");
        seen.add(value);
        for (const child of Object.values(value)) validate(child);
        seen.delete(value);
      } else if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error("non-JSON value");
    };
    validate(data);
    return { data: data as Record<string, unknown>, body: rest.slice(end.index + end[0].length) };
  } catch (e) {
    throw new FrontmatterError(filePath, `invalid YAML frontmatter: ${(e as Error).message.split("\n")[0]}`);
  }
}

/** Rewrite only the frontmatter `status:` line, preserving line endings and every other byte. */
export function writeStatus(file: string, status: string): void {
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
