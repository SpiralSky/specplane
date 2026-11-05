// Host-independent logic for Specplane's native Claude Code commands
// (claude:architecture/claude-integration#deterministic-command-dispatch).
// Nothing here imports the host: the engine, the bundled core and the human
// dialog arrive as ports, so the same code is exercised by `claude plugin test`
// (handlers.test.ts) and by the repository's Bun suites. No code path in this
// file can call a model: a mechanical handler has no port that reaches one.

export type CommandKind = 'mechanical' | 'confirmed' | 'reasoning'

export interface NativeCommand {
  /** The slash-command name registered with the host. */
  name: string
  /** The workflow contract it implements (architecture/agent-skills). */
  workflow: string
  kind: CommandKind
  description: string
  argumentHint: string
  /** Read-only commands answer any origin; everything else needs a direct user gesture. */
  readOnly: boolean
}

/**
 * Legacy public prompt skills each map to one native command (mechanical,
 * confirmed or reasoning). `docs` and `complete` are new shared handlers with
 * host-prefixed names so they never shadow a built-in or another plugin.
 */
export const NATIVE_COMMANDS: readonly NativeCommand[] = [
  { name: 'validate', workflow: 'validate', kind: 'mechanical', readOnly: true, description: 'Run Specplane validation (deterministic checks only)', argumentHint: '' },
  { name: 'plan-status', workflow: 'plan-status', kind: 'mechanical', readOnly: true, description: 'Show plans with live status and the next step', argumentHint: '' },
  { name: 'plan-start', workflow: 'plan-start', kind: 'mechanical', readOnly: false, description: 'Start or resume a plan checkout', argumentHint: '<plan-id> [--no-fetch] [--dry-run] [--target <branch>]' },
  { name: 'approve', workflow: 'approve', kind: 'confirmed', readOnly: false, description: 'Approve specs, plans or decision records (you confirm in a dialog)', argumentHint: '<id>... [--reopen]' },
  { name: 'plan-abandon', workflow: 'plan-abandon', kind: 'confirmed', readOnly: false, description: 'Abandon a plan after your confirmation', argumentHint: '<plan-id> [--delete-branch]' },
  { name: 'specplane-docs', workflow: 'docs', kind: 'mechanical', readOnly: true, description: 'Read the bundled Specplane documentation (offline)', argumentHint: '[topic | search <text>]' },
  { name: 'specplane-complete', workflow: 'complete', kind: 'mechanical', readOnly: false, description: 'Declare a spec implementation status', argumentHint: '<spec-id> [--status incomplete|partial|complete] [--dry-run]' },
  { name: 'spec-assist', workflow: 'spec-assist', kind: 'reasoning', readOnly: false, description: 'Write a feature spec with you', argumentHint: '<description or spec id>' },
  { name: 'spec-draft-architecture', workflow: 'spec-draft-architecture', kind: 'reasoning', readOnly: false, description: 'Draft an architecture spec from feature specs', argumentHint: '<feature spec id>...' },
  { name: 'plan-create', workflow: 'plan-create', kind: 'reasoning', readOnly: false, description: 'Create a new plan', argumentHint: '<goal>' },
  { name: 'plan-step', workflow: 'plan-step', kind: 'reasoning', readOnly: false, description: 'Execute the next step of a plan', argumentHint: '[plan-id]' },
  { name: 'plan-finish', workflow: 'plan-finish', kind: 'reasoning', readOnly: false, description: 'Run the finish flow for a plan', argumentHint: '[plan-id]' },
  { name: 'decision-new', workflow: 'decision-new', kind: 'reasoning', readOnly: false, description: 'Create a decision record from your description', argumentHint: '<decision description>' },
]

/** Reasoning commands delegate to this installed internal procedure; it is never a public command. */
export const reasoningAsset = (workflow: string): string => `.claude/skills/specplane-reason-${workflow}/SKILL.md`
/** The registered tool a delegated turn answers with; the host lists it as `mcp__<plugin>__specplane_result`. */
export const COMPLETION_TOOL = 'specplane_result'
/** PROVISIONAL (D16 A): the tool a delegated turn calls to run the reviewed suites. Its only input is `requestId`; no command, argument, directory or environment is accepted. */
export const RUN_TESTS_TOOL = 'specplane_run_tests'
/** Where the Claude package places the bundled core CLI, relative to the plugin root. */
export const BUNDLED_CLI = 'core/dist/cli.js'

