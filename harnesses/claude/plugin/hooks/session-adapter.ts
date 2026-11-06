// Route B session adapter for headless Claude Code (D25 option 1; claude:architecture/claude-integration
// `## Claude session adapter (extension-owned)`, applied edit A13). Host-independent: the process port, the
// mapping store and the evidence record arrive as ports, so this file is covered offline with a fake process
// (session-adapter.test.ts) and no test starts a real `claude`.
//
// GATED: `probe` reports every capability false unless the caller supplies a passed probe record for the installed,
// named version (see `ProbeEvidence`). Nothing in this repository supplies one yet; S4's single live probe produces it.

/** Structural copies of the core Protocol 1 types (packages/cli/src/core/contracts.ts); kept local because the plugin ships alone. */
export type SessionRef = { orchestrationId: string; nativeSessionId?: string; pid?: number }
export type SessionState = SessionRef & { state: 'running' | 'completed' | 'failed' | 'unknown' }
export type SessionRequest = { requestId: string; orchestrationId: string; plan: string; step: number; checkout: string; workflowRequestPath: string; mode: 'unattended'; budgetUsd?: number; signal?: AbortSignal }
export type SessionCapabilities = { host: string; version?: string; surface: string; backends: string[]; launch: boolean; observe: boolean; resume: boolean; cancel: boolean; budgetEnforcement: boolean }

/** One spawned process, as the adapter needs it. The host binding wraps `$.process.spawn` (argument array, no shell). */
export interface ProcessHandle {
  pid?: number
  /** Called for each complete stdout line, and for each line already buffered. */
  onLine(cb: (line: string) => void): void
  /** Resolves with the exit code once the process has exited (null when killed by a signal). */
  exited: Promise<number | null>
  kill(signal: 'SIGTERM' | 'SIGKILL'): void
}
export interface ProcessPort {
  spawn(argv: readonly string[], opts: { cwd: string }): ProcessHandle
  /** Optional: whether a pid from an earlier run is still alive. Without it, resume after a restart refuses. */
  isAlive?(pid: number): boolean
}
export interface MappingRecord { orchestrationId: string; nativeSessionId: string; pid?: number; spawnFailed?: boolean }
export interface MappingStore {
  save(record: MappingRecord): void | Promise<void>
  load(orchestrationId: string): MappingRecord | undefined | Promise<MappingRecord | undefined>
}
/** A recorded passing probe against one named version. Flags are only ever derived from it, never from help text. */
export interface ProbeEvidence { version: string; launched: boolean; observed: boolean; resumed: boolean; cancelled: boolean; budgetStopSeen: boolean }

export interface AdapterDeps {
  process: ProcessPort
  store: MappingStore
  newId: () => string
  /** Installed Claude Code version, when known. */
  version?: string
  evidence?: ProbeEvidence
  /** Log path to cite in recovery instructions. */
  logPath?: (ref: SessionRef) => string | undefined
  cancelWaitMs?: number
  /** Executable; defaults to `claude`. */
  executable?: string
}

type Tracked = {
  handle: ProcessHandle
  nativeSessionId: string
  exit: { done: boolean; code: number | null }
  result?: { subtype: string; isError: boolean }
  unparseable: boolean
  /** Set from `system/init`: true when the plugin is listed and the mode is auto, false otherwise, undefined until init is seen. */
  initOk?: boolean
}

const SEP = /[\r\n]/

/** The plugin that must load in every child session; without it the mod's policy and server are absent. */
export const PLUGIN_NAME = 'specplane'

/** The permission mode every child session must report in `system/init`. */
export const PERMISSION_MODE = 'auto'

/**
 * Unattended permission policy (A13). Auto mode's classifier reviews each action, and `--permission-prompts none` denies
 * what would have prompted. Keep this list narrow: a matching allow rule skips the classifier.
 */
export const ALLOWED_TOOLS: readonly string[] = Object.freeze(['Skill'])

/** Hard limits the classifier cannot override: deny rules win, and apply to every subcommand of a compound command. */
export const DISALLOWED_TOOLS: readonly string[] = Object.freeze(
  ['git push', 'git reset --hard', 'git clean', 'sudo', 'npm publish',
    'specplane spec approve', 'specplane spec reopen', 'specplane plan approve', 'specplane plan finish', 'specplane plan step-done', 'specplane plan abandon', 'specplane decision accept',
  ].map(c => `Bash(${c} *)`),
)

