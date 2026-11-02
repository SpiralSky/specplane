# Target lifecycle step 1 review repair

Checkout `/workspace/overnight/target-1-repair`, branch `overnight/target-1-repair`, base `e034635979413f713e50d35a63211a05be18f929`; commit `7319f99` (`fix(plan): preserve started target context`). Changed only `packages/cli/src/plan/context.ts` and `context.test.ts`.

- Selected local or remote branch snapshots now provide authoritative binding and comparison provenance; independently supplied metadata must agree. A discovered unbound started branch requires verified historical default evidence, and an empty complete branch discovery rejects a supplied binding. Coverage includes both local-only and remote-only legacy snapshots, missing and changed evidence, preservation of target and comparison, binding inference, and conflicts.
- Fallback checks local and remote refs for `main` before `master`. Coverage includes remote-only main and master and remote main versus local master.
- Only operative targets receive plan-specific validation, so a valid ignored team setting equal to the plan branch cannot block bound or legacy plans. Tests cover both cases.

Verification: `git diff --check` passed; `npm run build` passed; `node --test dist/plan/context.test.js` passed (one test file, seven source test cases). Tests use disposable local Git repositories and make no live host/model calls. No managed lifecycle files changed.

Dependencies: `npm ci --offline --no-audit --no-fund` failed with ENOTCACHED for undici-types 6.21.0. A network `npm ci --no-audit --no-fund --cache /tmp/target-1-npm-cache` produced no output and was interrupted (exit 130); it created local node_modules/cache artifacts. Copied installed dependencies from the review worktree after verifying identical package-lock SHA-256 `fd348323641015ae69d87df7ee9dd6015d2b3196e09567a93caeccee4c84b2b4`; build and test passed with that copy. An initial build before copying the contents of node_modules correctly failed `tsc: not found`; subsequent build succeeded. No escalation or denied approval was involved. No publication or live certification performed.
