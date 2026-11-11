import type { Register } from 'claude-code'

import { registerNative, startNative } from './handlers'

/**
 * The Specplane mod: the slash commands run through `specplane harness run` (see ./commands). The plans pane, step and
 * spec modes and edit gates of the retired pre-release design are gone: permissions are checked in the core, and the
 * Specplane MCP server declared in the plugin manifest carries the harness actions.
 */
export const register: Register = on => {
  registerNative(on)
  // The host allows one unmatched session.start hook per package, so the commands register from here.
  on('session.start', async ($, e, next) => {
    try { await startNative($, e.cwd) } catch (err) {
      $.ui.log(`specplane: commands failed to start: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    return next(e)
  })
}
