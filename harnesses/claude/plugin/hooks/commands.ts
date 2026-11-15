// Host-independent logic for the Specplane slash commands in Claude Code
// (harnesses/claude/specifications/architecture/claude-integration §3, reference-cli §12.2). Nothing here imports the
// host: the core arrives as a port, so the same code is exercised by the repository's Bun suite. A command typed with
// no arguments runs its `[code]` steps through `specplane harness run` and never makes a model turn; a command that
// needs the assistant and has arguments is handed to its skill with those arguments.

export interface SlashCommand {
  /** The slash-command name registered with the host, also the command contract and the `specplane-<name>` skill. */
  name: string
  description: string
  argumentHint: string
  /** With arguments, the command is handed to the assistant (the user-command runner would only pass it on). */
  modelWithArgs: boolean
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'spec-assist', description: 'Write a feature spec with you', argumentHint: '<spec or description>', modelWithArgs: true },
  { name: 'spec-draft-architecture', description: 'Draft an architecture spec from feature specs', argumentHint: '<feature spec id>...', modelWithArgs: true },
  { name: 'plan-create', description: 'Create a new plan', argumentHint: '<what the plan is for>', modelWithArgs: true },
  { name: 'plan-start', description: 'Start a plan and open its session', argumentHint: '<plan-id>', modelWithArgs: false },
  { name: 'plan-step', description: 'Execute the next step of a plan', argumentHint: '[plan-id]', modelWithArgs: true },
  { name: 'plan-finish', description: 'Run the final review of a plan', argumentHint: '[plan-id]', modelWithArgs: true },
  { name: 'plan-abandon', description: 'Abandon a plan after your confirmation', argumentHint: '<plan-id>', modelWithArgs: true },
  { name: 'plan-status', description: 'Show plans with live status and the next step', argumentHint: '[plan-id]', modelWithArgs: false },
  { name: 'validate', description: 'Run Specplane validation', argumentHint: '[scope]', modelWithArgs: true },
  { name: 'verify', description: 'Judge an architecture spec against its implementation', argumentHint: '<architecture spec id>', modelWithArgs: true },
  { name: 'approve', description: 'Approve specs, plans or decision records by ID', argumentHint: '<id>...', modelWithArgs: false },
  { name: 'spec-view', description: 'View a spec and what changed since its last approval', argumentHint: '[spec id]', modelWithArgs: false },
  { name: 'decision-new', description: 'Record a decision you made as a decision record', argumentHint: '[what was decided]', modelWithArgs: true },
  { name: 'spec-review', description: 'Review specs read-only and discuss problems, gaps and wording', argumentHint: '[spec id... | all]', modelWithArgs: true },
  { name: 'migrate', description: 'Bring an existing project into Specplane', argumentHint: '[what to migrate from]', modelWithArgs: true },
  { name: 'requests', description: 'Show the requests waiting for you', argumentHint: '[list | show <id> | accept <id> | decline <id>]', modelWithArgs: false },
]

/** The bundled core, as the plugin ships it; the host has no shell, so the process is run through the engine. */
export const BUNDLED_CLI = 'core/dist/cli.js'

export interface CliResult { exitCode: number; stdout: string; stderr: string }
export interface CorePort { run(argv: string[], signal?: AbortSignal): Promise<CliResult> }
export interface CommandOutput { text: string; exitCode?: number }
export interface CommandOutcome { output: CommandOutput; /** Text to submit to the assistant after this command's turn. */ prompt?: string }

/** Split typed arguments on spaces, keeping single or double quoted text together (quotes removed). */
export function splitArgs(raw: string): string[] {
  const out: string[] = []
  let word = ''
  let quote = ''
  let inWord = false
  for (const c of raw) {
    if (quote) { if (c === quote) quote = ''; else word += c; continue }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue }
    if (/\s/.test(c)) { if (inWord) out.push(word); word = ''; inWord = false; continue }
    word += c; inWord = true
  }
  if (inWord) out.push(word)
  return out
}

/** The one line handed to the assistant: the skill to use and the arguments as typed, as data. */
export function skillPrompt(name: string, args: string[]): string {
  return `Use the specplane-${name} skill. Arguments: ${JSON.stringify(args)}`
}

export interface AskPort { ask(question: string, options: string[] | { options: string[]; header?: string; multiSelect?: boolean }): Promise<string> }

/** The dialogue shows at most this many diff lines; the rest is named, not dropped silently. */
export const DIFF_LINE_LIMIT = 60
export const DIALOGUE_LABELS = ['Accept', 'Decline', 'Skip'] as const
export const ANSWER_LINE = 'Answer with /requests accept <id> or /requests decline <id>.'

export interface RequestView {
  id: string; state?: string; reason?: string; diff?: string | null
  from?: { role?: string }; action?: { command?: string }
}