/** The prompt names the installed procedure and the request path only; no free text from the plan. */
export function buildPrompt(workflowRequestPath: string): string {
  if (!workflowRequestPath || SEP.test(workflowRequestPath)) throw new Error('workflowRequestPath must be a single-line path')
  return `Run the installed plan-step procedure for the workflow request at ${workflowRequestPath}`
}

/**
 * `claude -p` argv. No --bare (the installed plugin must load) and no permission-bypass flag. `--max-budget-usd` only when budgeted.
 * The tool lists are variadic, so another option must follow them: the prompt stays last, after `--verbose`.
 */
export function buildArgv(mode: 'launch' | 'resume', nativeSessionId: string, request: SessionRequest, executable = 'claude'): string[] {
  const argv = [executable, '-p', mode === 'launch' ? '--session-id' : '--resume', nativeSessionId]
  if (request.budgetUsd !== undefined) {
    if (!Number.isFinite(request.budgetUsd) || request.budgetUsd <= 0) throw new Error('budgetUsd must be a positive number')
    argv.push('--max-budget-usd', String(request.budgetUsd))
  }
  argv.push('--permission-mode', PERMISSION_MODE, '--permission-prompts', 'none',
    '--allowedTools', ALLOWED_TOOLS.join(','), '--disallowedTools', DISALLOWED_TOOLS.join(','),
    '--output-format', 'stream-json', '--verbose', buildPrompt(request.workflowRequestPath))
  return argv
}

