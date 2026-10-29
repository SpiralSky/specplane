# Specplane

Specplane is a plain-markdown framework for managing **specifications** and **plans** in AI-assisted software development.

## What it is

Specplane provides a set of conventions for files in a git repository, plus optional tooling and agent instructions. It manages two things:

- **Specifications**: what a project does (feature specs) and how it is built (architecture specs), each in separate files with enforced policies.
- **Plans**: structured, dependency-aware units of implementation work, executed step-by-step on git branches by AI agents.

## Core principles

- Markdown is the only source of truth — every piece of state lives in committed markdown.
- Usable with zero tooling — a human or agent can follow the framework by hand.
- The format is the product — the core deliverable is the language-agnostic format specification.
- Context economy — plans are split into steps so each agent session loads only what it needs.
- Safeguards are configurable — every policy has a sensible default and can be adjusted.
- Merge-friendly — parallel plans on separate branches do not produce routine conflicts.

## Status

**This repository is in the spec phase.** Feature specs are in review, architecture specs are drafted, and the first plan (`plans/2026-10-28-reference-cli-core`, the reference CLI core) is drafted. No implementation exists yet.

- Feature specs: `docs/specifications/features/` (status `review`)
- Architecture specs: `docs/specifications/architecture/` (status `draft`)
- Plans: `plans/PLANS.md`
- Unresolved design questions: `docs/OPEN-QUESTIONS.md`

## Repository layout

```
.specplane/config.yaml               framework configuration
docs/
  specifications/
    features/                        feature specs (what the framework does)
    architecture/                    architecture specs (how it is built)
  decisions/                         architecture decision records
  OPEN-QUESTIONS.md                  open design questions
harnesses/
  claude/
    specifications/
      features/                      Claude Code–specific feature specs
      architecture/                  Claude Code–specific architecture specs
plans/                               implementation plans (PLANS.md is generated)
README.md                            this file
```
