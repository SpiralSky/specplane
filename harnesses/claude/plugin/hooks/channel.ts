// Binds the action channel (./core-channel) to the Claude Code engine: starts the session server at session.start,
// registers its actions as tools, serves tool.call by forwarding and asks the server to stop at session.end.
// Host calls used: process.spawn, tool.register, http.fetch (socketPath), session.id, session.model, session.version,
// agent.list, fs.read, ui.log.
import type { EngineInterface, Register } from 'claude-code'
import {
  actionOfTool, callBody, forward, parseReadiness, SECRET_HEADER, serverArgv, TOOL_PREFIX, versionMatches,
} from './core-channel'
import type { Readiness } from './core-channel'
import { arrivalDialogue } from './commands'
import { bundledCore, hostAsk, PROMPT_DELAY_MS } from './handlers'

const CORE_ENTRY = 'core/dist/harness/session-server-main.js'
const VERSION_FILE = '.claude-plugin/host-version.json'

type State = { ready?: Readiness; names: Set<string>; session: string; cwd: string; started: number; version: { running: string; checked: string } }
/** Request ids whose arrival dialogue was already opened in this session: one dialogue per request, whichever route saw it. */
const shown = new Set<string>()
const state: State = { names: new Set(), session: '', cwd: '', started: 0, version: { running: '', checked: '' } }

async function checkedVersion($: EngineInterface): Promise<string> {
  try { return String(JSON.parse(await $.fs.read(`${$.plugin.root}/${VERSION_FILE}`)).checkedHostVersion ?? '') } catch { return '' }
}

/** Starts one core, reads its readiness line and keeps draining its output for the life of the child. */
async function startCore($: EngineInterface): Promise<Readiness> {
  const child = $.process.spawn({
    argv: serverArgv(`${$.plugin.root}/${CORE_ENTRY}`, state.session, state.cwd, state.version.running, state.version.checked),
    cwd: state.cwd,
    env: { SPECPLANE_ACTOR: 'mod' },
  })
  let startup = ''
  let diagnostics = ''
  while (!startup.includes('\n')) {
    const piece = await child.next()
    if (piece.done) throw new Error(`the session server exited before it was ready (code ${String(piece.value.code)}): ${diagnostics.trim().slice(0, 300)}`)
    if (piece.value.stream === 'stdout') startup += piece.value.text
    else diagnostics += piece.value.text
  }
  const ready = parseReadiness(startup.split('\n')[0]!)
  // Drain for the life of the child: an undrained stream stalls it.
  void (async () => {
    try {
      for await (const chunk of child) $.ui.log(`specplane core [${chunk.stream}]: ${chunk.text.trim().slice(0, 200)}`, { to: 'debug' })
      const res = await child.result
      $.ui.log(`specplane core exited code=${String(res.code)} signal=${String(res.signal)}`, { to: 'debug' })
    } catch (err) { $.ui.log(`specplane core stream ended: ${String(err)}`, { to: 'debug' }) }
  })()
  state.ready = ready
  return ready
}

