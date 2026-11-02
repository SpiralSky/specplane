import { createHash } from "node:crypto";
import { parseFrontmatter } from "../frontmatter.js";
import { QUALIFIED_SPEC_PATTERN, SPEC_COMMON_SCHEMA, validator } from "../schemas.js";
import type { ImplementationDeclaration } from "../types.js";

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

export interface AssessmentReason {
  code: "root_changed" | "dependency_changed" | "dependency_added" | "dependency_removed" | "dependency_unavailable" | "unsupported_version" | "coverage_unrecorded";
  spec: string;
  message: string;
  expected: string | null;
  actual: string | null;
}
export interface ImplementationAssessment {
  implementation_status: ImplementationDeclaration["status"] | null;
  assessment_status: "current" | "reassessment_needed" | "unrecorded" | "unverifiable";
  assessment_reasons: AssessmentReason[];
}

/** Assess supplied content only. Evidence annotations do not verify implementation. */
export function evaluateImplementation(root: CompletionSpecSnapshot, snapshot: CompletionSnapshot): ImplementationAssessment {
  const data = parseFrontmatter(root.content).data;
  const check = validator(SPEC_COMMON_SCHEMA);
  if (!check(data)) throw new Error(`Invalid spec metadata: ${JSON.stringify(check.errors)}`);
  const impl = data.implementation as ImplementationDeclaration | undefined;
  const result: ImplementationAssessment = { implementation_status: impl?.status ?? null, assessment_status: "unrecorded", assessment_reasons: [] };
  if (!impl || impl.status !== "complete" || !impl.assessed_spec_hash) return result;
  const reasons = result.assessment_reasons;
  const add = (code: AssessmentReason["code"], spec: string, expected: string | null, actual: string | null, message: string) => reasons.push({ code, spec, message, expected, actual });
  const supported = (value: string) => value.startsWith("spec-v1:sha256:");
  const recorded = impl.assessed_dependencies;
  for (const [id, hash] of [[root.id, impl.assessed_spec_hash], ...Object.entries(recorded ?? {})]) {
    if (!supported(hash)) add("unsupported_version", id, hash, null, `Unsupported fingerprint version for ${id}.`);
  }
  const rootHash = fingerprintSpec(root.content);
  if (supported(impl.assessed_spec_hash) && impl.assessed_spec_hash !== rootHash) add("root_changed", root.id, impl.assessed_spec_hash, rootHash, `Spec content changed: ${root.id}.`);
  const current = new Map<string, string>();
  const visited = new Set([root.id]);
  let incomplete = false;
  const unavailable = new Set<string>();
  const visit = (node: CompletionSpecSnapshot) => {
    const from = node.id.slice(0, node.id.indexOf(":"));
    const fm = parseFrontmatter(node.content).data;
    const refs = [fm.extends, fm.implements].flatMap(v => v === undefined ? [] : Array.isArray(v) ? v : [v]);
    for (const ref of refs) {
      if (typeof ref !== "string") throw new Error(`Invalid dependency in ${node.id}`);
      const raw = ref.split("#", 1)[0];
      try {
        const child = snapshot.resolve(raw, from);
        if (!new RegExp(QUALIFIED_SPEC_PATTERN).test(child.id)) throw new Error("Invalid resolved identity");
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        current.set(child.id, fingerprintSpec(child.content));
        visit(child);
      } catch {
        incomplete = true;
        const id = raw.includes(":") ? raw : `${from}:${raw}`;
        if (!unavailable.has(id)) { unavailable.add(id); add("dependency_unavailable", id, recorded?.[id] ?? null, null, `Dependency unavailable: ${id}.`); }
      }
    }
  };
  visit(root);
  for (const [id, hash] of Object.entries(recorded ?? {})) {
    if (current.has(id) || unavailable.has(id)) continue;
    try { snapshot.resolve(id, root.id.slice(0, root.id.indexOf(":"))); }
    catch { incomplete = true; unavailable.add(id); add("dependency_unavailable", id, hash, null, `Dependency unavailable: ${id}.`); }
  }
  if (!recorded && (current.size > 0 || incomplete)) add("coverage_unrecorded", root.id, null, null, "Dependency coverage was not recorded.");
  if (recorded) {
    for (const [id, hash] of current) {
      if (!(id in recorded)) add("dependency_added", id, null, hash, `Dependency added: ${id}.`);
      else if (supported(recorded[id]) && recorded[id] !== hash) add("dependency_changed", id, recorded[id], hash, `Dependency changed: ${id}.`);
    }
    if (!incomplete) for (const [id, hash] of Object.entries(recorded)) if (!current.has(id)) add("dependency_removed", id, hash, null, `Dependency removed: ${id}.`);
  }
  const order: AssessmentReason["code"][] = ["root_changed", "dependency_changed", "dependency_added", "dependency_removed", "dependency_unavailable", "unsupported_version", "coverage_unrecorded"];
  reasons.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code) || compareKeys(a.spec, b.spec));
  result.assessment_status = reasons.some(r => ["dependency_unavailable", "unsupported_version", "coverage_unrecorded"].includes(r.code)) ? "unverifiable" : reasons.length ? "reassessment_needed" : "current";
  return result;
}
