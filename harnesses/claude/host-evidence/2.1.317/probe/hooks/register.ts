// Host-surface probe for claude-delivery step 01. Evidence only: it is never
// shipped or installed. It calls each host API that
// claude:architecture/claude-integration relies on, so `tsc` against the
// named version's declarations and `claude plugin validate` prove the
// signatures, and probe.test.ts exercises the interaction rules offline.
import type { CommandInfo, EngineInterface, Register } from 'claude-code'

export const PROBE_COMMANDS = ['specplane-probe', 'approve'] as const
export const COMPLETION_TOOL = 'probe_result'

/** Names the probe may register: none owned by a built-in or another source. */
export function registrable(
  wanted: readonly string[],
  inventory: readonly CommandInfo[],
): { register: string[]; collisions: CommandInfo[] } {
  const owned = new Map(inventory.map(c => [c.name, c]))
  const register: string[] = []
  const collisions: CommandInfo[] = []
  for (const name of wanted) {
    const owner = owned.get(name)
    if (owner) collisions.push(owner)
    else register.push(name)
  }
  return { register, collisions }
}

/** Builds a headless launch argv for the session adapter (route B). Never run here. */
export function launchArgv(sessionId: string, budgetUsd: number, resume: boolean): string[] {
  return [
    'claude', '-p',
    resume ? '--resume' : '--session-id', sessionId,
    '--max-budget-usd', String(budgetUsd),
    '--output-format', 'stream-json', '--verbose',
  ]
}

async function confirm($: EngineInterface, challenge: string): Promise<'confirmed' | 'declined' | 'unavailable'> {
  try {
    const answer = await $.ui.ask(`Confirm Specplane challenge ${challenge}?`, ['Confirm', 'Cancel'])
    return answer === 'Confirm' ? 'confirmed' : 'declined'
  } catch {
    return 'unavailable' // dismissed, or a -p run with no one to ask
  }
}

export const register: Register = on => {
  const pending: string[] = []

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      for (const request of pending.splice(0)) {
        // Extension-origin prompt: no asUser, so it never carries human authority.
        void $.prompt.submit({ text: `Prepared request ${request}; answer with ${COMPLETION_TOOL}.` })
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { register: names, collisions } = registrable(PROBE_COMMANDS, await $.command.list())
    for (const owner of collisions) {
      $.ui.log(`specplane-probe: /${owner.name} is owned by ${owner.source}; use the manual CLI`, { to: 'debug' })
    }
    for (const name of names) {
      try {
        await $.command.register({ name, description: 'Specplane host probe', argumentHint: '[mechanical|confirm|delegate|identity|launch]' })
      } catch {
        $.ui.log(`specplane-probe: registering /${name} failed`, { to: 'debug' })
      }
    }
    await $.tool.register({
      name: COMPLETION_TOOL,
      description: 'Return a structured WorkflowResult for the prepared Specplane request.',
      inputSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'] },
      isDeferred: false,
    })
    return result
  })

  on('command.run', { command: 'specplane-probe' }, async ($, e, next) => {
    const [verb = 'mechanical', arg = ''] = e.args.trim().split(/\s+/)
    if (e.origin.kind !== 'composer') {
      return { text: `refused: origin ${e.origin.kind} is not a direct user gesture` }
    }
    if (next.signal.aborted) return { text: 'cancelled' }
    switch (verb) {
      case 'mechanical':
        return { text: `mechanical ok (engine ${(await $.session.version()).version})` }
      case 'confirm':
        return { text: `confirmation: ${await confirm($, arg)}` }
      case 'delegate':
        // The host refuses $.prompt.submit inside command.run (it would wait on
        // the turn this hook holds), so the prepared request is queued and
        // submitted from turn.complete.
        pending.push(arg)
        return { text: 'delegation queued' }
      case 'launch': {
        // Route A observation plus route B launch by argv; never run by tests.
        const agents = await $.agent.list()
        $.process.spawn({ argv: launchArgv(await $.session.id(), 0.5, agents.length > 0) })
        return { text: 'launched' }
      }
      case 'identity':
        return { text: `session ${await $.session.id()} model ${await $.session.model()}` }
      default:
        return { text: `unknown verb ${verb}`, exitCode: 2 }
    }
  }).catch(() => ({ text: 'specplane-probe failed; nothing changed', exitCode: 1 }))

  on('tool.call', { tool: 'mcp__specplane-host-probe__probe_result' }, async (_$, e) => ({
    result: { accepted: true, agentId: e.agentId ?? 'main' },
  })).catch(() => ({ deny: 'probe_result could not be validated' }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    // Action-time identity: the loop id is on the call; the model is resolved per loop.
    const loop = e.agentId ?? 'main'
    const model = e.agentId ? undefined : await $.session.model()
    $.ui.log(`specplane-probe: Edit by ${loop} model ${model ?? 'from agent.spawn'}`, { to: 'debug' })
    return next(e)
  }).catch(($, e, next) => next(e)) // observation only: a capture failure never blocks an edit

  on('agent.spawn', async (_$, e, next) => {
    const started = await next(e)
    if (!started.deny) {
      // Route A evidence: cwd, resume and the resolved model of a started loop.
      void [e.cwd, e.resume?.agentId, started.model, started.agentId]
    }
    return started
  }).catch(($, e, next) => next(e))
}
