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

/** Run one typed command. Nothing here can call a model; a prompt is only returned for the host to submit. */
export async function dispatch(cmd: SlashCommand, rawArgs: string, core: CorePort, signal?: AbortSignal): Promise<CommandOutcome> {
  const args = splitArgs(rawArgs)
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
