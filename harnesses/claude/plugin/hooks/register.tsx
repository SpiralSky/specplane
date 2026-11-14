import type { Register } from 'claude-code'

import { registerChannel, startChannel } from './channel'
import { registerNative, startNative } from './handlers'

/**
 * The Specplane mod: the slash commands run through `specplane harness run` (see ./commands). The plans pane, step and
 * spec modes and edit gates of the retired pre-release design are gone: permissions are checked in the core, and the
 * harness actions are tools the mod registers and serves through the session server (./channel).
 */
export const register: Register = on => {
  registerNative(on)
  registerChannel(on)
  // The host allows one unmatched session.start hook per package, so the commands register from here.
  on('session.start', async ($, e, next) => {
    try { await startNative($, e.cwd) } catch (err) {
      $.ui.log(`specplane: commands failed to start: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    try { await startChannel($, e.cwd) } catch (err) {
      $.ui.log(`specplane: the action tools failed to start: ${err instanceof Error ? err.message : String(err)}`, { to: 'transcript' })
    }
    return next(e)
  })
}