export interface InventoryEntry { name: string; source: string }
export interface Unavailable { name: string; reason: string }
export interface RegistrationPlan {
  register: NativeCommand[]
  /** Names the host or another source owns; their handlers stay unavailable and the manual command is reported. */
  collisions: Array<{ name: string; owner: string; manual: string }>
  unavailable: Unavailable[]
}

const MANUAL: Record<string, string> = {
  validate: 'specplane validate',
  'plan-status': 'specplane plan list --live',
  'plan-start': 'specplane plan start <id>',
  approve: 'specplane spec approve <id> | plan approve <id> | decision accept <id>',
  'plan-abandon': 'specplane plan abandon <id>',
  'specplane-docs': 'specplane docs [topic]',
  'specplane-complete': 'specplane spec complete <id>',
}
export const manualCommand = (name: string): string => MANUAL[name] ?? `the ${name} skill with the specplane CLI`

/**
 * Decides which commands to register. Built-ins and other sources keep their
 * names (no alias, no shadowing); reasoning commands stay unavailable unless the
 * bundled core can prepare and record them with a retained lease.
 */
export function planRegistration(inventory: readonly InventoryEntry[], reasoningAvailable: boolean): RegistrationPlan {
  const owned = new Map(inventory.map(c => [c.name, c.source]))
  const plan: RegistrationPlan = { register: [], collisions: [], unavailable: [] }
  for (const cmd of NATIVE_COMMANDS) {
    const owner = owned.get(cmd.name)
    if (owner !== undefined) plan.collisions.push({ name: cmd.name, owner, manual: manualCommand(cmd.name) })
    else if (cmd.kind === 'reasoning' && !reasoningAvailable) plan.unavailable.push({ name: cmd.name, reason: 'the bundled core cannot retain a writer lease across a reasoning turn on this host' })
    else plan.register.push(cmd)
  }
  return plan
}

export interface CliResult { exitCode: number; stdout: string; stderr: string }
export type Confirmation = 'confirmed' | 'declined' | 'unavailable'

/** The mod's own bundled identity; must equal `CLAUDE_EXTENSION_ID` in packages/cli/src/harness/claude-package.ts (claude-handlers.test). */
export const CLAUDE_EXTENSION_ID = 'specplane-claude'
const SPEC_ID = /^[A-Za-z0-9_-]+:(feature|architecture)\/[a-z0-9/-]+$/
const PLAN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The WorkflowInitiation for one reasoning command, built from the raw arguments. Shapes follow the core's
 * `workflowInitiationSchema`; `plan-finish` has no core initiation today, so the core refuses it at `prepare`.
 */
export function initiationFor(workflow: string, raw: string, checkout: string): { ok: true; request: Record<string, unknown> } | { ok: false; error: string } {
  const text = raw.trim()
  const tokens = text ? text.split(/\s+/) : []
  const base = { protocol: 1, extensionId: CLAUDE_EXTENSION_ID, checkout, mode: 'attended' }
  switch (workflow) {
    case 'plan-step':
    case 'plan-finish':
      if (tokens.length !== 1 || !PLAN_ID.test(tokens[0] as string)) return { ok: false, error: `Usage: /${workflow} <plan-id>` }
      return { ok: true, request: { ...base, workflow, selection: { planId: tokens[0] } } }
    case 'spec-assist':
      if (!text) return { ok: false, error: 'Usage: /spec-assist <description or spec id>' }
      return { ok: true, request: { ...base, workflow, selection: { specIds: SPEC_ID.test(text) ? [text] : [], input: text } } }
    case 'spec-draft-architecture':
      if (!tokens.length || !tokens.every(t => SPEC_ID.test(t))) return { ok: false, error: 'Usage: /spec-draft-architecture <feature spec id>...' }
      return { ok: true, request: { ...base, workflow, selection: { specIds: tokens, input: text } } }
    case 'plan-create':
    case 'decision-new':
      if (!text) return { ok: false, error: `Usage: /${workflow} <${workflow === 'plan-create' ? 'goal' : 'decision description'}>` }
      return { ok: true, request: { ...base, workflow, selection: { specIds: [], input: text } } }
    default:
      return { ok: false, error: `/${workflow} has no reasoning initiation.` }
  }
}

