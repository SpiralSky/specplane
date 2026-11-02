import { createHash } from "node:crypto";
import { parseFrontmatter } from "../frontmatter.js";
import { QUALIFIED_SPEC_PATTERN } from "../schemas.js";

const excluded = new Set(["status", "author", "contributors", "based_on", "implementation"]);
function compareKeys(a: string, b: string): number {
  const aa = Array.from(a, c => c.codePointAt(0)!);
  const bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareKeys).map(k => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
/** Fingerprint the content of one supplied spec snapshot using spec-v1. */
export function fingerprintSpec(content: string): string {
  const { data, body } = parseFrontmatter(content);
  const retained = Object.fromEntries(Object.entries(data).filter(([key]) => !excluded.has(key)));
  const bytes = canonical({ frontmatter: retained, body: body.replace(/\r\n?/g, "\n") });
  return `spec-v1:sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}
export interface CompletionSpecSnapshot { id: string; content: string }
/** Resolve references within one selected snapshot. Returned IDs must be canonical and root-qualified. */
export interface CompletionSnapshot { resolve(reference: string, fromRoot: string): CompletionSpecSnapshot }
export interface CompletionFingerprints { assessed_spec_hash: string; assessed_dependencies: Record<string, string> }
/** Resolve and fingerprint the transitive dependency closure; resolution failures propagate. */
export function fingerprintClosure(root: CompletionSpecSnapshot, snapshot: CompletionSnapshot): CompletionFingerprints {
  const dependencies: Record<string, string> = Object.create(null);
  const visited = new Set([root.id]);
  const visit = (node: CompletionSpecSnapshot): void => {
    const colon = node.id.indexOf(":");
    if (!new RegExp(QUALIFIED_SPEC_PATTERN).test(node.id)) throw new Error(`Invalid resolved spec identity: ${node.id}`);
    const { data } = parseFrontmatter(node.content);
    const refs = [data.extends, data.implements].flatMap(value => value === undefined ? [] : Array.isArray(value) ? value : [value]);
    for (const ref of refs) {
      if (typeof ref !== "string") throw new Error(`Invalid dependency in ${node.id}`);
      const resolved = snapshot.resolve(ref.split("#", 1)[0], node.id.slice(0, colon));
      if (!new RegExp(QUALIFIED_SPEC_PATTERN).test(resolved.id)) throw new Error(`Invalid resolved spec identity: ${resolved.id}`);
      if (visited.has(resolved.id)) continue;
      visited.add(resolved.id);
      dependencies[resolved.id] = fingerprintSpec(resolved.content);
      visit(resolved);
    }
  };
  visit(root);
  return { assessed_spec_hash: fingerprintSpec(root.content), assessed_dependencies: dependencies };
}
