import { readCommittedConfig } from "../config-source.js";
import { parseYaml } from "../yaml.js";
import type { LlmFactors } from "./llm-rules.js";

/**
 * Guardrails against permission bypass (`feature/roles-and-permissions` R58). Each measure is configurable on its own
 * under `bypass_guards.<measure>` and on by default. The core owns `llm_marker`; the adapters own the rest (the Claude
 * hooks read the same setting, `architecture/reference-cli` §7.8).
 */
export const BYPASS_MEASURES = ["llm_marker", "marker_export", "marker_protect", "headless_block", "store_protect", "hook_protect"] as const;
export type BypassMeasure = (typeof BYPASS_MEASURES)[number];

export const BYPASS_MEASURE_DOCS: Readonly<Record<BypassMeasure, string>> = {
  llm_marker: "A Specplane command that runs in a process marked as an LLM's (SPECPLANE_ACTOR=llm) runs with the LLM role the rules give, never with the role of the person who owns the machine, and cannot switch to the Administrator",
  marker_export: "The harness marks every shell command of an LLM session and every headless session it starts with the marker and the LLM's identity, so a headless session or the CLI run from inside it is recognised",
  marker_protect: "The harness blocks a shell command that clears or overrides the marker (unset, env -u, env -i, setting SPECPLANE_ACTOR)",
  headless_block: "The harness blocks a shell command that starts a headless LLM session (claude -p, claude --print, codex exec)",
  store_protect: "The harness blocks direct writes to the local Specplane store (role.json, os-users.json, trusted-rules.json, the callers/ folder of recorded subagent callers) and to the approvals notes ref",
  hook_protect: "The harness blocks direct writes to the installed Specplane hooks and the Claude settings that register them, which would switch the other guards off",
};

/** The environment variable that marks a process as started by an LLM. */
export const ACTOR_ENV = "SPECPLANE_ACTOR";
export const LLM_MARK = "llm";

/** Measures stated in a configuration file; a measure not stated is on. */
export function bypassSettings(text: string | null): Record<string, boolean> {
  try {
    const doc = text === null ? null : parseYaml(text) as { bypass_guards?: unknown } | null;
    const map = doc?.bypass_guards;
    if (typeof map !== "object" || map === null || Array.isArray(map)) return {};
    const words: Record<string, boolean> = { on: true, off: false, true: true, false: false };
    return Object.fromEntries(Object.entries(map).flatMap(([k, v]): Array<[string, boolean]> => typeof v === "boolean" ? [[k, v]] : typeof v === "string" && v in words ? [[k, words[v]]] : []));
  } catch { return {}; }
}

/** True unless the committed configuration turns the measure off. */
export function bypassGuardOn(root: string, measure: BypassMeasure): boolean {
  try { return bypassSettings(readCommittedConfig(root))[measure] !== false; } catch { return true; }
}

export type Env = Readonly<Record<string, string | undefined>>;

/** True when the environment marks the process as an LLM's. */
export const llmMarked = (env: Env): boolean => env[ACTOR_ENV]?.trim().toLowerCase() === LLM_MARK;

const clean = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);

/** What the harness knows about a marked LLM, matched by the LLM role rules (`R44.1`), from the adapter's environment. */
export function envFactors(env: Env): { factors: LlmFactors; model?: string; delegatedBy?: string } {
  const model = clean(env.SPECPLANE_MODEL), delegatedBy = clean(env.SPECPLANE_DELEGATED_BY);
  const provider = clean(env.SPECPLANE_PROVIDER), agentType = clean(env.SPECPLANE_AGENT_TYPE), subagent = clean(env.SPECPLANE_SUBAGENT);
  return {
    factors: { ...(subagent ? { subagent } : {}), ...(agentType ? { agent_type: agentType } : {}), ...(provider ? { provider } : {}), ...(model ? { model } : {}), delegated: !!delegatedBy },
    ...(model ? { model } : {}), ...(delegatedBy ? { delegatedBy } : {}),
  };
}

/** Warnings for `validate`: a measure that does not exist (a typo leaves a guard on that was meant to be off) and each measure turned off. */
export function bypassFindings(map: Record<string, boolean> | undefined): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!(BYPASS_MEASURES as readonly string[]).includes(k)) out.push(`setting \`bypass_guards.${k}\` names no bypass guard; allowed: ${BYPASS_MEASURES.join(", ")}`);
    else if (v === false) out.push(`bypass guard \`${k}\` is off, so an LLM can get round its role this way (\`roles-and-permissions\` R58)`);
  }
  return out;
}
