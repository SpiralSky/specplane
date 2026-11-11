import type { ImplementationAssessment } from "../core/completion.js";
import { headContext, implementationState } from "./implementation.js";

/**
 * Implementation assessment per spec from the notes store (`architecture/file-formats` §11.3): `current` when an
 * implementation record applies to the committed content, `reassessment_needed` when only a record for other content
 * exists, `unrecorded` otherwise. A repository without commits or a project that cannot be read has no records.
 */
export function implementationAssessor(root: string): (id: string) => ImplementationAssessment {
  let held: ReturnType<typeof headContext> | null | undefined;
  const open = () => {
    if (held === undefined) { try { held = headContext(root); } catch { held = null; } }
    return held;
  };
  return (id) => {
    const h = open();
    const doc = h?.project.specs.get(id);
    if (!h || !doc) return { implementation_status: null, assessment_status: "unrecorded", assessment_reasons: [] };
    const s = implementationState(h.ctx, doc);
    if (s.record) return { implementation_status: "complete", assessment_status: "current", assessment_reasons: [] };
    if (s.outdated) return { implementation_status: null, assessment_status: "reassessment_needed", assessment_reasons: [{ code: "root_changed", spec: id, message: `Spec content changed since it was recorded as implemented: ${id}.`, expected: null, actual: null }] };
    return { implementation_status: null, assessment_status: "unrecorded", assessment_reasons: [] };
  };
}
