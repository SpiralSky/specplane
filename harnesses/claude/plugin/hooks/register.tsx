import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PlanRow, SpecplaneMode } from '../types'

const PANE = 'specplane'
const PLUGIN = 'specplane'

const plans = atom(
  { plugin: 'specplane', key: 'plans' } as const,
  [] as PlanRow[],
  { shape: 'plans-1' },
)
const mode = atom(
  { plugin: 'specplane', key: 'mode' } as const,
  'off' as SpecplaneMode,
  { shape: 'mode-1' },
)
const expandedId = atom(
  { plugin: 'specplane', key: 'expandedId' } as const,
  null as string | null,
  { shape: 'expanded-1' },
)

function planIdFromBranch(branch: string): string | null {
  const m = /^plan\/(.+)$/.exec(branch)
  return m ? m[1] : null
}

function formatAge(isoTime: string): string {
  const ms = Date.now() - new Date(isoTime).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function resolvePath(filePath: string, cwd: string): string {
  if (filePath.startsWith('/')) return filePath
  return `${cwd}/${filePath}`
}

async function readLocalPlan(
  $: Parameters<Register>[0] extends (e: any, m: any, h: (...a: any[]) => any) => void ? never : Parameters<Register>[0],
  cwd: string,
  planId: string,
): Promise<PlanRow | null> {
  try {
    const stepsDir = `${cwd}/plans/${planId}/steps`
    const entries = await $.fs.list(stepsDir)
    const stepFiles = entries
      .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))

    let done = 0, skipped = 0, blocked = 0, total = 0
    let next: PlanRow['steps']['next'] = null

    for (const entry of stepFiles) {
      const text = await $.fs.read(`${stepsDir}/${entry.name}`)
      const statusMatch = /^status:\s*(\S+)/m.exec(text)
      const titleMatch = /^title:\s*(.+)/m.exec(text)
      const stepMatch = /^step:\s*(\d+)/m.exec(text)
      const status = statusMatch?.[1] ?? 'pending'
      const title = titleMatch?.[1]?.trim() ?? entry.name
      const number = parseInt(stepMatch?.[1] ?? '0', 10)
      total++
      if (status === 'done') done++
      else if (status === 'skipped') skipped++
      else if (status === 'blocked') blocked++
      else if (!next) next = { number, title, status }
    }

    return {
      id: planId,
      status: 'in_progress',
      branch: `plan/${planId}`,
      checkout: cwd,
      steps: { total, done, skipped, blocked, next },
      blocked_issues: [],
      last_step_commit: null,
      ahead_of_remote: null,
    }
  } catch {
    return null
  }
}

async function loadPlans(
  $: any,
  cwd: string,
  noFetch: boolean,
): Promise<void> {
  try {
    const argv = ['specplane', 'plan', 'list', '--json', '--live']
    if (noFetch) argv.push('--no-fetch')
    const { exitCode, stdout } = await $.process.run(argv, { cwd })
    if (exitCode === 0 && stdout.trim()) {
      const all: PlanRow[] = JSON.parse(stdout)
      const active = all.filter(
        p => p.branch || p.status === 'in_progress' || p.status === 'review',
      )
      await update($, plans, () => active)
      return
    }
  } catch {
    // CLI absent or failed — fall through to local fallback
  }

  // Fallback: current checkout only
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'], { cwd })
    if (exitCode !== 0) return
    const planId = planIdFromBranch(stdout.trim())
    if (!planId) return
    const row = await readLocalPlan($, cwd, planId)
    if (row) await update($, plans, () => [row])
  } catch {
    // Not a git repo or no plan branch
  }
}

/** Log sink for fail-open notes; replaceable so tests can capture it. */
export const failureLog = {
  write: (msg: string): void => console.error(msg),
}

function logFailure(label: string, err: unknown): void {
  failureLog.write(
    `specplane: ${label} hook failed, allowing: ${err instanceof Error ? err.message : String(err)}`,
  )
}

/**
 * Shared step-mode gate for Edit/Write/MultiEdit. Never rejects: any failure
 * is logged and treated as "no denial" (fail open, like the shell hooks).
 */
