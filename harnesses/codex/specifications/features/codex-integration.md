---
id: feature/codex-integration
title: Codex integration
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: []
references: [root:harness R35, root:harness R35.1, root:harness §2, root:steering R59, root:harness R47, root:harness R34, root:harness R14, root:harness R18, root:harness R20, root:plan-execution R27, root:plan-execution R27.6, root:plans R28, root:harness R19.1]
---

# Codex integration

This spec says what Specplane provides inside Codex, the harness in which the user works with an OpenAI model on a project. Specplane's text and rules are the same as for Claude Code (`root:harness R35`); this spec states how Codex delivers them and, above all, which capabilities Codex lacks. Plan execution is required on every supported harness (`root:harness R35.1`), so it is the first thing Codex must do; other capabilities are reported rather than approximated. The statements about what Codex supports are assumptions from the host's published skill documentation and are to be verified per surface before they are relied on.

## §1 Terms

- **Surface:** a way of using Codex: a local terminal session, the IDE or desktop app, or a cloud session. Each surface is verified on its own; one surface's support is not inherited by another.
- **Skill:** a packaged instruction set that Codex loads on demand.

## §2 Standing instructions

Refines `root:harness §2`.

- Codex receives the standing instructions from `AGENTS.md`. Specplane adds one marked block to it, once, and later updates change only that block; the maintainers' text outside the block is never touched (`root:harness §2`). A project may forbid the block, and then Specplane tells the user that Codex has no standing instructions until they add them (assumption).
- The text is the same as for any harness: Specplane is in use, read the configuration first, look up steering for the role, do not call the CLI (`root:steering R59`, `root:harness R47`).
- Installing Codex support does not select Codex for the project and does not affect a Claude Code install in the same project. The user names the harness at setup (`root:harness R34`).

Scenario: Given an `AGENTS.md` with the team's own rules, When the user sets up Codex, Then the team's text is unchanged and one Specplane block is added.

## §3 Workflows as skills

Refines `root:harness R14` and `root:harness R18`.

- Every Specplane workflow is available to Codex as a skill the user starts by name or that Codex loads when it fits. The skill carries the same contract as in other harnesses: purpose, preconditions, steps, permissions and output (`root:harness R14`).
- Codex runs a skill as a model turn. A command that should run without a model, such as showing plan status or approving a specification, therefore cannot be offered as a typed command in Codex unless the host provides native command handling, which has to be verified (`root:harness R18`, `root:harness R35.1`). Until then Specplane says so at setup and when the user tries the command. It does not substitute a model turn for the user's command, and it does not let the model approve on the user's behalf (`root:harness R20`).
- The user's own terminal is not part of the harness: a person can always use the Specplane CLI there. Specplane may say that in its notice; the harness itself does not run the CLI for the user (`root:harness R47`).

Scenario: Given Codex has no native commands on this surface, When the user asks for plan status, Then Specplane states the capability is missing and shows the answer through a read-only action or tells the user that the CLI in their own terminal gives it.

## §4 Not calling the CLI

Refines `root:harness R47` and `root:harness R35.1`.

The model is told not to call the Specplane CLI. Whether Codex can also block a shell command from the model depends on its hooks or sandbox rules on that surface. Where it can be verified, Specplane installs the block. Where it cannot, Specplane says at setup that the CLI is not blocked and does not claim it is.

## §5 Plan execution

Refines `root:plan-execution R27`, `root:plan-execution R27.6` and `root:plans R28`.

- A plan run is one step at a time, in the plan's own checkout, from the existing Codex session. Codex does not start background sessions for Specplane in this release; asking for one is refused with the reason, and no other harness is used instead (`root:harness R35.1`).
- Plan-start launches Codex in the checkout with `codex exec`; only if launching is unavailable does it say why and give the command that opens Codex there. A session that is not in the plan's checkout stops and names it.
- A cloud session runs a step only when the checkout, the Specplane files and the shell tools it needs exist there. Otherwise Specplane names what is missing and does not start the step.
- Gaps, requests and soft stops work as the root specs say. A budget the session cannot measure is reported when it is set, and not claimed to be enforced (`root:harness R35.1`).

Scenario: Given a Codex surface without the Specplane files, When the user asks to run a step, Then Specplane names the missing files and runs nothing.

## §6 Authors and model identity

Refines `root:harness R19.1`.

Codex records the model it reports as the author of a spec it writes. If Codex exposes no model identity, the author is recorded as `unknown`; it is never guessed from the product name. A model switch in one session adds a second author; it never replaces the first.

## §7 What this release does not do

- No typed commands that skip the model, unless verified (`§3`).
- No viewing or review commands (later release in the root specs).
- No background sessions (`§5`).
