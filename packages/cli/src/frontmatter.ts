import * as fs from "node:fs";
import matter from "gray-matter";
import * as yaml from "js-yaml";
import { FrontmatterError, FrontmatterMissingError } from "./errors.js";

/** YAML engine that keeps dates as strings (JSON-compatible scalars only). */
const engines = {
  yaml: {
    parse: (s: string) => yaml.load(s, { schema: yaml.JSON_SCHEMA }) as object,
    stringify: (o: object) => yaml.dump(o),
  },
};

/** Split a markdown file into raw frontmatter data and body. */
export function readFrontmatter(filePath: string): { data: Record<string, unknown>; body: string } {
  const content = fs.readFileSync(filePath, "utf8");
  if (!/^﻿?---[ \t]*\r?\n/.test(content)) throw new FrontmatterMissingError(filePath);
  try {
    const parsed = matter(content, { engines });
    const data = parsed.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("frontmatter is not a mapping");
    }
    return { data: data as Record<string, unknown>, body: parsed.content };
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
