// Offline interaction evidence for Claude Code 2.1.317 (`claude plugin test`).
// Hooks registered with the test's `on` stand for the engine beneath the mod.
import { expect, test } from 'claude-code/testing'

const PRESENTATION = { isFullscreen: false, columns: 100 }
const COMPOSER = { kind: 'composer' } as const

function engine(on: any, opts: { inventory?: any[]; failRegister?: string } = {}) {
  const seen = { registered: [] as string[], tools: [] as string[], model: 0, submits: [] as any[] }
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: opts.inventory ?? [] }))
  on('command.register', (_: any, e: any) => {
    if (e.name === opts.failRegister) throw new Error('host refused')
    seen.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.register', (_: any, e: any) => {
    seen.tools.push(e.name)
    return { value: { tool: e.name } }
  })
  on('session.version', () => ({ value: { version: '2.1.317' } }))
  for (const ev of ['model.complete', 'model.fork', 'model.classify']) {
    on(ev, () => {
      seen.model++
      return { value: { isAnswered: false, reason: 'aborted' } }
    })
  }
  on('prompt.submit', (_: any, e: any) => {
    seen.submits.push(e)
    return { text: e.text }
  })
  on('ui.log', () => ({ value: undefined }))
  return seen
}

async function start($: any) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

function run($: any, args: string, origin: any = COMPOSER) {
  return $.command.run({ command: 'specplane-probe', args, origin, presentation: PRESENTATION })
}

test('registers only names the inventory does not own, and the completion tool', async ($, on) => {
  const seen = engine(on, { inventory: [{ name: 'approve', description: 'host', source: 'builtin' }] })
  await start($)
  expect(seen.registered).toEqual(['specplane-probe'])
  expect(seen.tools).toEqual(['probe_result'])
})

test('one failed registration does not skip the others', async ($, on) => {
  const seen = engine(on, { failRegister: 'specplane-probe' })
  await start($)
  expect(seen.registered).toEqual(['approve'])
})

test('a mechanical command answers with text and makes no model call', async ($, on) => {
  const seen = engine(on)
  await start($)
  const out = await run($, 'mechanical')
  expect(out.text).toBe('mechanical ok (engine 2.1.317)')
  expect(seen.model).toBe(0)
  expect(seen.submits.length).toBe(0)
})

test('a command not from a direct user gesture is refused', async ($, on) => {
  engine(on)
  await start($)
  const out = await run($, 'confirm c1', { kind: 'plugin', name: 'other' })
  expect(out.text).toBe('refused: origin plugin is not a direct user gesture')
})

test('confirmation uses the host dialog; a refusal to ask means unavailable', async ($, on) => {
  engine(on)
  let answer: string | undefined = 'Confirm'
  // $.ui.ask is raised as a tool.call of AskUserQuestion, not an event of its own.
  on('tool.call', { tool: 'AskUserQuestion' }, (_: any, e: any) => {
    if (answer === undefined) throw new Error('no one to ask')
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } } }
  })
  await start($)
  expect((await run($, 'confirm c1')).text).toBe('confirmation: confirmed')
  answer = 'Cancel'
  expect((await run($, 'confirm c1')).text).toBe('confirmation: declined')
  answer = undefined
  expect((await run($, 'confirm c1')).text).toBe('confirmation: unavailable')
})

test('delegation submits an extension-origin prompt without asUser', async ($, on) => {
  const seen = engine(on)
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  await start($)
  expect((await run($, 'delegate r1')).text).toBe('delegation queued')
  expect(seen.submits.length).toBe(0)
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })
  expect(seen.submits.length).toBe(1)
  expect(seen.submits[0].asUser).toBe(undefined)
  expect(seen.submits[0].origin?.kind).toBe('plugin')
})