/**
 * PROVISIONAL (D16 A): runs the reviewed suites of an open delegation. Only the request id leaves this function toward
 * the server; whatever else the model sent (a command, arguments, a directory, an environment) is dropped here and never
 * forwarded, and the server refuses a call that carries more. The text returned names the receipts to cite as evidence.
 */
export async function runReviewedTests(
  pending: Map<string, Delegation>,
  input: { requestId?: unknown },
  ctx: { session?: ReasoningSession },
): Promise<{ ok: boolean; text: string }> {
  const id = typeof input.requestId === 'string' ? input.requestId : ''
  if (!id || !pending.has(id)) return { ok: false, text: 'No matching open Specplane request; no test was run.' }
  if (!ctx.session) return { ok: false, text: 'Running reviewed tests is unavailable; no test was run.' }
  const reply = await send(ctx.session, 'executeTest', { requestId: id })
  return reply.ok
    ? { ok: true, text: `${reply.message}\nCite each receipt's artifact in criterionEvidence[].artifacts for the criteria it lists.` }
    : { ok: false, text: `${reply.message}\nNo test evidence was produced.` }
}

/** Turns one `$.mcp.call` result into a reply. The server's text is the core `Result` as JSON; a bind or refusal may be plain text. */
export function serverReply(r: { content?: readonly { type?: string; text?: string }[]; isError?: boolean }): ServerReply {
  const text = (r.content ?? []).map(b => (typeof b.text === 'string' ? b.text : '')).join('\n')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { ok?: unknown }).ok === 'boolean') {
    const core = parsed as { ok: boolean; value?: unknown; error?: { message?: unknown; code?: unknown; details?: unknown } }
    const message = core.ok ? text : String(core.error?.message ?? text)
    const code = typeof core.error?.code === 'string' ? core.error.code : undefined
    const details = core.error?.details
    return { ok: core.ok && r.isError !== true, value: core.value, message, ...(code ? { code } : {}), ...(details !== undefined && details !== null ? { details } : {}) }
  }
  return { ok: r.isError !== true, value: parsed ?? text, message: text }
}

