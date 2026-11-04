// Native Specplane command handlers for Claude Code (mod hooks module).
// Compiled against the named-version declarations in
// harnesses/claude/host-evidence/<version>/capabilities.json; every host call
// below is one of the declared signatures recorded there. The logic lives in
// ./commands (host-independent); this file only binds it to the engine.
import type { EngineInterface, Register } from 'claude-code'
import {
  BUNDLED_CLI, COMPLETION_TOOL, NATIVE_COMMANDS, acceptResult, closeRequest, delegationPrompt, planRegistration, runCommand, serverReply,
} from './commands'
import type { CorePort, Delegation, HumanPort, NativeCommand, ReasoningSession, SpecplaneServer } from './commands'

/** Runs the bundled core CLI through the host; the mod has no shell and no console. */
function bundledCore($: EngineInterface): CorePort {
  return {
    async cli(argv, signal) {
      if (signal.aborted) return { exitCode: 130, stdout: '', stderr: 'cancelled' }
      const r = await $.process.run(['node', `${$.plugin.root}/${BUNDLED_CLI}`, ...argv], { timeoutMs: 120_000 })
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
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

/** The plugin's MCP server key in its manifest; the host names it `plugin:<plugin>:<server>`. */
export const SERVER_KEY = 'specplane'
export const SERVER_REFUSAL = 'Specplane workflow tools are reserved for Specplane commands; the model cannot call them.'
/** The completion tool as the host names a tool this plugin registers (`mcp__<plugin>__<name>`). It is not a server tool. */
export const COMPLETION_TOOL_NAME = `mcp__${SERVER_KEY}__${COMPLETION_TOOL}`

/**
 * True for a model call to this plugin's workflow server. `tool.check` input carries the tool name only, not the
 * server's provenance, so the name is the trust key here: any `mcp__*` tool naming Specplane is a server call.
 */
export function isSpecplaneServerTool(e: unknown): boolean {
  const tool = (e as { tool?: unknown } | undefined)?.tool
  return typeof tool === 'string' && tool.startsWith('mcp__') && new RegExp(SERVER_KEY, 'i').test(tool)
}

/**
 * The nonce gate (D13 design). A workflow-server call passes only when its arguments carry the session nonce the
 * mod bound; any other server call is refused, including while no nonce exists yet. The completion tool is exempt
 * because it is the mod's own tool, served by a `tool.call` hook, and it carries no nonce.
 */
export function refusesServerCall(e: unknown, nonce: string | undefined): boolean {
  if (!isSpecplaneServerTool(e) || (e as { tool: string }).tool === COMPLETION_TOOL_NAME) return false
  const input = (e as { input?: unknown }).input
  const carried = typeof input === 'object' && input !== null && nonce !== undefined && (input as { nonce?: unknown }).nonce === nonce
  return !carried
}

/** Per-session reasoning state, set at session.start. The nonce is sent only with the mod's own server calls. */
const session: { checkout: string; nonce?: string; binding: { bound: boolean } } = { checkout: '', binding: { bound: false } }

export function newNonce(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** The session nonce this module holds, for tests of the gate. The model is never given it. */
export function currentNonce(): string | undefined {
  return session.nonce
}

/** The plugin's Specplane server through the engine's `$.mcp`. Replies are MCP results, read by serverReply. */
function pluginServer($: EngineInterface): SpecplaneServer {
  let server: string | undefined
  return {
    async connect() {
      const c = await $.mcp.connect(SERVER_KEY)
      if (!c.isConnected) return { connected: false, message: c.message }
      server = c.server
      return { connected: true }
    },
    async call(tool, args) {
      if (server === undefined) return { ok: false, message: 'Specplane server is not connected.' }
      return serverReply(await $.mcp.call(server, tool, args))
    },
  }
}

/** The reasoning session for one hook call; undefined until session.start has set the checkout and nonce. */
function sessionFor($: EngineInterface): ReasoningSession | undefined {
  if (!session.nonce || !session.checkout) return undefined
  return { checkout: session.checkout, nonce: session.nonce, server: pluginServer($), binding: session.binding }
}

/**
 * Extension origin: no asUser, so the prompt never carries human authority. If the submit fails, nothing will
 * complete the request, so its lease is closed here. A submitted request that never gets a result is closed by the
 * server when the session ends.
 */
async function submitDelegation($: EngineInterface, d: Delegation): Promise<void> {
  try {
    await $.prompt.submit({ text: delegationPrompt(d) })
  } catch {
    pending.delete(d.requestId)
    await closeRequest(sessionFor($), d.requestId)
  }
}

export function registerNative(on: Parameters<Register>[0]): void {

  // The workflow server's tools are the mod's own: the model may not call them except with the bound nonce,
  // which the model never sees (D11 option E, D13). Fail closed: a throwing check refuses a server call.
  on('tool.check', (_$, e, next) => {
    if (refusesServerCall(e, session.nonce)) return { decision: 'deny', reason: SERVER_REFUSAL }
    return next(e)
  }).catch((_$, e, next) => (isSpecplaneServerTool(e) ? { decision: 'deny', reason: SERVER_REFUSAL } : next(e)))

  // Queue, then submit once the turn that ran the command has ended.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      for (const d of queue.splice(0)) {
        pending.set(d.requestId, d)
        void submitDelegation($, d)
      }
    }
    return result
  }).catch((_$, e, next) => next(e))

  // One filtered hook per command; a gating hook needs .catch because a throwing hook is skipped.
  for (const cmd of NATIVE_COMMANDS) bindCommand(on, cmd)

  on('tool.call', { tool: COMPLETION_TOOL_NAME }, async ($, e) => {
    const input = (e.input ?? {}) as { requestId?: unknown; result?: unknown }
    const outcome = await acceptResult(pending, input, { session: sessionFor($) })
    return { result: outcome.text }
  }).catch(() => ({ deny: 'Specplane could not validate this result; nothing was recorded.' }))
}


/** Registers what the inventory leaves free, reporting collisions; each registration fails alone. */
export async function startNative($: EngineInterface, cwd: string): Promise<void> {
  // Set first, so the gate and the reasoning path see the session even if the inventory is unavailable.
  session.checkout = cwd
  session.nonce = newNonce()
  session.binding = { bound: false }
  let inventory
  try {
    inventory = await $.command.list()
  } catch {
    $.ui.log('specplane: command inventory unavailable; native handlers stay off (use the specplane CLI)', { to: 'debug' })
    return
  }
  // Reasoning commands and the completion tool stay unregistered until the live check (run 3, D13). Their handlers
  // are bound above and covered offline; flipping this flag is the only switch that makes them visible to the host.
  const reasoning = false
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
      origin: e.origin, signal: next.signal, core: bundledCore($), human: hostHuman($), queue, session: sessionFor($),
    })
  }).catch(() => ({ text: `/${cmd.name} failed; nothing changed`, exitCode: 1 }))
}
