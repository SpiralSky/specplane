import { PreconditionError } from "../errors.js";

/**
 * The harness adapter interface (`architecture/reference-cli` §12.6, `harness R35.1`). An adapter says which
 * capabilities its host has; setup and every action state the missing ones and refuse rather than substitute a
 * weaker route.
 */

export const CAPABILITIES = [
  "instructions-on-demand",
  "push",
  "subagents",
  "viewing",
  "usage-measurement",
  "command-blocking",
  "session-opening",
  "bypass-guards",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type Capabilities = Record<Capability, boolean>;

export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  "instructions-on-demand": "instructions on demand",
  push: "push notifications",
  subagents: "subagents",
  viewing: "viewing specifications",
  "usage-measurement": "usage measurement",
  "command-blocking": "blocking the Specplane CLI",
  "session-opening": "opening a plan session",
  "bypass-guards": "guarding against permission bypass by headless sessions",
};

export interface HarnessAdapter {
  /** The name the user gives to `init --harness <name>`. */
  readonly name: string;
  /** What this host can do; `root` lets an adapter report what the installed files actually provide. */
  capabilities(root?: string): Capabilities;
}

/** Capabilities every harness lacks until its adapter says otherwise; the safe default. */
export function noCapabilities(): Capabilities {
  return Object.fromEntries(CAPABILITIES.map((c) => [c, false])) as Capabilities;
}

export function missingCapabilities(adapter: HarnessAdapter, root?: string): Capability[] {
  const have = adapter.capabilities(root);
  return CAPABILITIES.filter((c) => !have[c]);
}

/** One line per capability for setup output and documentation: supported or missing (`harness R35.1`). */
export function reportCapabilities(adapter: HarnessAdapter, root?: string): string[] {
  const have = adapter.capabilities(root);
  return CAPABILITIES.map((c) => `${adapter.name}: ${CAPABILITY_LABELS[c]}: ${have[c] ? "supported" : "missing"}`);
}

/** Refuse an action that needs a capability the harness lacks; never fall back to another route. */
export function requireCapability(adapter: HarnessAdapter, capability: Capability, doing: string, root?: string): void {
  if (!adapter.capabilities(root)[capability]) {
    throw new PreconditionError([`${doing} needs ${CAPABILITY_LABELS[capability]}, which ${adapter.name} does not support; nothing was done.`]);
  }
}

const adapters = new Map<string, HarnessAdapter>();

/** Host-specific adapters register themselves here; `adapters.ts` holds the declarations. */
export function registerAdapter(adapter: HarnessAdapter): void {
  adapters.set(adapter.name, adapter);
}
export function getAdapter(name: string): HarnessAdapter | undefined {
  return adapters.get(name);
}
export function adapterNames(): string[] {
  return [...adapters.keys()].sort();
}