/** One server call with the session nonce added. A throw becomes a refusal; it never reaches the caller as an exception. */
async function send(session: ReasoningSession, tool: string, args: Record<string, unknown>): Promise<ServerReply> {
  try {
    return await session.server.call(tool, { ...args, nonce: session.nonce })
  } catch (error) {
    return { ok: false, lost: true, message: `Specplane server call ${tool} failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Connects the server (every time) and binds the session (once). Nothing is prepared unless this succeeds. */
export async function openSession(session: ReasoningSession): Promise<ServerReply> {
  let connection: ServerConnection
  try {
    connection = await session.server.connect()
  } catch (error) {
    return { ok: false, message: `Specplane server did not connect: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!connection.connected) return { ok: false, message: connection.message }
  if (session.binding.bound) return { ok: true, message: '' }
  const bound = await send(session, 'bind', {})
  if (bound.ok) session.binding.bound = true
  return bound
}

/**
 * Releases one request's lease, or every open request of this binding when no id is given (for a result whose id
 * cannot be read). Never throws: a close that fails leaves the server's own end-of-session release.
 */
export async function closeRequest(session: ReasoningSession | undefined, requestId?: string): Promise<boolean> {
  if (!session) return false
  return (await send(session, 'close', requestId === undefined ? {} : { requestId })).ok
}

/** Closes every request this module still holds, by binding, and forgets them. Used when a result cannot be read. */
export async function releaseHeld(pending: Map<string, Delegation>, session: ReasoningSession | undefined): Promise<boolean> {
  if (pending.size === 0) return true
  pending.clear()
  return closeRequest(session)
}

/**
 * Reads a prepared request in `detail` pages, each under the host's result bound. Resolves with the parsed request, or
 * undefined when a page fails, does not advance, or the joined text is not JSON.
 */
export async function readDetail(session: ReasoningSession, requestId: string): Promise<unknown> {
  let json = ''
  let offset = 0
  for (;;) {
    const page = await send(session, 'detail', { requestId, offset })
    const value = page.ok ? page.value as { chunk?: unknown; next?: unknown; done?: unknown } | undefined : undefined
    if (!value || typeof value.chunk !== 'string' || typeof value.done !== 'boolean') return undefined
    json += value.chunk
    if (value.done) break
    if (typeof value.next !== 'number' || value.next <= offset) return undefined
    offset = value.next
  }
  try { return JSON.parse(json) } catch { return undefined }
}

/** Everything a handler may touch. There is deliberately no model port. */
export interface CorePort {
  /** Runs the bundled core CLI by argument vector (no shell). */
  cli(argv: readonly string[], signal: AbortSignal): Promise<CliResult>
}
export interface HumanPort { confirm(summary: string): Promise<Confirmation> }

/** The plugin's Specplane MCP server as `$.mcp` exposes it. `call` takes the tool's arguments as given. */
export type ServerConnection = { connected: true } | { connected: false; message: string }
/** `lost` marks a call that threw: the server may have taken a lease it could not report. */
export interface ServerReply { ok: boolean; value?: unknown; message: string; lost?: boolean; code?: string; details?: unknown }
export interface SpecplaneServer {
  connect(): Promise<ServerConnection>
  call(tool: string, args: Record<string, unknown>): Promise<ServerReply>
}
/**
 * One session's reasoning state. `nonce` is generated by the mod and sent with every server call; the
 * `tool.check` gate refuses any other call. `binding` is shared across commands so bind happens once per session.
 */
export interface ReasoningSession {
  checkout: string
  nonce: string
  server: SpecplaneServer
  binding: { bound: boolean }
}

/** A prepared reasoning request whose model part is queued until the command's hook has returned. */
export interface Delegation {
  workflow: string
  requestId: string
  assetPath: string
  request: unknown
  /** Results refused so far as correctable; see `acceptResult`. */
  refusals?: number
}
export interface RunContext {
  origin: { kind: string }
  signal: AbortSignal
  core: CorePort
  human: HumanPort
  /** Reasoning commands only. Absent means the server is not wired and reasoning refuses before preparing. */
  session?: ReasoningSession
  /** Delegations are submitted after the hook returns; the host refuses `$.prompt.submit` inside `command.run`. */
  queue: Delegation[]
}
export interface CommandOutput { text: string; exitCode?: number }

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
const ok = (text: string): CommandOutput => ({ text })
const refuse = (text: string, exitCode = 2): CommandOutput => ({ text, exitCode })
const fromCli = (r: CliResult): CommandOutput => {
  const text = [r.stdout, r.stderr].filter(s => s.trim()).join('\n').trimEnd() || (r.exitCode === 0 ? 'Done.' : `Failed with exit code ${r.exitCode}.`)
  return r.exitCode === 0 ? ok(text) : { text, exitCode: r.exitCode }
}

/** Splits raw args; accepts only listed flags. Returns an error message or the positionals and flags. */
export function parseArgs(raw: string, flags: readonly string[], valued: readonly string[] = []): { error: string } | { positionals: string[]; flags: Map<string, string | true> } {
  const tokens = raw.trim() ? raw.trim().split(/\s+/) : []
  const positionals: string[] = []
  const found = new Map<string, string | true>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string
    if (t.startsWith('-')) {
      if (valued.includes(t)) {
        const v = tokens[++i]
        if (v === undefined || v.startsWith('-')) return { error: `${t} needs a value.` }
        found.set(t, v)
      } else if (flags.includes(t)) found.set(t, true)
      else return { error: `Unsupported option ${t}. Use the manual CLI for it.` }
    } else positionals.push(t)
  }
  return { positionals, flags: found }
}

type Kind = 'spec' | 'plan' | 'decision'
/** Classifies an ID by shape: spec IDs are `[root:]feature|architecture/slug`, decisions `decision/NNNN`, plans a dated slug. */
export function kindOfId(id: string): Kind | undefined {
  if (/^decision\/\d{4}$/.test(id) || /^\d{4}$/.test(id)) return 'decision'
  if (/^([A-Za-z0-9_-]+:)?(feature|architecture)\/[A-Za-z0-9._-]+$/.test(id)) return 'spec'
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return 'plan'
  return undefined
}

