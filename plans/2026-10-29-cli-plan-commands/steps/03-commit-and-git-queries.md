---
plan: 2026-10-29-cli-plan-commands
step: 3
title: git/commit.ts, branch queries, worktree listing
status: pending
context:
  - spec: architecture/reference-cli#Git and forge integration (`git/`)
  - spec: architecture/reference-cli#`commit.ts`
  - spec: architecture/reference-cli#`branch.ts`
  - spec: architecture/reference-cli#`worktree.ts`
  - spec: architecture/file-formats#8. Commit messages
  - file: packages/cli/src/git/
---

## Goal

Implement the git helpers the read-side commands need: commit message formatting and trailers, branch existence, worktree listing.

## Acceptance criteria

- [ ] `formatMessage` produces subject, body, and trailers in the file-formats order and throws `CommitFormatError` over 72 characters, except `chore(specplane): ...` subjects.
- [ ] `cliTrailers` includes `Specplane-Agent` and `Specplane-Session` only when the env vars are set and non-empty.
- [ ] `readTrailers` and `findLatest` return the right values on a temp repo with repeated keys (last wins).
- [ ] `branchExists`, `remoteBranchExists`, and a `listWorktrees()` parser of `git worktree list --porcelain` are tested.
- [ ] Unit tests pass.

## Tasks

1. Implement `git/commit.ts` per the spec.
2. Add the read-only functions to `git/branch.ts` and `git/worktree.ts`.
3. Add `CommitFormatError` to `errors.ts` if missing.
4. Tests against temporary git repositories.

## Guidance

- All git calls go through `git/exec.ts`; never use a shell string.
- Branch creation, deletion, rebase, and worktree add/remove are left to the plan-flows plan.