export async function startChannel($: EngineInterface, cwd: string): Promise<void> {
  state.session = String(await $.session.id())
  state.cwd = cwd
  state.version.checked = await checkedVersion($)
  try { state.version.running = String((await $.session.version()).version ?? '') } catch { state.version.running = '' }
  if (!versionMatches(state.version.running, state.version.checked)) {
    $.ui.log(`specplane: Claude Code ${state.version.running || '(unknown version)'} differs from ${state.version.checked || '(unrecorded)'}, the version this plugin was checked against; the tools are served, but subagent identity is not vouched for`, { to: 'transcript' })
  }
  const ready = await startCore($)
  state.started = 1
  for (const a of ready.actions) {
    try {
      await $.tool.register({ name: a.name, description: a.description, ...(a.inputSchema ? { inputSchema: a.inputSchema } : {}), isDeferred: false })
      state.names.add(a.name)
    } catch (err) { $.ui.log(`specplane: registering the tool ${a.name} failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' }) }
  }
}

/** Tell the model what the user answered, as a prompt with no human authority, once this hook has let go of its turn. */
export function submitNote($: EngineInterface, text: string): void {
  const fail = (): void => { try { $.ui.log('specplane: could not tell the assistant the answer; it is in the dialogue log', { to: 'transcript' }) } catch { /* nothing more to do */ } }
  try {
    $.clock.after(PROMPT_DELAY_MS, () => {
      try { void $.prompt.submit({ text }).catch(fail) } catch { fail() }
    })
  } catch { fail() }
}

export function registerChannel(on: Parameters<Register>[0]): void {
  on('tool.call', async ($, e, next) => {
    const action = actionOfTool(e.tool, state.names)
    if (!action) {
      // Not served here. When the call is a Specplane tool served by the project's MCP server (`specplane mcp`), the
      // reply passes through this hook on its way back: look at it for the arrival dialogue. The dialogue opens before
      // the hook returns, so the model's turn is held until the user answers. This route does not rewrite the MCP
      // server's reply (a hook's own result is checked against that tool's output schema); instead, after an Accept or
      // Decline, one prompt without human authority tells the model. Any failure is logged and the reply stands.
      const r = await next(e)
      if (!String(e.tool).startsWith(TOOL_PREFIX)) return r
      try {
        const text = (r as { text?: unknown; isError?: unknown }).isError ? undefined : (r as { text?: unknown }).text
        if (typeof text !== 'string') return r
        const note = await arrivalDialogue(text, hostAsk($), bundledCore($), m => $.ui.log(m, { to: 'transcript' }), shown)
        if (note) submitNote($, note.prompt)
        return r
      } catch (err) { try { $.ui.log(`specplane: the arrival dialogue failed: ${String(err)}`, { to: 'debug' }) } catch { /* nothing more to do */ } return r }
    }
    const ev = e as unknown as Record<string, unknown>
    let agentType: string | undefined
    if (typeof ev.agentId === 'string' && ev.agentId) {
      try { agentType = (await $.agent.list()).find(a => a.id === ev.agentId)?.type } catch { /* the core then sees no agent type */ }
    }
    let model: string | undefined
    try { model = String(await $.session.model()) } catch { model = undefined }
    const out = await forward({
      current: () => state.ready!,
      remainingMs: () => next.budget.remainingMs,
      restart: async () => {
        // At most one new core per session: a second failure is final.
        if (state.started >= 2) throw new Error('a second core was already started in this session')
        state.started = 2
        return startCore($)
      },
      http: async (socket, secret, route, body) => {
        const r = await $.http.fetch(`http://localhost${route}`, { method: 'POST', socketPath: socket, headers: { 'Content-Type': 'application/json', [SECRET_HEADER]: secret }, body })
        return { status: r.status, text: r.text }
      },
    }, callBody(action, ev, agentType, model))
    if ('deny' in out) return { deny: `Specplane: ${out.deny}` }
    // The host takes a string result. A hook's own result cannot carry an error flag, so an error reply is a refusal.
    // The arrival dialogue (claude-integration §3): it never throws into the host; an answered one adds a line to the reply.
    let text = out.reply.text
    if (!out.reply.isError) {
      try {
        const note = await arrivalDialogue(text, hostAsk($), bundledCore($), m => $.ui.log(m, { to: 'transcript' }), shown)
        if (note) text = `${text}\n${note.line}`
      } catch { /* the reply stands */ }
    }
    return out.reply.isError ? { deny: out.reply.text } : { result: text }
  })

  on('session.end', async ($, e, next) => {
    const r = state.ready
    if (r) {
      try { await $.http.fetch('http://localhost/shutdown', { method: 'POST', socketPath: r.socket, headers: { [SECRET_HEADER]: r.secret } }) } catch { /* it may be gone already */ }
    }
    return next(e)
  })
}
