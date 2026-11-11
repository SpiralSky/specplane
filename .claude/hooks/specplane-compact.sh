#!/bin/sh
# SessionStart hook (matcher: compact): tell the core that this session's context was compacted, so the command
# instructions are delivered again (architecture/claude-integration §4, reference-cli §12.3). Prints nothing and
# exits 0 whenever it cannot do its job.
root="${CLAUDE_PROJECT_DIR:-.}"
[ -f "$root/.specplane/config.yaml" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v specplane >/dev/null 2>&1 || exit 0
sid=$(jq -r '.session_id // empty' 2>/dev/null) || exit 0
[ -n "$sid" ] || exit 0
(cd "$root" && specplane harness compact "$sid") >/dev/null 2>&1
exit 0