export async function gateDenial(
  $: any,
  e: any,
  label: string,
  ctx: { cwd: string; planId: string | null; nextStep: string | null },
  readMode: () => Promise<SpecplaneMode> = () => read($, mode),
): Promise<string | null> {
  try {
    const currentMode = await readMode()
    if (currentMode !== 'step') return null
    return stepModeDenial(e?.file_path ?? '', ctx.cwd, ctx.planId, ctx.nextStep)
  } catch (err) {
    logFailure(label, err)
    return null
  }
}

/**
 * "Read HANDOFF" action. Interactive sessions fill the prompt; non-interactive
 * ones (`claude -p`), or a fill that throws, copy the path instead.
 * Returns which route was taken.
 */
export async function handoffAction(
  $: any,
  interactive: boolean,
  path: string,
  surface?: unknown,
): Promise<'fill' | 'copy'> {
  if (interactive) {
    try {
      await $.prompt.fill({ text: `Read ${path}` })
      return 'fill'
    } catch (err) {
      logFailure('Read HANDOFF prompt fill', err)
    }
  }
  await $.ui.copy({ text: path, surface })
  return 'copy'
}

export const register: Register = on => {
  let pollRun = 0
  let interactiveSession = true
  let sessionCwd = ''
  let currentPlanId: string | null = null
  let nextStepFile: string | null = null

  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    interactiveSession = (e as any).isInteractive !== false

    await $.command.register({
      name: 'specplane',
      description: 'Open the Specplane plans pane',
    })
    await $.command.register({
      name: 'specplane-mode',
      description: 'Set Specplane mode: /specplane-mode <step|spec|off>',
    })

    // Detect plan branch
    try {
      const { exitCode, stdout } = await $.process.run(
        ['git', 'branch', '--show-current'],
        { cwd: e.cwd },
      )
      if (exitCode === 0) {
        currentPlanId = planIdFromBranch(stdout.trim())
      }
    } catch {
      // Not a git repo
    }

    if (currentPlanId) {
      await update($, mode, () => 'step' as SpecplaneMode)
      // Find the next pending step file
      try {
        const stepsDir = `${e.cwd}/plans/${currentPlanId}/steps`
        const entries = await $.fs.list(stepsDir)
        const stepFiles = entries
          .filter(f => f.kind === 'file' && f.name.endsWith('.md'))
          .sort((a, b) => a.name.localeCompare(b.name))
        for (const entry of stepFiles) {
          const text = await $.fs.read(`${stepsDir}/${entry.name}`)
          const statusMatch = /^status:\s*(\S+)/m.exec(text)
          const status = statusMatch?.[1] ?? 'pending'
          if (status !== 'done' && status !== 'skipped') {
            nextStepFile = `${stepsDir}/${entry.name}`
            break
          }
        }
      } catch {
        // Steps dir not readable
      }
    }

    await loadPlans($, e.cwd, false)

    // Poll every 60 s; fetch from remote on every 5th run
    $.clock.every(60_000, async () => {
      pollRun++
      try {
        await loadPlans($, sessionCwd, pollRun % 5 !== 0)
      } catch (err) {
        failureLog.write(`specplane: poll failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    void $.ui.open({ id: PANE, title: 'Specplane' })

    const currentMode = await read($, mode)
    if (currentMode !== 'off') {
      $.ui.status(`specplane · ${currentMode}`)
    }

    return next(e)
  })

  // /specplane command: open the pane
  on('command.run', { command: 'specplane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Specplane' })
    return { text: 'Specplane plans pane opened.' }
  })

  // /specplane-mode command: switch mode
  on('command.run', { command: 'specplane-mode' }, async ($, e) => {
    const arg = ((e as any).args ?? '').trim()
    if (!['step', 'spec', 'off'].includes(arg)) {
      return { text: 'Usage: /specplane-mode <step|spec|off>' }
    }
    const newMode = arg as SpecplaneMode
    await update($, mode, () => newMode)
    $.ui.status(newMode !== 'off' ? `specplane · ${newMode}` : undefined)
    return { text: `Specplane mode: ${newMode}` }
  })

  // Refresh plan data after git commit or push
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    try {
      const cmd = (e as any).command ?? ''
      if (/\bgit\s+(commit|push)\b/.test(cmd)) {
        pollRun = 0 // next poll will fetch
        await loadPlans($, sessionCwd, false)
      }
    } catch (err) {
      failureLog.write(`specplane: Bash refresh failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return result
  })
    .catch(($, e, next) => {
      logFailure('Bash gate', next.error)
      return next(e) // fail open
    })

  // Step-mode: deny Edit to prohibited paths
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const denial = await gateDenial($, e, 'Edit', {
      cwd: sessionCwd,
      planId: currentPlanId,
      nextStep: nextStepFile,
    })
    if (denial) return { deny: denial }
    return next(e)
  })
    .catch(($, e, next) => {
      logFailure('Edit gate', next.error)
      return next(e) // fail open
    })

  // Step-mode: deny Write to prohibited paths
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const denial = await gateDenial($, e, 'Write', {
      cwd: sessionCwd,
      planId: currentPlanId,
      nextStep: nextStepFile,
    })
    if (denial) return { deny: denial }
    return next(e)
  })
    .catch(($, e, next) => {
      logFailure('Write gate', next.error)
      return next(e) // fail open
    })

  // Step-mode: deny MultiEdit to prohibited paths
  on('tool.call', { tool: 'MultiEdit' } as any, async ($, e, next) => {
    const denial = await gateDenial($, e, 'MultiEdit', {
      cwd: sessionCwd,
      planId: currentPlanId,
      nextStep: nextStepFile,
    })
    if (denial) return { deny: denial }
    return next(e)
  })
    .catch(($, e, next) => {
      logFailure('MultiEdit gate', next.error)
      return next(e) // fail open
    })

  // Add system-prompt section in step or spec mode
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    let currentMode: SpecplaneMode
    try {
      currentMode = await read($, mode)
    } catch (err) {
      failureLog.write(`specplane: prompt.compose failed, no section added: ${err instanceof Error ? err.message : String(err)}`)
      return result
    }

    if (currentMode === 'step' && currentPlanId && nextStepFile) {
      let criteria = ''
      try {
        const text = await $.fs.read(nextStepFile)
        const m = /## Acceptance criteria\n([\s\S]+?)(?=\n##|$)/.exec(text)
        if (m) criteria = m[1].trim()
      } catch { /* ignore */ }

      const section = {
        id: 'specplane:step',
        text: [
          '## Specplane step scope',
          `Plan: ${currentPlanId}`,
          `Step file: ${nextStepFile}`,
          `HANDOFF.md: ${sessionCwd}/HANDOFF.md`,
          criteria ? `\n### Acceptance criteria\n${criteria}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        scope: 'session' as const,
      }
      return { sections: [...result.sections, section] }
    }

    if (currentMode === 'spec') {
      let featureRole = 'assist'
      let archRole = 'draft'
      try {
        const cfg = await $.fs.read(`${sessionCwd}/.specplane/config.yaml`)
        const fm = /llm_role:\s*(\S+)/.exec(cfg)
        // Simple: first match is feature (under specs.feature), second is architecture
        const matches = [...cfg.matchAll(/llm_role:\s*(\S+)/g)]
        if (matches[0]) featureRole = matches[0][1]
        if (matches[1]) archRole = matches[1][1]
      } catch { /* ignore */ }

      const roleLabel = (r: string) =>
        r === 'none'
          ? 'no edits'
          : r === 'assist'
          ? 'suggest only'
          : 'drafting allowed'

      const section = {
        id: 'specplane:spec',
        text: [
          '## Specplane spec policy',
          `Feature specs: llm_role = ${featureRole} (${roleLabel(featureRole)})`,
          `Architecture specs: llm_role = ${archRole} (${roleLabel(archRole)})`,
        ].join('\n'),
        scope: 'session' as const,
      }
      return { sections: [...result.sections, section] }
    }

    return result
  })

  // Band above the prompt in step mode
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const currentMode = await read($, mode)
    if (currentMode !== 'step') return next(e)

    const { Box, Text } = $.ui.resolve(e)

    let stepNum = 0
    let stepTitle = ''
    let checked = 0
    let total = 0
    try {
      const text = await $.fs.read(nextStepFile)
      const stepM = /^step:\s*(\d+)/m.exec(text)
      const titleM = /^title:\s*(.+)/m.exec(text)
      if (stepM) stepNum = parseInt(stepM[1], 10)
      if (titleM) stepTitle = titleM[1].trim()
      const checkboxes = text.match(/- \[[ x]\]/g) ?? []
      total = checkboxes.length
      checked = checkboxes.filter(c => c.includes('x')).length
    } catch { /* ignore */ }

    return (
      <Box>
        <Text dimColor>
          step {String(stepNum).padStart(2, '0')}: {stepTitle} · criteria{' '}
          {checked}/{total}
        </Text>
      </Box>
    )
  })

  // Plans pane
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const planList = await read($, plans)
    const expanded = await read($, expandedId)

    if (planList.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No active plans.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {planList.map(plan => {
          const isExpanded = expanded === plan.id
          const location =
            plan.checkout ??
            (plan.branch ? 'remote' : 'external')
          const stepInfo = plan.steps.next
            ? `step ${plan.steps.done}/${plan.steps.total} · ${plan.steps.next.title}`
            : `step ${plan.steps.done}/${plan.steps.total} · all done`
          const agePart = plan.last_step_commit
            ? ` ${formatAge(plan.last_step_commit.time)} ${plan.last_step_commit.agent}`
            : ''
          const sessionPart =
            plan.last_step_commit?.session
              ? ` #${plan.last_step_commit.session.slice(0, 6)}`
              : ''

          return (
            <Box key={plan.id} flexDirection="column">
              <Box>
                <Button
                  key={`toggle-${plan.id}`}
                  label={`${isExpanded ? '▼' : '▶'} ${plan.id}`}
                  onPress={() =>
                    update($, expandedId, cur =>
                      cur === plan.id ? null : plan.id,
                    )
                  }
                />
                <Text> {location} · {stepInfo}</Text>
                {agePart ? (
                  <Text dimColor>
                    {agePart}
                    {sessionPart}
                  </Text>
                ) : null}
                {plan.steps.blocked > 0 ? (
                  <Text color="yellow"> ⚠ {plan.steps.blocked} blocked</Text>
                ) : null}
                {(plan.ahead_of_remote ?? 0) > 0 ? (
                  <Text color="cyan"> ↑{plan.ahead_of_remote}</Text>
                ) : null}
              </Box>
              {isExpanded && (
                <Box key={`exp-${plan.id}`} flexDirection="column" marginLeft={2}>
                  {plan.blocked_issues.map((issue, i) => (
                    <Text key={`bi-${i}`} color="yellow">
                      ⚠ {issue}
                    </Text>
                  ))}
                  {plan.steps.next && (
                    <Text dimColor>
                      Next: step {plan.steps.next.number} —{' '}
                      {plan.steps.next.title}
                    </Text>
                  )}
                  {plan.checkout && (
                    <Button
                      key={`copy-${plan.id}`}
                      label="Copy continue command"
                      onPress={press =>
                        $.ui.copy({
                          text: `cd ${plan.checkout} && claude /plan-step`,
                          surface: press.surface,
                        })
                      }
                    />
                  )}
                  {plan.checkout && (
                    <Button
                      key={`read-${plan.id}`}
                      label={
                        interactiveSession
                          ? 'Read HANDOFF'
                          : 'Copy HANDOFF path'
                      }
                      onPress={press =>
                        handoffAction(
                          $,
                          interactiveSession,
                          `${plan.checkout}/HANDOFF.md`,
                          press?.surface,
                        )
                      }
                    />
                  )}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}

function stepModeDenial(
  filePath: string,
  checkout: string,
  planId: string | null,
  nextStep: string | null,
): string | null {
  if (!filePath) return null

  // Resolve to absolute
  const abs = filePath.startsWith('/') ? filePath : `${checkout}/${filePath}`

  // Outside checkout
  if (!abs.startsWith(`${checkout}/`) && abs !== checkout) {
    return `specplane(step): edits outside ${checkout} are not allowed in step mode`
  }

  if (!planId) return null

  // PLAN.md
  const planMdPath = `${checkout}/plans/${planId}/PLAN.md`
  if (abs === planMdPath || abs.endsWith('/PLAN.md')) {
    return `specplane(step): PLAN.md is managed by the CLI, not the agent`
  }

  // Other step files
  const stepsPrefix = `${checkout}/plans/${planId}/steps/`
  if (abs.startsWith(stepsPrefix) && abs.endsWith('.md')) {
    const nextAbs = nextStep ?? ''
    if (abs !== nextAbs) {
      return `specplane(step): only the current step file (${nextAbs.split('/').pop()}) may be edited`
    }
  }

  return null
}
