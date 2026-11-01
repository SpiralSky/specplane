# Pre-publication ignore hygiene — 2026-11-01

## Scope and decision

Branch `dot/ignore-hygiene-20261101`, based on `6ae4e304faa75b7bd5ae1240da7f4693f48d0a4e`.
User requested a pre-push audit. These are autonomous, reversible hygiene decisions,
not plan/spec approval or permission to merge. No files were removed or untracked;
no history was rewritten and no credentials were accessed or generated.

Prevent accidentally adding local `.env` variants, caches and coverage. Keep explicitly
named `.env.example`, `.env.sample`, `.env.template` trackable for sanitized examples;
these exceptions still require secret review. Do not blanket-ignore JSON, databases,
key extensions, build output, fixtures, or framework metadata: legitimate sources and
intentional distribution assets must remain reviewable.

## Evidence

- Examined tracked/untracked/ignored status across all existing worktrees. Only the
  independently active provenance worktree had source modifications/untracked sources.
- No tracked credential-named files, `.env` files, private key files, SQLite/database
  files, logs, bytecode, or local virtual environments were found by filename screening.
- Local reachable Git history scan (`git rev-list --objects --all`, read each blob)
  examined 995 unique blobs in this repository before this commit. Recognizers
  covered PEM/OpenSSH private-key headers, GitHub/OpenAI/AWS key formats, JWT-shaped
  strings, and quoted literal credential assignments; output included paths/types only.
- No recognizer matches in this repository's scanned blobs.
- Existing CLI build output, dependencies, logs and Claude local settings are ignored.
  CLI source, schemas, specifications and `.specplane/config.yaml` stay trackable.
- Runtime conductor locks/alert state belong to Git's private common directory, not
  versioned plan state. Codebase Memory binary/cache are outside both repositories;
  no graph database is tracked, and no operational index has been claimed.

## Regression and limitations

Run `sh scripts/check-gitignore.sh`. It uses `git check-ignore --no-index` on
representative sensitive/cache paths and reviewable templates/assets, `git ls-files`
to assert required assets remain tracked, and rejects any tracked/ignored overlap.
It creates no sample secrets or artifacts. Result: PASS; `git diff --check`: PASS.
No package code changed, so package suites were not rerun for this ignore-only patch.

A pattern scan is not proof that all secrets are absent: unrecognized formats,
encoded/encrypted data, external objects, private auth stores and unobserved remote
changes are outside coverage. Existing tracked secrets cannot be fixed with ignore
rules; a genuine finding would require publication pause and credential remediation,
not automatic deletion/history rewriting. Recheck the final composed branch before push.
