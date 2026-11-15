// Binds the Specplane slash commands (./commands) to the Claude Code engine. Host calls used here: command.list,
// command.register, command.run, process.run, prompt.submit, clock.after and ui.log.
import type { EngineInterface, Register } from 'claude-code'
import { BUNDLED_CLI, dispatch, SLASH_COMMANDS } from './commands'
import type { AskPort, CorePort, PushPort, SlashCommand } from './commands'

/** Runs the bundled core through the host's process API; the plugin has no shell. */
export function bundledCore($: EngineInterface): CorePort {
  return {
    async run(argv, signal) {
      if (signal?.aborted) return { exitCode: 130, stdout: '', stderr: 'cancelled' }
      const r = await $.process.run(['node', `${$.plugin.root}/${BUNDLED_CLI}`, ...argv], { timeoutMs: 120_000 })
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
  }
}

/** The host's question dialogue as a port; it rejects when dismissed or in a `-p` run. */
export function hostAsk($: EngineInterface): AskPort {
  return { ask: (question, options) => $.ui.ask(question, Array.isArray(options) ? options : { options: options.options, ...(options.header ? { header: options.header } : {}) } as never) }
}

/** The host's push notification channel as a port (`root:requests R52.5`). */
export function hostPush($: EngineInterface): PushPort {
  return {
    notify: async (text, o) => { const r = await $.ui.notify(text, { title: o.title, key: o.key }); return { isSent: r.isSent === true } },
    cancel: key => $.ui.cancelNotify(key),
  }
}

/** Names this module registered; a command.run for any other name passes through to its owner. */
const registered = new Set<string>()

/** How long after a command's hook returns its prompt is submitted; the hook must have let go of its turn. */
export const PROMPT_DELAY_MS = 100

function bindCommand(on: Parameters<Register>[0], cmd: SlashCommand): void {
  on('command.run', { command: cmd.name }, async ($, e, next) => {
    if (!registered.has(cmd.name)) return next(e) // not ours: the host or another plugin owns the name
    const outcome = await dispatch(cmd, (e as { args?: string }).args ?? '', bundledCore($), next.signal, hostAsk($))
    const prompt = outcome.prompt
    if (prompt) {
      // No asUser: the prompt never carries human authority, so the assistant acts under its own role.
      try { $.clock.after(PROMPT_DELAY_MS, () => { void $.prompt.submit({ text: prompt }).catch(() => $.ui.log(`specplane: /${cmd.name} could not start its skill`, { to: 'transcript' })) }) }
      catch { $.ui.log(`specplane: /${cmd.name} could not schedule its skill; ask for it in your next prompt`, { to: 'transcript' }) }
    }
    return outcome.output
  }).catch(() => ({ text: `/${cmd.name} failed; nothing changed`, exitCode: 1 }))
}

export function registerNative(on: Parameters<Register>[0]): void {
  for (const cmd of SLASH_COMMANDS) bindCommand(on, cmd)
}

/** Registers every command whose name is free, reporting collisions; each registration fails alone. */
export async function startNative($: EngineInterface, _cwd: string): Promise<void> {
  let inventory
  try { inventory = await $.command.list() } catch {
    $.ui.log('specplane: command inventory unavailable; the slash commands stay off (ask for the skills by name)', { to: 'debug' })
    return
  }
  const taken = new Map(inventory.map(c => [c.name, c.source] as const))
  for (const cmd of SLASH_COMMANDS) {
    if (taken.has(cmd.name)) { $.ui.log(`specplane: /${cmd.name} is owned by ${taken.get(cmd.name)}; the Specplane handler is off for it`, { to: 'debug' }); continue }
    try {
      await $.command.register({ name: cmd.name, description: cmd.description, argumentHint: cmd.argumentHint })
      registered.add(cmd.name)
    } catch {
      $.ui.log(`specplane: registering /${cmd.name} failed; the others are unaffected`, { to: 'debug' })
    }
  }
}