/** The text of one dialogue: sender, action, reason and, for a spec request, the diff as stored (`-`/`+` lines). */
export function dialogueText(r: RequestView): string {
  const lines = [`Request ${r.id} from ${r.from?.role ?? 'unknown'}: ${r.action?.command ?? 'unknown action'}`, `Reason: ${r.reason ?? ''}`]
  if (typeof r.diff === 'string' && r.diff.trim() !== '') {
    const d = r.diff.replace(/\n$/, '').split('\n')
    lines.push('', ...d.slice(0, DIFF_LINE_LIMIT))
    if (d.length > DIFF_LINE_LIMIT) lines.push(`... ${d.length - DIFF_LINE_LIMIT} more lines; see \`specplane requests show ${r.id}\``)
  }
  return lines.join('\n')
}

const asText = (r: CliResult): string => [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n')

/**
 * Open the dialogue for each request in turn. Returns the output lines of the answers, or `null` when the dialogue was
 * unavailable, dismissed or answered with something that is not a label (the caller then falls back to the text list).
 */
export async function runDialogue(requests: RequestView[], ask: AskPort, core: CorePort, signal?: AbortSignal): Promise<string[] | null> {
  const out: string[] = []
  for (const r of requests) {
    let answer: string
    try { answer = await ask.ask(dialogueText(r), { options: [...DIALOGUE_LABELS], header: 'Request' }) } catch { return null }
    if (answer !== 'Accept' && answer !== 'Decline' && answer !== 'Skip') return null
    if (answer === 'Skip') { out.push(`Skipped ${r.id}; it stays pending.`); continue }
    try {
      const res = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', answer === 'Accept' ? 'accept' : 'decline', r.id], signal)
      out.push(asText(res) || `${answer} ${r.id}: done.`)
    } catch (e) { out.push(`Could not ${answer.toLowerCase()} ${r.id}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  return out
}

/** The pending requests from `requests list --json`, or null when the core did not give a usable list. */
async function pendingRequests(core: CorePort, signal?: AbortSignal): Promise<RequestView[] | null> {
  try {
    const r = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', 'list', '--json'], signal)
    if (r.exitCode !== 0) return null
    const data = (JSON.parse(r.stdout) as { data?: unknown }).data
    return Array.isArray(data) ? (data as RequestView[]).filter(x => x && x.state === 'pending') : null
  } catch { return null }
}

/** The id of the request a `request.send` reply says was created, else undefined. */
export function createdRequestId(action: string, replyText: string): string | undefined {
  if (action !== 'request_send' && action !== 'request.send') return undefined
  try {
    const b = JSON.parse(replyText) as { ok?: unknown; request?: unknown }
    return b.ok === true && typeof b.request === 'string' && b.request ? b.request : undefined
  } catch { return undefined }
}

/** The arrival dialogue: after a reply that created a request, ask about it. Never throws; the reply is not touched. */
export async function arrivalDialogue(action: string, replyText: string, ask: AskPort, core: CorePort, log: (m: string) => void): Promise<void> {
  try {
    const id = createdRequestId(action, replyText)
    if (!id) return
    const r = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', 'show', id, '--json'])
    if (r.exitCode !== 0) return
    const rec = (JSON.parse(r.stdout) as { data?: RequestView | null }).data
    if (!rec || rec.state !== 'pending') return
    const lines = await runDialogue([rec], ask, core)
    if (lines) for (const l of lines) log(l)
  } catch (e) { log(`specplane: the request dialogue failed: ${e instanceof Error ? e.message : String(e)}`) }
}

/** Run one typed command. Nothing here can call a model; a prompt is only returned for the host to submit. */
export async function dispatch(cmd: SlashCommand, rawArgs: string, core: CorePort, signal?: AbortSignal, ask?: AskPort): Promise<CommandOutcome> {
  const args = splitArgs(rawArgs)
  if (cmd.name === 'requests' && args.length === 0 && ask) {
    const pending = await pendingRequests(core, signal)
    if (pending && pending.length === 0) return { output: { text: 'No requests waiting.' } }
    if (pending) {
      const lines = await runDialogue(pending, ask, core, signal)
      if (lines) return { output: { text: lines.join('\n') } }
      const plain = await dispatch(cmd, rawArgs, core, signal)
      return { output: { ...plain.output, text: `${plain.output.text}\n${ANSWER_LINE}` } }
    }
  }
  if (cmd.modelWithArgs && args.length > 0) {
    return { output: { text: `/${cmd.name}: handing your arguments to the assistant.` }, prompt: skillPrompt(cmd.name, args) }
  }
  let r: CliResult
  try { r = await core.run(['harness', 'run', '--adapter', 'claude', cmd.name, ...args], signal) } catch (e) {
    return { output: { text: `/${cmd.name} could not run the Specplane core: ${e instanceof Error ? e.message : String(e)}`, exitCode: 1 } }
  }
  const text = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n') || `/${cmd.name}: done.`
  return { output: r.exitCode === 0 ? { text } : { text, exitCode: r.exitCode } }
}
