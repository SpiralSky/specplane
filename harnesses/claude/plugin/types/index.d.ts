export type PlanRow = {
  id: string
  status: string
  branch: string | null
  checkout: string | null
  steps: {
    total: number
    done: number
    skipped: number
    blocked: number
    next: { number: number; title: string; status: string } | null
  }
  blocked_issues: string[]
  last_step_commit: {
    sha: string
    time: string
    step: number
    agent: string
    session: string | null
  } | null
  ahead_of_remote: number | null
}

export type SpecplaneMode = 'step' | 'spec' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'specplane': {
      plans: Shaped<PlanRow[]>
      mode: Shaped<SpecplaneMode>
      expandedId: Shaped<string | null>
    }
  }
}
