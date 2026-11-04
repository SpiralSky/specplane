// Native Specplane command handlers for Claude Code (mod hooks module).
// Compiled against the named-version declarations in
// harnesses/claude/host-evidence/<version>/capabilities.json; every host call
// below is one of the declared signatures recorded there. The logic lives in
// ./commands (host-independent); this file only binds it to the engine.
import type { EngineInterface, Register } from 'claude-code'
import {
  BUNDLED_CLI, COMPLETION_TOOL, NATIVE_COMMANDS, acceptResult, delegationPrompt, planRegistration, runCommand,
} from './commands'
import type { CorePort, Delegation, HumanPort, NativeCommand } from './commands'

/** Runs the bundled core CLI through the host; the mod has no shell and no console. */
function bundledCore($: EngineInterface): CorePort {
  return {
    async cli(argv, signal) {
      if (signal.aborted) return { exitCode: 130, stdout: '', stderr: 'cancelled' }
      const r = await $.process.run(['node', `${$.plugin.root}/${BUNDLED_CLI}`, ...argv], { timeoutMs: 120_000 })
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
    // prepare/record are left unbound: the host's process API writes stdin once and
    // closes it, so a persistent runner cannot hold a writer lease across a reasoning
    // turn on this version (HANDOFF D9). Reasoning commands therefore stay unavailable.
  }
}

/** The host dialog. A rejected ask (dismissed, or a -p run with no one to ask) means unavailable. */
function hostHuman($: EngineInterface): HumanPort {
  return {
    async confirm(summary) {
      try {
        const answer = await $.ui.ask(summary, ['Confirm', 'Cancel'])
        return answer === 'Confirm' ? 'confirmed' : 'declined'
      } catch {
        return 'unavailable'
      }
    },
  }
}

/** Names this module registered; a command.run for any other name passes through to its owner. */
const registered = new Set<string>()
const queue: Delegation[] = []
const pending = new Map<string, Delegation>()

/** Registers the native command hooks (everything except the single session.start, see startNative). */
/** The plugin's MCP server key in its manifest; the host names it `plugin:<plugin>:<server>`. */
export const SERVER_KEY = 'specplane'
export const SERVER_REFUSAL = 'Specplane workflow tools are reserved for Specplane commands; the model cannot call them.'

/**
 * True for a model call to this plugin's workflow server. `tool.check` input carries the tool name only, not the
 * server's provenance, so the name is the trust key here: any `mcp__*` tool naming Specplane is refused (fail closed).
 */
export function isSpecplaneServerTool(e: unknown): boolean {
  const tool = (e as { tool?: unknown } | undefined)?.tool
  return typeof tool === 'string' && tool.startsWith('mcp__') && new RegExp(SERVER_KEY, 'i').test(tool)
}

export function registerNative(on: Parameters<Register>[0]): void {

  // The workflow server's tools are the mod's own: the model may not call them (D11 option E).
  // Fail closed: a throwing check refuses a Specplane server call rather than letting it through.
  on('tool.check', ($, e, next) => {
    if (isSpecplaneServerTool(e)) return { decision: 'deny', reason: SERVER_REFUSAL }
    return next(e)
  }).catch(($, e, next) => (isSpecplaneServerTool(e) ? { decision: 'deny', reason: SERVER_REFUSAL } : next(e)))

  // Queue, then submit once the turn that ran the command has ended.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      for (const d of queue.splice(0)) {
        pending.set(d.requestId, d)
        // Extension origin: no asUser, so the prompt never carries human authority.
        void $.prompt.submit({ text: delegationPrompt(d) })
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  // One filtered hook per command; a gating hook needs .catch because a throwing hook is skipped.
  for (const cmd of NATIVE_COMMANDS) bindCommand(on, cmd)

  on('tool.call', { tool: `mcp__specplane__${COMPLETION_TOOL}` }, async ($, e, next) => {
    const input = (e.input ?? {}) as { requestId?: unknown; result?: unknown }
    const outcome = await acceptResult(pending, input, { core: bundledCore($), human: hostHuman($), signal: next.signal })
    return { result: outcome.text }
  }).catch(() => ({ deny: 'Specplane could not validate this result; nothing was recorded.' }))
}


/** Registers what the inventory leaves free, reporting collisions; each registration fails alone. */
export async function startNative($: EngineInterface): Promise<void> {
  let inventory
  try {
    inventory = await $.command.list()
  } catch {
    $.ui.log('specplane: command inventory unavailable; native handlers stay off (use the specplane CLI)', { to: 'debug' })
    return
  }
  const core = bundledCore($)
  const reasoning = Boolean(core.prepare && core.record)
  const plan = planRegistration(inventory.map(c => ({ name: c.name, source: c.source })), reasoning)
  for (const c of plan.collisions) {
    $.ui.log(`specplane: /${c.name} is owned by ${c.owner}; handler unavailable. Manual: ${c.manual}`, { to: 'debug' })
  }
  for (const u of plan.unavailable) $.ui.log(`specplane: /${u.name} unavailable: ${u.reason}`, { to: 'debug' })
  for (const cmd of plan.register) {
    try {
      await $.command.register({ name: cmd.name, description: cmd.description, argumentHint: cmd.argumentHint })
      registered.add(cmd.name)
    } catch {
      $.ui.log(`specplane: registering /${cmd.name} failed; the others are unaffected`, { to: 'debug' })
    }
  }
  if (reasoning) {
    try {
      await $.tool.register({
        name: COMPLETION_TOOL,
        description: 'Return the structured WorkflowResult for a prepared Specplane request.',
        inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, result: { type: 'object' } }, required: ['requestId', 'result'] },
        isDeferred: false,
      })
    } catch {
      $.ui.log('specplane: completion tool registration failed; reasoning delegation stays off', { to: 'debug' })
    }
  }
}

function bindCommand(
  on: Parameters<Register>[0],
  cmd: NativeCommand,
): void {
  on('command.run', { command: cmd.name }, async ($, e, next) => {
    if (!registered.has(cmd.name)) return next(e) // not ours: the host or another plugin owns the name
    return runCommand(cmd, e.args, {
      origin: e.origin, signal: next.signal, core: bundledCore($), human: hostHuman($), queue,
    })
  }).catch(() => ({ text: `/${cmd.name} failed; nothing changed`, exitCode: 1 }))
}
