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
export interface PreparedRequest { ok: true; requestId: string; requestPath: string }
export interface Refused { ok: false; message: string }

/** Everything a handler may touch. There is deliberately no model port. */
export interface CorePort {
  /** Runs the bundled core CLI by argument vector (no shell). */
  cli(argv: readonly string[], signal: AbortSignal): Promise<CliResult>
  /** Reasoning workflows only: prepare through the core and hold its lease. */
  prepare?(workflow: string, args: string, signal: AbortSignal): Promise<PreparedRequest | Refused>
  /** Validate and record a `WorkflowResult`; human gates inside go through `human`. */
  record?(requestId: string, result: unknown, human: HumanPort, signal: AbortSignal): Promise<{ ok: boolean; text: string }>
  cancel?(requestId: string): Promise<void>
}
export interface HumanPort { confirm(summary: string): Promise<Confirmation> }
export interface Delegation { workflow: string; requestId: string; requestPath: string; assetPath: string }
export interface RunContext {
  origin: { kind: string }
  signal: AbortSignal
  core: CorePort
  human: HumanPort
  /** Delegations are submitted from `turn.complete`; the host refuses `$.prompt.submit` inside `command.run`. */
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

async function runReasoning(cmd: NativeCommand, raw: string, ctx: RunContext): Promise<CommandOutput> {
  if (!ctx.core.prepare || !ctx.core.record) return refuse(`/${cmd.name} is unavailable here: reasoning delegation needs the bundled core. Use ${manualCommand(cmd.name)}.`)
  const prepared = await ctx.core.prepare(cmd.workflow, raw, ctx.signal)
  if (!prepared.ok) return refuse(`${prepared.message} Nothing was delegated.`, 1)
  ctx.queue.push({ workflow: cmd.workflow, requestId: prepared.requestId, requestPath: prepared.requestPath, assetPath: reasoningAsset(cmd.workflow) })
  return ok(`Prepared ${cmd.workflow} request ${prepared.requestId}; the reasoning procedure starts when this turn completes.`)
}

/** Text of the extension-origin prompt (submitted without `asUser`, so it carries no human authority). */
export const delegationPrompt = (d: Delegation): string =>
  `Run the Specplane ${d.workflow} reasoning procedure in ${d.assetPath} for prepared request ${d.requestId} (${d.requestPath}). ` +
  `Do only the reasoning phases; finish by calling ${COMPLETION_TOOL} with {"requestId":"${d.requestId}","result":<WorkflowResult>}. ` +
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

/**
 * Accepts the completion tool's input. A result for an unknown or already-settled
 * request is refused; recording (and any human gate it needs) is the core's.
 */
export async function acceptResult(
  pending: Map<string, Delegation>,
  input: { requestId?: unknown; result?: unknown },
  ctx: Pick<RunContext, 'core' | 'human' | 'signal'>,
): Promise<{ ok: boolean; text: string }> {
  const id = typeof input.requestId === 'string' ? input.requestId : ''
  if (!pending.has(id)) return { ok: false, text: 'No matching prepared Specplane request; nothing was recorded.' }
  if (!ctx.core.record) return { ok: false, text: 'Recording is unavailable; nothing was recorded.' }
  pending.delete(id)
  return ctx.core.record(id, input.result, ctx.human, ctx.signal)
}