async function runApprove(raw: string, ctx: RunContext): Promise<CommandOutput> {
  const parsed = parseArgs(raw, ['--reopen'])
  if ('error' in parsed) return refuse(parsed.error)
  const ids = parsed.positionals
  if (!ids.length) return refuse('Usage: /approve <id>... [--reopen]')
  const reopen = parsed.flags.has('--reopen')
  const commands: string[][] = []
  if (reopen) {
    for (const id of ids) {
      if (kindOfId(id) !== 'spec') return refuse(`--reopen applies to specs only; ${id} is not a spec ID.`)
      commands.push(['spec', 'reopen', id])
    }
  } else {
    const groups: Record<Kind, string[]> = { spec: [], plan: [], decision: [] }
    for (const id of ids) {
      const kind = ID.test(id) ? kindOfId(id) : undefined
      if (!kind) return refuse(`Cannot tell what ${id} is. Use the manual CLI.`)
      groups[kind].push(id)
    }
    if (groups.spec.length) commands.push(['spec', 'approve', ...groups.spec])
    if (groups.plan.length) commands.push(['plan', 'approve', ...groups.plan])
    if (groups.decision.length) commands.push(['decision', 'accept', ...groups.decision])
  }
  return confirmThenRun(commands, reopen ? 'Reopen' : 'Approve', ctx)
}

async function runAbandon(raw: string, ctx: RunContext): Promise<CommandOutput> {
  const parsed = parseArgs(raw, ['--delete-branch'])
  if ('error' in parsed) return refuse(parsed.error)
  const [id, ...extra] = parsed.positionals
  if (!id || extra.length || !ID.test(id)) return refuse('Usage: /plan-abandon <plan-id> [--delete-branch]')
  const argv = ['plan', 'abandon', id, ...(parsed.flags.has('--delete-branch') ? ['--delete-branch'] : [])]
  return confirmThenRun([argv], 'Abandon', ctx)
}

/** The user's own gesture plus a host dialog naming the exact commands. Nothing in the arguments can answer the dialog. */
async function confirmThenRun(commands: string[][], verb: string, ctx: RunContext): Promise<CommandOutput> {
  const lines = commands.map(c => `specplane ${c.join(' ')}`)
  const answer = await ctx.human.confirm(`${verb}? This will run:\n${lines.join('\n')}`)
  if (answer === 'unavailable') return refuse(`No confirmation dialog is available here, so nothing ran. Run it yourself:\n${lines.join('\n')}`)
  if (answer === 'declined') return ok('Cancelled; nothing changed.')
  const out: string[] = []
  for (const argv of commands) {
    if (ctx.signal.aborted) return { text: [...out, 'Cancelled before the next command.'].join('\n'), exitCode: 130 }
    const result = await ctx.core.cli(argv, ctx.signal)
    const o = fromCli(result)
    out.push(o.text)
    if (o.exitCode) return { text: out.join('\n'), exitCode: o.exitCode } // stops at the first refusal
  }
  return ok(out.join('\n'))
}

async function runDocs(raw: string, ctx: RunContext): Promise<CommandOutput> {
  const tokens = raw.trim() ? raw.trim().split(/\s+/) : []
  const argv = tokens[0] === 'search' ? ['docs', 'search', ...tokens.slice(1), '--json'] : tokens.length === 1 ? ['docs', tokens[0] as string, '--json'] : tokens.length === 0 ? ['docs', '--json'] : undefined
  if (!argv) return refuse('Usage: /specplane-docs [topic | search <text>]')
  if (argv[1]?.startsWith('-') ) return refuse('Unsupported option. Use the manual CLI.')
  const r = await ctx.core.cli(argv, ctx.signal)
  if (r.exitCode !== 0) return fromCli(r)
  return ok(renderDocs(r.stdout))
}

