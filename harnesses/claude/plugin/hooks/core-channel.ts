// The mod's side of the action channel (`claude-integration` §10, `reference-cli` §12.8): plain functions that build the
// requests to the session server, read its replies and decide on a retry. They take the host calls as arguments, so tests
// run them without Claude Code. The wiring to the engine is in ./channel.

/** Header that carries the session secret on every request. */
export const SECRET_HEADER = 'x-specplane-secret'

/** The host's limit for one forwarded request; the server answers within 25 s or says pending. */
export const HOST_LIMIT_MS = 30_000

/** The tool-name prefix of a tool the mod registers: `mcp__<plugin name>__<action name>`. */
export const TOOL_PREFIX = 'mcp__specplane__'

export type ActionSpec = { name: string; description: string; inputSchema?: Record<string, unknown> }
export type Readiness = { socket: string; secret: string; pid: number; actions: ActionSpec[] }
export type Reply = { text: string; isError: boolean }

/** Fields of a tool.call event that are the engine's, not the tool's input. */
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])

/** Parses the readiness line; throws a message naming what is wrong. */
export function parseReadiness(line: string): Readiness {
  let v: unknown
  try { v = JSON.parse(line.trim()) } catch { throw new Error(`the session server's first line is not JSON: ${line.trim().slice(0, 120)}`) }
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') throw new Error('the session server\'s readiness line is not an object')
  if (typeof o.socket !== 'string' || !o.socket) throw new Error('the readiness line has no socket')
  if (typeof o.secret !== 'string' || !o.secret) throw new Error('the readiness line has no secret')
  if (!Array.isArray(o.actions)) throw new Error('the readiness line has no action list')
  const actions: ActionSpec[] = []
  for (const a of o.actions as Record<string, unknown>[]) {
    if (!a || typeof a.name !== 'string' || !a.name) throw new Error('an action on the readiness line has no name')
    actions.push({
      name: a.name,
      description: typeof a.description === 'string' ? a.description : '',
      ...(a.inputSchema && typeof a.inputSchema === 'object' ? { inputSchema: a.inputSchema as Record<string, unknown> } : {}),
    })
  }
  return { socket: o.socket, secret: o.secret, pid: typeof o.pid === 'number' ? o.pid : 0, actions }
}

/** The arguments of the session-server child: it takes the host's pid from `$PPID` of the shell that execs it. */
export function serverArgv(coreEntry: string, session: string, projectDir: string, hostVersion: string, checkedVersion: string): string[] {
  return ['sh', '-c', 'exec node "$0" "$1" "$2" "$PPID" --host-version "$3" --checked-version "$4"', coreEntry, session, projectDir, hostVersion, checkedVersion]
}

/** True when the running host version is the one the plugin was checked against; an empty version never matches. */
export function versionMatches(running: string, checked: string): boolean {
  return running !== '' && running === checked
}

/** The action name of a tool name this mod serves, or undefined for any other tool. */
export function actionOfTool(tool: string, names: ReadonlySet<string>): string | undefined {
  if (!tool.startsWith(TOOL_PREFIX)) return undefined
  const name = tool.slice(TOOL_PREFIX.length)
  return names.has(name) ? name : undefined
}

/** The tool's own input: the event without the engine's fields. */
export function inputOf(e: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k)) input[k] = v
  return input
}

/** The body of POST /call: the caller comes from the engine's fields only. */
export function callBody(action: string, e: Record<string, unknown>, agentType: string | undefined, model: string | undefined): string {
  const agentId = typeof e.agentId === 'string' && e.agentId ? e.agentId : undefined
  return JSON.stringify({
    action,
    input: inputOf(e),
    caller: { ...(agentId ? { agentId } : {}), ...(agentId && agentType ? { agentType } : {}), ...(typeof e.tool_use_id === 'string' ? { toolUseId: e.tool_use_id } : {}) },
    ...(model ? { model } : {}),
  })
}

export type Answer = { kind: 'done'; reply: Reply } | { kind: 'pending'; job: string } | { kind: 'failed'; message: string }

