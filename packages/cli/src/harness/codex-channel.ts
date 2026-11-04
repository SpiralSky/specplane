/** Chooses how a Codex session reaches core workflows. Never substitutes another host. */
export interface CodexSurface { host: string; persistentToolChannel: boolean }
export type CodexChannel =
  | { channel: 'persistent-runner'; command: string[]; substitutedHost: null }
  | { channel: 'manual-cli-fallback'; label: string; substitutedHost: null; reason: string }
  | { channel: 'refused'; reason: string; substitutedHost: null };
export function selectCodexWorkflowChannel(surface: CodexSurface, skillDir: string, checkout: string): CodexChannel {
  if (surface.host !== 'codex') return { channel: 'refused', reason: `Surface host "${surface.host}" is not Codex; no other host is substituted.`, substitutedHost: null };
  if (!surface.persistentToolChannel) return { channel: 'manual-cli-fallback', label: 'Manual CLI fallback: no persistent tool channel, so no writer lease is retained across preparation, reasoning and recording.', reason: 'The surface exposes no persistent process tool channel.', substitutedHost: null };
  return { channel: 'persistent-runner', command: ['node', `${skillDir}/scripts/workflow.mjs`, 'serve', '--checkout', checkout], substitutedHost: null };
}