/** Shared topic bytes are returned unchanged; the core and docs versions are a separate host header. */
export function renderDocs(json: string): string {
  const d = JSON.parse(json) as Record<string, unknown>
  const header = `Specplane core ${String(d.version)} · docs ${String(d.docs_version)}`
  if (typeof d.content === 'string') {
    const related = Array.isArray(d.related) && d.related.length ? `\n\nRelated: ${(d.related as unknown[]).map(String).join(', ')}` : ''
    return related ? `${header}\n\n${d.content.trimEnd()}${related}` : `${header}\n\n${d.content}`
  }
  if (Array.isArray(d.items)) {
    const rows = (d.items as Array<Record<string, unknown>>).map(i => `- ${String(i.topic_id)}: ${String(i.title)}`)
    return `${header}\n\n${rows.join('\n') || 'No matching topics.'}`
  }
  return `${header}\n\n${typeof d.orientation === 'string' ? d.orientation : JSON.stringify(d)}`
}

async function runComplete(raw: string, ctx: RunContext): Promise<CommandOutput> {
  const parsed = parseArgs(raw, ['--dry-run'], ['--status'])
  if ('error' in parsed) return refuse(parsed.error)
  const [id, ...extra] = parsed.positionals
  if (!id || extra.length || !ID.test(id)) return refuse('Usage: /specplane-complete <spec-id> [--status incomplete|partial|complete] [--dry-run]')
  const status = parsed.flags.get('--status')
  if (status !== undefined && !['incomplete', 'partial', 'complete'].includes(String(status))) return refuse('--status must be incomplete, partial or complete.')
  const dry = parsed.flags.has('--dry-run') ? ['--dry-run'] : []
  const argv = status === undefined ? ['spec', 'complete', id, ...dry] : ['spec', 'implementation', id, '--status', String(status), ...dry]
  return fromCli(await ctx.core.cli(argv, ctx.signal))
}

async function runPlanStart(raw: string, ctx: RunContext): Promise<CommandOutput> {
  const parsed = parseArgs(raw, ['--no-fetch', '--dry-run'], ['--target'])
  if ('error' in parsed) return refuse(parsed.error)
  const [id, ...extra] = parsed.positionals
  if (!id || extra.length || !ID.test(id)) return refuse('Usage: /plan-start <plan-id> [--no-fetch] [--dry-run] [--target <branch>]')
  const argv = ['plan', 'start', id, ...[...parsed.flags].flatMap(([k, v]) => (v === true ? [k] : [k, v]))]
  return fromCli(await ctx.core.cli(argv, ctx.signal))
}

/**
 * Connect, bind once, prepare; then queue the model's part. The lease is held by the server from `prepare` until
 * `close`, which `acceptResult` sends at the end of the request, or which the turn's submit failure sends.
 */
async function runReasoning(cmd: NativeCommand, raw: string, ctx: RunContext): Promise<CommandOutput> {
  const session = ctx.session
  if (!session) return refuse(`/${cmd.name} is unavailable here: reasoning delegation needs the Specplane server. Use ${manualCommand(cmd.name)}.`)
  const initiation = initiationFor(cmd.workflow, raw, session.checkout)
  if (!initiation.ok) return refuse(initiation.error)
  const opened = await openSession(session)
  if (!opened.ok) return refuse(`${opened.message} Nothing was delegated.`, 1)
  const prepared = await send(session, 'prepare', initiation.request)
  const requestId = (prepared.value as { requestId?: unknown } | undefined)?.requestId
  if (typeof requestId !== 'string') {
    // A refusal took no lease. A lost call, or a reply that cannot be read, may have taken one: close every request of this binding.
    if (prepared.ok || prepared.lost) await closeRequest(session)
    return refuse(`${prepared.message} Nothing was delegated.`, 1)
  }
  const request = ctx.signal.aborted ? undefined : await readDetail(session, requestId)
  if (ctx.signal.aborted || request === undefined) {
    await closeRequest(session, requestId)
    return ctx.signal.aborted
      ? refuse('Cancelled; the prepared request was closed and nothing was delegated.', 130)
      : refuse('The prepared request could not be read; it was closed and nothing was delegated.', 1)
  }
  ctx.queue.push({ workflow: cmd.workflow, requestId, assetPath: reasoningAsset(cmd.workflow), request })
  return ok(`Prepared ${cmd.workflow} request ${requestId}; the reasoning procedure starts next.`)
}

/** Text of the extension-origin prompt (submitted without `asUser`, so it carries no human authority). */
/**
 * A schema-valid `WorkflowResult` for one request, with its identity and criteria filled in, for the model to start
 * from. It says `blocked`, so a template sent back unchanged claims nothing.
 */
