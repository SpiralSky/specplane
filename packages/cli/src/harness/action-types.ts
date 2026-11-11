import type { Ctx } from "../spec/human.js";
import type { Warning } from "../verify/warnings.js";

/** Shared shapes of the harness action registry (`architecture/reference-cli` §12.1). */
export type Input = Record<string, any>;
export type Schema = Record<string, unknown>;
export interface ActionContext extends Ctx {
  sessionWarnings: Warning[];
  /** Resources the adapter can measure for plan budgets; unset when it did not say (`harness R35.1`). */
  measurable?: string[];
}
export interface HarnessAction {
  id: string; inputSchema: Schema;
  permissions: (input: Input) => string[];
  /** Read actions can be safely replayed by the human request runner. */
  readOnly: boolean;
  handler: (ctx: ActionContext, input: Input) => unknown | Promise<unknown>;
}
export type Adder = (id: string, properties: Schema, required: string[], permissions: string[] | HarnessAction["permissions"], readOnly: boolean, handler: HarnessAction["handler"]) => void;

export const str = { type: "string", minLength: 1 };
export const bool = { type: "boolean" };
export const strings = { type: "array", items: str, minItems: 1, uniqueItems: true };