/** Reads one HTTP answer of the server. */
export function readAnswer(status: number, text: string): Answer {
  let b: Record<string, unknown> = {}
  try { const p = JSON.parse(text); if (p && typeof p === 'object') b = p as Record<string, unknown> } catch { /* handled below */ }
  if (status === 401) return { kind: 'failed', message: 'the session server refused the secret' }
  if (status === 503) return { kind: 'failed', message: 'the session server is shutting down' }
  if (status === 404 && b.status === 'unknown') return { kind: 'failed', message: 'the job is unknown: the session server lost it (a restarted server does not run it again)' }
  if (status !== 200) return { kind: 'failed', message: `the session server answered ${status}${typeof b.error === 'string' ? `: ${b.error}` : ''}` }
  if (b.status === 'done' && typeof b.text === 'string') return { kind: 'done', reply: { text: b.text, isError: b.isError === true } }
  if (b.status === 'pending' && typeof b.job === 'string') return { kind: 'pending', job: b.job }
  return { kind: 'failed', message: 'the session server sent an answer in an unknown shape' }
}

/** The connection failed before the request was sent: there is no socket or nothing listens on it. */
export function isConnectionFailure(err: unknown): boolean {
  return /ENOENT|ECONNREFUSED|ENOTSOCK|ECONNRESET.*before|no such file/i.test(err instanceof Error ? err.message : String(err))
}

/** A request was sent and no answer came within the host's limit. */
export function isTimeout(err: unknown): boolean {
  return /no complete answer within|timed? ?out/i.test(err instanceof Error ? err.message : String(err))
}

export type Http = (socket: string, secret: string, route: '/call' | '/poll', body: string) => Promise<{ status: number; text: string }>

export type CallDeps = {
  http: Http
  /** Starts a new core and resolves its readiness; called at most once per tool call here, and the channel caps it per session. */
  restart: () => Promise<Readiness>
  /** What is left of the hook's own time; polling sleeps nothing, and the clock stops during a `$` call. */
  remainingMs: () => number
  /** The server in use now. */
  current: () => Readiness
}

export type CallOutcome = { reply: Reply } | { deny: string }

const MIN_LEFT_MS = 500
/** An action that answers pending this many times in a row (about 25 s each) is given up on. */
export const MAX_POLLS = 40

async function exchange(deps: CallDeps, route: '/call' | '/poll', body: string): Promise<Answer> {
  const r = deps.current()
  const res = await deps.http(r.socket, r.secret, route, body)
  return readAnswer(res.status, res.text)
}

/** Sends the call, follows `pending` with polls, and applies the failure rules of `claude-integration` §10. */
export async function forward(deps: CallDeps, body: string): Promise<CallOutcome> {
  let answer: Answer
  try {
    try { answer = await exchange(deps, '/call', body) } catch (err) {
      if (!isConnectionFailure(err)) throw err
      // Not sent: start a new core once and send the call again.
      try { await deps.restart() } catch (e2) { return { deny: `the session server is gone and a new one did not start: ${message(e2)}` } }
      answer = await exchange(deps, '/call', body)
    }
    for (let polls = 0; answer.kind === 'pending'; polls++) {
      if (polls >= MAX_POLLS) return { deny: 'the action is still running after the mod stopped waiting; it keeps running in the session server' }
      if (deps.remainingMs() < MIN_LEFT_MS) return { deny: 'the hook ran out of time while the action was still running; it keeps running in the session server' }
      answer = await exchange(deps, '/poll', JSON.stringify({ job: answer.job }))
    }
  } catch (err) {
    if (isTimeout(err)) return { deny: `the session server did not answer within the host's ${HOST_LIMIT_MS} ms limit: ${message(err)}` }
    return { deny: `the session server could not be reached: ${message(err)}` }
  }
  return answer.kind === 'done' ? { reply: answer.reply } : { deny: `${answer.message}` }
}

function message(e: unknown): string { return e instanceof Error ? e.message : String(e) }