export function resultTemplate(d: Delegation): Record<string, unknown> {
  const request = (typeof d.request === 'object' && d.request !== null ? d.request : {}) as { base?: { digest?: unknown }; criteria?: unknown }
  const criteria = Array.isArray(request.criteria) ? request.criteria as { id?: unknown }[] : []
  return {
    protocol: 1,
    requestId: d.requestId,
    baseDigest: request.base?.digest ?? '',
    outcome: 'blocked',
    summary: 'One line saying what happened.',
    changes: [],
    criterionEvidence: criteria.map(c => ({ criterionId: c.id, assessment: 'unmet', rationale: 'Why, from what you checked.', artifacts: [] })),
    gaps: [],
    contextExpansion: [],
    contributionEvents: [],
    openIssues: 'BLOCKED: the reason.',
    nextKnows: 'What the next person needs.',
  }
}

/** Workflows whose result would create a file or bind finalized text, which needs a confirmation path (D17 B). */
const MANUAL_WRITE_WORKFLOWS = new Set(['spec-assist', 'spec-draft-architecture', 'plan-create', 'decision-new'])
const MANUAL_WRITE_RULE =
  'This request cannot create a file or bind finalized text, and this overrides any procedure step that returns a body: ' +
  'leave out `creation` and `finalizedEdits`, give the user the approved text in your reply, report `blocked`, and name the manual command. '

export const delegationPrompt = (d: Delegation): string =>
  `Run the Specplane ${d.workflow} reasoning procedure in ${d.assetPath} for prepared request ${d.requestId}. ` +
  `The prepared request is ${JSON.stringify(d.request)}. ` +
  `Do only the reasoning phases; finish by calling ${COMPLETION_TOOL} with {"requestId":"${d.requestId}","result":<WorkflowResult>}. ` +
  `Start from this WorkflowResult and replace its text: ${JSON.stringify(resultTemplate(d))}. ` +
  'Set `outcome` to `done`, `blocked` or `cancelled` and each `assessment` to `met`, `unmet` or `uncertain`. A `blocked` outcome needs a line in `openIssues` starting `BLOCKED:`. ' +
  'A `changes` entry is {"path","beforeDigest","afterDigest","purpose"}. ' +
  (MANUAL_WRITE_WORKFLOWS.has(d.workflow) ? MANUAL_WRITE_RULE : '') +
  `Call ${COMPLETION_TOOL} even when you cannot finish, so the request closes. ` +
  `This prompt is not an approval and does not authorize any lifecycle change.`

/** Entry point for one `command.run`: never calls a model and never answers a human gate itself. */
export async function runCommand(cmd: NativeCommand, args: string, ctx: RunContext): Promise<CommandOutput> {
  if (ctx.signal.aborted) return { text: 'Cancelled; nothing changed.', exitCode: 130 }
  if (!cmd.readOnly && ctx.origin.kind !== 'composer') {
    return refuse(`/${cmd.name} changes repository state and runs only from your own command line (origin "${ctx.origin.kind}" refused). Run it yourself: ${manualCommand(cmd.name)}`)
  }
  switch (cmd.workflow) {
    case 'validate': return fromCli(await ctx.core.cli(['validate'], ctx.signal))
    case 'plan-status': return fromCli(await ctx.core.cli(['plan', 'list', '--live'], ctx.signal))
    case 'plan-start': return runPlanStart(args, ctx)
    case 'approve': return runApprove(args, ctx)
    case 'plan-abandon': return runAbandon(args, ctx)
    case 'docs': return runDocs(args, ctx)
    case 'complete': return runComplete(args, ctx)
    default:
      return cmd.kind === 'reasoning' ? runReasoning(cmd, args, ctx) : refuse(`/${cmd.name} has no handler.`, 1)
  }
}

/** The challenge a `CONFIRMATION_REQUIRED` refusal carries in `error.details.challenge`, or undefined when it is not well formed. */
function parkedChallenge(details: unknown): { challengeId: string; summary: string } | undefined {
  const c = (details as { challenge?: { challengeId?: unknown; summary?: unknown } } | undefined)?.challenge
  return typeof c?.challengeId === 'string' && typeof c.summary === 'string' ? { challengeId: c.challengeId, summary: c.summary } : undefined
}