export function createClaudeSessionAdapter(deps: AdapterDeps) {
  const tracked = new Map<string, Tracked>()
  const exe = deps.executable ?? 'claude'

  function start(argv: string[], request: SessionRequest, nativeSessionId: string): Tracked {
    const handle = deps.process.spawn(argv, { cwd: request.checkout })
    const t: Tracked = { handle, nativeSessionId, exit: { done: false, code: null }, unparseable: false }
    handle.onLine(line => {
      if (!line.trim()) return
      let ev: unknown
      try { ev = JSON.parse(line) } catch { t.unparseable = true; return }
      if (typeof ev !== 'object' || ev === null || Array.isArray(ev) || typeof (ev as { type?: unknown }).type !== 'string') { t.unparseable = true; return }
      const e = ev as { type: string; subtype?: unknown; is_error?: unknown; plugins?: unknown; permissionMode?: unknown }
      if (e.type === 'system' && e.subtype === 'init') {
        t.initOk = e.permissionMode === PERMISSION_MODE && Array.isArray(e.plugins) && e.plugins.some(p => (p as { name?: unknown } | null)?.name === PLUGIN_NAME)
        // Without the plugin or the mode the session lacks its policy: stop it rather than let it work unguarded.
        if (!t.initOk) { try { handle.kill('SIGTERM') } catch { /* the failed state below still holds */ } }
      }
      if (e.type === 'result') {
        if (typeof e.subtype !== 'string') { t.unparseable = true; return }
        t.result = { subtype: e.subtype, isError: e.is_error === true }
      }
    })
    handle.exited.then(code => { t.exit = { done: true, code } }, () => { t.exit = { done: true, code: null }; t.unparseable = true })
    tracked.set(request.orchestrationId, t)
    return t
  }

  function stateOf(orchestrationId: string, t: Tracked | undefined): SessionState['state'] {
    if (!t) return 'unknown'
    if (t.unparseable) return 'unknown'
    if (t.initOk === false) return 'failed'
    if (!t.exit.done) return 'running' // a live process is running until it exits, even after a result event
    if (t.exit.code === null) return 'unknown'
    if (t.exit.code !== 0) return 'failed'
    if (!t.result) return 'unknown' // exit 0 without a terminal result: shape not recognised, never "no session"
    if (t.result.subtype !== 'success' || t.result.isError) return 'failed'
    return t.initOk ? 'completed' : 'unknown' // success with no init seen proves nothing about the policy
  }

  async function begin(mode: 'launch' | 'resume', nativeSessionId: string, request: SessionRequest): Promise<SessionState> {
    const argv = buildArgv(mode, nativeSessionId, request, exe)
    if (request.signal?.aborted) throw new Error('launch aborted before the process started')
    // Persist the mapping before the process starts, so a crash never leaves an unmapped live session.
    await deps.store.save({ orchestrationId: request.orchestrationId, nativeSessionId })
    let t: Tracked
    try { t = start(argv, request, nativeSessionId) } catch {
      // Report unknown and never retry by itself; the mark lets a later explicit launch reuse this id.
      await deps.store.save({ orchestrationId: request.orchestrationId, nativeSessionId, spawnFailed: true })
      return { orchestrationId: request.orchestrationId, nativeSessionId, state: 'unknown' }
    }
    if (t.handle.pid !== undefined) await deps.store.save({ orchestrationId: request.orchestrationId, nativeSessionId, pid: t.handle.pid })
    return { orchestrationId: request.orchestrationId, nativeSessionId, ...(t.handle.pid !== undefined ? { pid: t.handle.pid } : {}), state: 'running' }
  }

  return {
    name: 'claude-code',

    async probe(_request: { checkout: string; requirements: string[]; signal?: AbortSignal }): Promise<SessionCapabilities> {
      const ev = deps.evidence
      const ok = !!ev && !!deps.version && ev.version === deps.version
      const f = (b: boolean | undefined) => ok && b === true
      return {
        host: 'claude-code', version: deps.version, surface: 'headless', backends: ['worktree'],
        launch: f(ev?.launched), observe: f(ev?.observed), resume: f(ev?.resumed), cancel: f(ev?.cancelled),
        budgetEnforcement: f(ev?.budgetStopSeen),
      }
    },

    async launch(request: SessionRequest): Promise<SessionState> {
      const running = tracked.get(request.orchestrationId)
      if (running) {
        if (!running.exit.done) throw new Error('launch refused: a live process already holds this orchestration id')
      } else {
        // A mapping from an earlier adapter instance: only a pid that is positively dead allows a new launch, as for resume.
        const rec = await deps.store.load(request.orchestrationId)
        if (rec && !rec.spawnFailed && (rec.pid === undefined || !deps.process.isAlive || deps.process.isAlive(rec.pid))) throw new Error('launch refused: cannot confirm the earlier process for this orchestration id has exited')
      }
      return begin('launch', deps.newId(), request)
    },

    async observe(ref: SessionRef): Promise<SessionState> {
      const t = tracked.get(ref.orchestrationId)
      const mapped = t && (ref.nativeSessionId === undefined || ref.nativeSessionId === t.nativeSessionId)
      return { ...ref, state: mapped ? stateOf(ref.orchestrationId, t) : 'unknown' }
    },

    async resume(ref: SessionRef, request: SessionRequest): Promise<SessionState> {
      const rec = await deps.store.load(ref.orchestrationId)
      if (!rec || !ref.nativeSessionId || rec.nativeSessionId !== ref.nativeSessionId || rec.orchestrationId !== ref.orchestrationId || request.orchestrationId !== ref.orchestrationId) {
        throw new Error('resume refused: no persisted mapping matches this session reference')
      }
      const t = tracked.get(ref.orchestrationId)
      if (t) {
        if (!t.exit.done) throw new Error('resume refused: a live process holds this session')
      } else {
        // Not spawned by this adapter instance: only a pid that is positively dead allows a resume.
        const pid = rec.pid ?? ref.pid
        if (pid === undefined || !deps.process.isAlive || deps.process.isAlive(pid)) throw new Error('resume refused: cannot confirm the earlier process has exited')
      }
      return begin('resume', rec.nativeSessionId, request)
    },

    async recovery(ref: SessionRef): Promise<{ available: boolean; instructions?: string[][]; reason?: string }> {
      const id = (await deps.store.load(ref.orchestrationId))?.nativeSessionId
      if (!id) return { available: false, reason: 'no persisted native session id for this orchestration' }
      if (ref.nativeSessionId && ref.nativeSessionId !== id) return { available: false, reason: 'the session reference does not match the persisted mapping' }
      const instructions: string[][] = [[exe, '--resume', id]]
      const log = deps.logPath?.(ref)
      if (log) instructions.push(['less', log])
      return { available: true, instructions }
    },

    async cancel(ref: SessionRef, _signal?: AbortSignal): Promise<{ stopped: boolean; recoveryRequired: boolean }> {
      const t = tracked.get(ref.orchestrationId)
      if (!t) return { stopped: false, recoveryRequired: true }
      if (t.exit.done) return { stopped: true, recoveryRequired: false }
      try { t.handle.kill('SIGTERM') } catch { return { stopped: false, recoveryRequired: true } }
      let timer: ReturnType<typeof setTimeout> | undefined
      const waited = await Promise.race([
        t.handle.exited.then(() => true, () => true),
        new Promise<boolean>(r => { timer = setTimeout(() => r(false), deps.cancelWaitMs ?? 10_000) }),
      ])
      if (timer) clearTimeout(timer)
      // Stopped only after the exit is observed.
      return waited && t.exit.done ? { stopped: true, recoveryRequired: false } : { stopped: false, recoveryRequired: true }
    },
  }
}
