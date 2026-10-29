import { expect, test } from 'claude-code/testing'

const PANE_EVENT = {
  plugin: 'specplane',
  component: 'Pane',
  requestId: 'specplane',
  props: {
    title: 'Specplane',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const ABOVE_PROMPT = {
  plugin: 'specplane',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

// Minimal stubs to satisfy session.start
function stubSession(on: any, branch = 'main', hasCli = false) {
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv ?? []
    if (argv[0] === 'git' && argv[1] === 'branch') {
      return { value: { exitCode: 0, stdout: branch, stderr: '' } }
    }
    if (argv[0] === 'specplane' && !hasCli) {
      return { value: { exitCode: 1, stdout: '', stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
  on('clock.every', () => ({ value: null }))
}

test('pane shows "No active plans" when plan list is empty', async ($, on) => {
  stubSession(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE_EVENT, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /No active plans/ })
  expect(row?.text).toBe('No active plans.')
  await ui.unmount()
})

test('pane renders rows from fixture plan list output', async ($, on) => {
  const fixture: any[] = [
    {
      id: '2026-10-29-my-plan',
      status: 'in_progress',
      branch: 'plan/2026-10-29-my-plan',
      checkout: '/repo',
      steps: {
        total: 3,
        done: 1,
        skipped: 0,
        blocked: 0,
        next: { number: 2, title: 'enforcement hooks', status: 'pending' },
      },
      blocked_issues: [],
      last_step_commit: null,
      ahead_of_remote: null,
    },
    {
      id: '2026-10-29-remote-only',
      status: 'in_progress',
      branch: 'plan/2026-10-29-remote-only',
      checkout: null,
      steps: {
        total: 2,
        done: 0,
        skipped: 0,
        blocked: 0,
        next: { number: 1, title: 'first step', status: 'pending' },
      },
      blocked_issues: [],
      last_step_commit: null,
      ahead_of_remote: 3,
    },
    {
      id: '2026-10-29-blocked-plan',
      status: 'in_progress',
      branch: 'plan/2026-10-29-blocked-plan',
      checkout: '/repo2',
      steps: {
        total: 2,
        done: 0,
        skipped: 0,
        blocked: 1,
        next: { number: 1, title: 'blocked step', status: 'blocked' },
      },
      blocked_issues: ['BLOCKED: missing spec section'],
      last_step_commit: {
        sha: 'abc1234',
        time: new Date(Date.now() - 2 * 60_000).toISOString(),
        step: 1,
        agent: 'claude-code',
        session: 'sess-abc123',
      },
      ahead_of_remote: null,
    },
  ]

  // Pre-seed plans atom
  on('state.get', () => ({
    value: { value: fixture, version: 1 },
  }))
  stubSession(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE_EVENT, surface: 'terminal' })

  // Worktree plan row
  const row1 = await ui.find({ type: 'Text', text: /my-plan/ })
  expect(row1).not.toBe(null)

  // Remote-only plan shows ↑3
  const ahead = await ui.find({ type: 'Text', text: /↑3/ })
  expect(ahead).not.toBe(null)

  // Blocked plan shows ⚠
  const blocked = await ui.find({ type: 'Text', text: /⚠.*blocked/ })
  expect(blocked).not.toBe(null)

  await ui.unmount()
})

test('step mode is entered on plan branch at session start', async ($, on) => {
  stubSession(on, 'plan/2026-10-29-my-plan')
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: null }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // Band should render (not delegate to next) in step mode
  const ui = await $.ui.mount({ ...ABOVE_PROMPT, surface: 'terminal' })
  // With empty step file read, shows "step 00:  · criteria 0/0"
  const band = await ui.find({ type: 'Text', text: /step.*criteria/ })
  expect(band).not.toBe(null)
  await ui.unmount()
})

test('step mode denies Edit outside checkout', async ($, on) => {
  // Session starts on plan branch — session.start auto-enters step mode
  stubSession(on, 'plan/2026-10-29-my-plan')
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const result = await $.tool.call({
    tool: 'Edit',
    file_path: '/other/repo/file.ts',
    old_string: 'x',
    new_string: 'y',
  })
  expect(result.deny).toMatch(/outside/)
})

test('step mode denies Edit to PLAN.md', async ($, on) => {
  stubSession(on, 'plan/2026-10-29-my-plan')
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const result = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/plans/2026-10-29-my-plan/PLAN.md',
    old_string: 'x',
    new_string: 'y',
  })
  expect(result.deny).toMatch(/PLAN\.md/)
})

test('step mode denies Edit to another step file', async ($, on) => {
  stubSession(on, 'plan/2026-10-29-my-plan')
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const result = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/plans/2026-10-29-my-plan/steps/01-first.md',
    old_string: 'x',
    new_string: 'y',
  })
  // nextStepFile is null (no step files found in stub), so any step file is "other"
  expect(result.deny).toMatch(/step.*file/)
})

test('step mode allows Edit to a non-plan file in checkout', async ($, on) => {
  stubSession(on, 'plan/2026-10-29-my-plan')
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('state.get', () => ({
    value: { value: 'step', version: 1 },
  }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const result = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/src/some-file.ts',
    old_string: 'x',
    new_string: 'y',
  })
  expect(result.deny).toBe(undefined)
})

test('spec mode adds policy section to system prompt', async ($, on) => {
  // All on() stubs registered before any $.* call
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv ?? []
    if (argv[0] === 'git' && argv[1] === 'branch') {
      return { value: { exitCode: 0, stdout: 'main', stderr: '' } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  on('fs.list', () => ({ value: [] }))
  // Config read returns yaml with two llm_role entries
  on('fs.read', () => ({ value: 'specs:\n  feature:\n    llm_role: assist\n  architecture:\n    llm_role: draft' }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: null }))
  // prompt.compose engine stub: return empty sections
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // Switch to spec mode via the registered command
  await $.command.run({ command: 'specplane-mode', args: 'spec' })

  const { sections } = await $.prompt.compose({ promptModel: 'claude-sonnet-4-6', outputStyle: null, tools: [], traits: [], surfaces: [] })
  const specSection = sections.find((s: any) => s.id === 'specplane:spec')
  expect(specSection).not.toBe(undefined)
  expect(specSection?.text).toMatch(/Feature specs/)
  expect(specSection?.text).toMatch(/Architecture specs/)
})

test('off mode changes nothing', async ($, on) => {
  stubSession(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  // mode defaults to 'off'; the band hook calls next(e), so engine must answer
  on('ui.render', ($ui: any, e: any) => {
    const { Text } = $ui.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...ABOVE_PROMPT, surface: 'terminal' })
  // In off mode, band passes through — no specplane text
  const band = await ui.find({ type: 'Text', text: /step.*criteria/ })
  expect(band).toBe(undefined)
  // engine stub renders instead
  const engine = await ui.find({ type: 'Text', text: /engine/ })
  expect(engine?.text).toBe('engine')
  await ui.unmount()
})
