// Offline interaction evidence for the native handlers (`claude plugin test`).
// Hooks registered with the test's `on` stand for the engine beneath the mod.
import { expect, test } from 'claude-code/testing'

const PRESENTATION = { isFullscreen: false, columns: 100 }
const COMPOSER = { kind: 'composer' } as const
const OTHER = { kind: 'plugin', name: 'other' } as const

function engine(on: any, opts: { inventory?: any[]; failRegister?: string; cli?: (argv: string[]) => any } = {}) {
  const seen = { registered: [] as string[], tools: [] as string[], model: 0, submits: [] as any[], runs: [] as string[][], asks: 0 }
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
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    // [node, <root>/core/dist/cli.js, ...cli args]; anything else (the pane's git calls) fails quietly.
    if (!argv[1]?.endsWith('core/dist/cli.js')) return { value: { exitCode: 1, stdout: '', stderr: '' } }
    seen.runs.push(argv.slice(2))
    return { value: opts.cli?.(argv.slice(2)) ?? { exitCode: 0, stdout: 'ok\n', stderr: '' } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: undefined })) // the pane's own startup
  return seen
}

function asker(on: any, seen: { asks: number }, answer: () => string | undefined) {
  // $.ui.ask is raised as a tool.call of AskUserQuestion, not an event of its own.
  on('tool.call', { tool: 'AskUserQuestion' }, (_: any, e: any) => {
    seen.asks++
    const a = answer()
    if (a === undefined) throw new Error('no one to ask')
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: a } } }
  })
}

async function start($: any) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

const run = ($: any, command: string, args = '', origin: any = COMPOSER) =>
  $.command.run({ command, args, origin, presentation: PRESENTATION })

test('registers free names, leaves collisions to their owner, and keeps reasoning commands off', async ($, on) => {
  const seen = engine(on, { inventory: [{ name: 'approve', description: 'host', source: 'builtin' }] })
  await start($)
  expect(seen.registered.includes('approve')).toBe(false)
  for (const name of ['validate', 'plan-status', 'plan-start', 'plan-abandon', 'specplane-docs', 'specplane-complete']) {
    expect(seen.registered.includes(name)).toBe(true)
  }
  for (const name of ['plan-step', 'plan-create', 'spec-assist', 'plan-finish', 'decision-new', 'spec-draft-architecture']) {
    expect(seen.registered.includes(name)).toBe(false)
  }
  expect(seen.tools.length).toBe(0)
})

test('one failed registration does not skip the others', async ($, on) => {
  const seen = engine(on, { failRegister: 'validate' })
  await start($)
  expect(seen.registered.includes('validate')).toBe(false)
  expect(seen.registered.includes('plan-status')).toBe(true)
})

test('a mechanical command answers with text and makes no model call', async ($, on) => {
  const seen = engine(on, { cli: () => ({ exitCode: 0, stdout: 'Validation passed.\n', stderr: '' }) })
  await start($)
  const out = await run($, 'validate')
  expect(out.text).toBe('Validation passed.')
  expect(seen.runs).toEqual([['validate']])
  expect(seen.model).toBe(0)
  expect(seen.submits.length).toBe(0)
})

test('a command owned by someone else passes through untouched', async ($, on) => {
  const seen = engine(on, { inventory: [{ name: 'approve', description: 'host', source: 'builtin' }] })
  on('command.run', (_: any, e: any) => ({ text: `host ${e.command}` }))
  await start($)
  expect((await run($, 'approve', 'feature/x')).text).toBe('host approve')
  expect(seen.runs.length).toBe(0)
})

test('a state-changing command not from a direct user gesture is refused without asking or running', async ($, on) => {
  const seen = engine(on)
  asker(on, seen, () => 'Confirm')
  await start($)
  const out = await run($, 'approve', 'feature/x', OTHER)
  expect(out.exitCode).toBe(2)
  expect(out.text.includes('refused')).toBe(true)
  expect(seen.asks).toBe(0)
  expect(seen.runs.length).toBe(0)
})

test('approval needs the host dialog; model-style words in the arguments cannot answer it', async ($, on) => {
  const seen = engine(on)
  let answer: string | undefined = 'Confirm'
  asker(on, seen, () => answer)
  await start($)
  const confirmed = await run($, 'approve', 'feature/a architecture/b 2026-11-01-plan')
  expect(seen.asks).toBe(1)
  expect(seen.runs).toEqual([['spec', 'approve', 'feature/a', 'architecture/b'], ['plan', 'approve', '2026-11-01-plan']])
  expect(confirmed.text.includes('ok')).toBe(true)

  seen.runs.length = 0
  answer = 'Cancel'
  expect((await run($, 'approve', 'feature/a confirm yes')).text.startsWith('Cancel')).toBe(true) // 'confirm' and 'yes' are IDs, not answers
  expect(seen.runs.length).toBe(0)

  const flag = await run($, 'approve', 'feature/a --yes')
  expect(flag.exitCode).toBe(2) // no flag skips the dialog
  expect(seen.runs.length).toBe(0)
})

test('with no one to ask (headless), confirmation refuses and names the manual command', async ($, on) => {
  const seen = engine(on)
  asker(on, seen, () => undefined)
  await start($)
  const out = await run($, 'plan-abandon', '2026-11-01-plan')
  expect(out.exitCode).toBe(2)
  expect(out.text.includes('specplane plan abandon 2026-11-01-plan')).toBe(true)
  expect(seen.runs.length).toBe(0)
})

test('plan-abandon runs the core command only after Confirm', async ($, on) => {
  const seen = engine(on)
  asker(on, seen, () => 'Confirm')
  await start($)
  await run($, 'plan-abandon', '2026-11-01-plan --delete-branch')
  expect(seen.runs).toEqual([['plan', 'abandon', '2026-11-01-plan', '--delete-branch']])
  expect((await run($, 'plan-abandon', '2026-11-01-plan --force')).exitCode).toBe(2)
})

test('docs return the shared topic bytes with core and docs versions in a separate header', async ($, on) => {
  const topic = { version: '0.1.0', docs_version: '0.1.0', topic_id: 'concepts', content: '# Concepts\nbody\n' }
  engine(on, { cli: argv => ({ exitCode: 0, stdout: JSON.stringify(argv[1] === 'concepts' ? topic : { version: '0.1.0', docs_version: '0.1.0', items: [] }), stderr: '' }) })
  await start($)
  const out = await run($, 'specplane-docs', 'concepts', OTHER) // read-only: any origin
  expect(out.text).toBe('Specplane core 0.1.0 · docs 0.1.0\n\n# Concepts\nbody\n')
})

test('completion declarations map to the core completion commands', async ($, on) => {
  const seen = engine(on)
  await start($)
  await run($, 'specplane-complete', 'feature/x')
  await run($, 'specplane-complete', 'feature/x --status partial --dry-run')
  expect(seen.runs).toEqual([['spec', 'complete', 'feature/x'], ['spec', 'implementation', 'feature/x', '--status', 'partial', '--dry-run']])
})