/** Results one request may submit. A correctable refusal leaves the request open until this many have been refused. */
export const MAX_RESULT_ATTEMPTS = 3

/** A refusal's message as a sentence, followed by what became of the request. */
function refused(message: string, next: string): { ok: false; text: string } {
  return { ok: false, text: `${message.replace(/\.?\s*$/, '.')} Nothing was recorded. ${next}` }
}
const REQUEST_ENDED = 'This request has ended; rerun the command to try again.'

/**
 * Accepts the completion tool's input. A result for an unknown or already-settled request is refused.
 * Otherwise the server validates the result against the prepared request and records the proposal. An
 * `INVALID_EVIDENCE` refusal is correctable and changes nothing in the core, so the request stays open for a
 * corrected result, up to `MAX_RESULT_ATTEMPTS` (D23). Every other outcome closes the request's lease. Recording
 * gates that need a human are the core's.
 */
export async function acceptResult(
  pending: Map<string, Delegation>,
  input: { requestId?: unknown; result?: unknown },
  ctx: { session?: ReasoningSession; human?: HumanPort; newInteractionId?: () => string },
): Promise<{ ok: boolean; text: string }> {
  const id = typeof input.requestId === 'string' ? input.requestId : ''
  const delegation = pending.get(id)
  if (!delegation) {
    // An unreadable id cannot name its lease, so every delegation this module holds is closed.
    if (!id && pending.size > 0) {
      const closed = await releaseHeld(pending, ctx.session)
      return { ok: false, text: closed
        ? 'The result names no prepared request; the open Specplane requests were closed. Nothing was recorded.'
        : 'The result names no prepared request; closing the open Specplane requests failed, so they may still be open until the session ends. Nothing was recorded.' }
    }
    return { ok: false, text: 'No matching prepared Specplane request; nothing was recorded.' }
  }
  pending.delete(id)
  const session = ctx.session
  if (!session) return { ok: false, text: 'Recording is unavailable; nothing was recorded.' }
  try {
    // The server validates against the request it holds for this id; the request is not sent back.
    const validated = await send(session, 'validate', { requestId: id, result: input.result })
    if (!validated.ok) {
      const refusals = (delegation.refusals ?? 0) + 1
      const left = MAX_RESULT_ATTEMPTS - refusals
      if (validated.code !== 'INVALID_EVIDENCE' || left < 1) return refused(validated.message, REQUEST_ENDED)
      delegation.refusals = refusals
      pending.set(id, delegation)
      return refused(validated.message, `The request is still open: correct the result and call this tool again with the same requestId (${left} ${left === 1 ? 'attempt' : 'attempts'} left).`)
    }
    const proposal = validated.value as Record<string, unknown>
    let recorded = await send(session, 'record', proposal)
    // PROVISIONAL (D17 A, awaiting approval of the proposal's A6): finalized content parks a challenge on the server;
    // the user answers it in the mod's own dialog and a second `record` call carries the response.
    const challenge = recorded.code === 'CONFIRMATION_REQUIRED' ? parkedChallenge(recorded.details) : undefined
    if (!recorded.ok && challenge) {
      if (!ctx.human) return refused('Confirmation is unavailable here', `Run the manual command instead. ${REQUEST_ENDED}`)
      const answer = await ctx.human.confirm(challenge.summary)
      if (answer === 'unavailable') return refused('Nobody could be asked to confirm this content', `Run the manual command instead. ${REQUEST_ENDED}`)
      const interactionId = (ctx.newInteractionId ?? (() => globalThis.crypto.randomUUID()))()
      recorded = await send(session, 'record', { ...proposal, confirmation: { challengeId: challenge.challengeId, decision: answer === 'confirmed' ? 'confirm' : 'decline', interactionId } })
      if (!recorded.ok && answer === 'declined') return refused('You declined the content', REQUEST_ENDED)
    }
    if (!recorded.ok) return refused(recorded.message, REQUEST_ENDED)
    return { ok: true, text: `Recorded the ${delegation.workflow} result.` }
  } finally {
    if (!pending.has(id)) await closeRequest(session, id)
  }
}
