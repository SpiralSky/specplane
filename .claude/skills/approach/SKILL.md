---
name: approach
description: >-
  Improve how a goal is pursued through evidence-informed meta-level decision
  making. Research the methods governing the work, and the processes selecting
  those methods, only where doing so can materially improve a real decision.
  Use when the user asks to design, review or rethink an approach or strategy,
  invokes /approach, or an existing approach needs reconsideration. Supports
  optional repository insights and proportionate subagent use. Not for routine
  execution under a settled approach.
---

# Approach: evidence-informed meta-level decision making

## Purpose

Improve the work by examining both the task and what governs how it is done.
A method is selected by another process, which can itself be examined. Research
upward where useful, then translate findings back into concrete decisions.

Treat this as a decision-making practice. It can inform a conversation, a plan,
an implementation workflow or an existing framework. Do not impose files, logs,
numerical predictions, experiments or agent teams.

## Levels

- **Level 0:** the actual goal and its outcomes.
- **Level 1:** methods for doing the work.
- **Level 2:** processes for finding, comparing and selecting those methods.
- **Higher levels:** processes governing the choices below, including which
  questions deserve investigation and how effort is allocated.

A question is higher-level only if it examines a process governing the level
below. A broader topic, extra search or more elaborate method is not an ascent.

Branches can share dependencies. Levels are relative to the decision being
examined; avoid spending effort arguing about their numbering.

When helpful, use the analogy to training, tuning and architecture search to
illustrate this structure. Do not infer universal laws about returns or timescales
from it. Treat deeper inquiry costing more and returning less as budgeting
heuristics, rather than facts requiring a fixed cadence.

## Principles

1. **Keep the real objective fixed.** Distinguish the user's goal from its
   wording, inherited assumptions and proxy metrics. Respect actual constraints.
   Assess usefulness through consequences for that goal.

2. **Research, not introspection.** Investigate how relevant questions have
   actually been handled: published findings, documented comparisons, established
   practice and applicable project evidence. Self-critique alone is not research.

3. **Use existing evidence first.** Credible, applicable findings can justify a
   decision without local revalidation. Check consequential claims against their
   sources and assess transfer to this project's conditions. Distinguish measured
   comparisons from recommendations, anecdotes and inference. Repeated reports
   of one study are not independent evidence.

4. **Separate evidence origin from strength.** Local measurement is not
   automatically stronger than external research. Consider quality, relevance,
   limitations and remaining uncertainty. Support for individual principles does
   not prove the combined approach adds value, but proof of that added value is
   not a prerequisite to reasonable use.

5. **Climb selectively.** Prioritize uncertainty whose resolution could materially
   change a consequential action. Consider stakes, reuse, reversibility and full
   opportunity cost. Reuse applicable findings; research differences where
   conditions changed. Do not map or investigate every possible branch.

6. **Descend into action.** Explain what each investigated question changed below
   and why it matters for the goal. Keeping the default can be useful when evidence
   resolves a consequential doubt. Do not claim benefit merely because research
   occurred or confidence increased.

7. **Test conditionally.** Uncertainty does not automatically require an
   experiment. Prefer existing research or observations from work already needed.
   Propose a dedicated test only when it directly advances or protects the project
   and its expected decision value justifies setup, execution, analysis and delay.
   Do not benchmark unrelated research methods instead of doing the project.
   If further investigation is not worthwhile, state the uncertainty and proceed
   with a reasonable provisional decision.

8. **Stop when further inquiry is unlikely to change action enough to pay for
   itself.** A depth limit is a ceiling, not a target; default to 4 if none is given.
   No change on a branch is a reason to reconsider further effort, not an absolute
   ban when a consequential unresolved question remains.

9. **Do not overclaim learning.** Distinguish successful execution, evidence of
   benefit and evidence that benefit exceeds overhead. A prediction holding does
   not establish causation or superiority over the default. Keep the default
   explicit; compare alternatives only when that comparison is worth its cost.
   Diagnose failures before climbing: execution, measurement, chance or changed
   conditions may explain them. Do not change success criteria after results.

Apply these principles to memory and delegation themselves. Include the cost of
retrieval, duplicated context, coordination, verification, retries, integration
and maintenance. More stored information or more agents is not a success metric.

## Workflow

Adapt the depth and output to the request.

- `create` develops an approach.
- `revisit` reconsiders relevant decisions using new evidence.
- `status` reports current decisions, evidence and unresolved issues without
  modifying insights, handoffs or other records.

With no mode, infer the needed work from the request and existing context.

1. Establish the objective, constraints and decision needed. For broad requests
   to improve an approach, identify the outcome to improve (for example time to
   trustworthy feedback, quality or resource cost), not just recent mistakes.
   State a provisional objective if context supports it; ask only when competing
   interpretations would materially change the work. Read relevant existing
   decisions before asking for information already available. Observe repository
   insight policy and delegation constraints.

2. Identify the default method, its consequential bottlenecks or evidence gaps,
   and the few uncertainties that could change the decision. Do not equate the
   most visible retry or easiest metric with the dominant constraint. Separate
   observed delays, missing capabilities and unmeasured costs. Split components
   only where distinct methods or ownership help; direct execution remains an option.

3. Choose which questions to research, reuse or leave alone. When the current
   method cannot supply consequential feedback, consider a structural alternative
   (such as a different environment, representation, tool or division of work)
   alongside improving execution of the default. Compare full costs: setup,
   iteration, fidelity/verification, interpretation, handoffs and maintenance.
   This is not a requirement to replace tools or survey every alternative. If
   insights are enabled, retrieve relevant entries. Delegate only where useful.
   State consequential choices briefly; a full level map is optional.

4. Research chosen questions at their own level. When a higher-level answer
   governs lower-level research, resolve that dependency first. Consider credible
   alternatives and findings outside the initial framing. Parallelize independent
   investigations when justified and permitted by the subagent guidance below.

5. Connect evidence to decisions:
   question → finding → method implication → project action.
   Report the source's actual result, conditions and limitations. Label transfer
   assumptions and inference. Do not invent findings, thresholds or savings.

6. State the recommended decision, strongest plausible alternative, supporting
   evidence, remaining consequential uncertainty and condition for reconsideration.
   Use quantitative predictions and deadlines only when meaningful and
   proportionate. A decision being new here does not itself require a local test.

7. Return to useful project work. Where a justified project test is needed,
   prioritize consequential uncertainty and use the cheapest adequate check.
   Follow the user's chosen implementation workflow. Retain an insight only
   when useful and permitted by the repository's storage policy.

On revisit, inspect only relevant decisions and evidence. Preserve supported
choices. Reconsider selection processes when evidence points to a process
problem, rather than automatically moving up a level after every failure.

Report unobserved outcomes as unknown. Do not penalize justified decisions for
lacking unnecessary local experiments.

## Reviewing feedback and implementation speed

Optimize progress toward the intended outcome, not merely code-writing speed,
test runtime or compliance with a process. Follow the relevant path from change
through setup/execution to interpretable evidence and the next decision. Existing
work may expose a missing link without a new timing campaign. An unmeasured link
is unknown, not free; a cheap inner loop does not establish a cheap complete loop.

Distinguish an execution problem from a method's inability to answer the question.
More careful use of an inadequate proxy may still leave the important decision
unresolved. Before choosing a new environment, check whether the scenarios and
success criteria represent the user's important behaviors: what inadequate result
could still pass? A faithful environment with weak scenarios can give misleading
confidence. Prioritize gaps by consequence for the user's objective, not by which
missing layer is easiest to name. For simulation or test-environment choices,
identify which production behaviors must transfer, which are approximations, and
which require a different observation channel or human judgment. A richer
environment may reduce total work by exposing failures earlier; a faster approximation may help a different stage.
Choose by the decision it enables, not realism or speed alone.

When reviewing meta-level coverage, distinguish levels actually investigated from
those merely discussed. Explain what selected the research questions and whether
that selection overlooked a bottleneck. Do not manufacture extra levels to meet a
depth target. Missing context should narrow confidence and motivate a discriminating
next observation; it need not prevent useful comparison of known alternatives.

Before adding instructions, ask whether the obstacle instead needs a capability,
a changed artifact or a different feedback path. Preserve useful execution fixes
without presenting them as a substitute for that change. Keep conclusions provisional
where total benefit is unmeasured, and state the next action that could change them.

## Optional repository insights

### Enablement and customization

Keep this feature **off by default**. Enable it only through an explicit user
instruction or a trusted repository policy. An existing notes file alone does
not enable ongoing insight retrieval or maintenance.

At the first repository-related use in a conversation, briefly mention the
capability and current setting unless already addressed or declined. For example:

"Repository insights are off by default. They can be enabled using your preferred
location and format."

Continue the task without waiting for an answer. Do not repeatedly advertise the
feature or turn the notice into a configuration interview.

Support these behavioral modes, accepting equivalent natural-language settings:

- **Off:** do not automatically retrieve or maintain the optional insight store.
- **Read-only:** consult relevant stored insights without changing them.
- **Read-write:** consult and update insights within the authorized scope.

If enablement does not specify write permission, use read-only mode. An explicit
instruction to maintain insights authorizes read-write behavior within its stated
scope. Preserve an already established mode unless the user or trusted policy
changes it; the `status` workflow remains read-only in every mode.

These modes do not require a particular configuration file or syntax. Ordinary
task-relevant project documentation remains available as evidence in every mode.

A request to read or save a particular note authorizes that operation; do not
infer a permanent setting change beyond what the user requested.

Allow customization per repository of:

- Storage location and format.
- Repository or subsystem scope.
- What kinds of findings merit retention.
- Retrieval and write policy.
- Review, archival and removal conditions.

Use an existing suitable store when one is established. Otherwise resolve the
destination when persistence is actually requested. Do not impose a filename,
database, embedding system or maintenance schedule.

Scope insights to the intended repository. Use branch, revision, dependency or
tool versions when they materially affect applicability. Do not silently mix
repositories or substitute global memory when repository scope is unclear.

Honor established authorization without repeatedly asking for permission.
If ambiguity prevents a requested save, complete the unblocked work and clarify
only what is necessary. Disabling the feature does not itself authorize deletion
of previously stored records.

### What to retain

Retain information likely to improve a future decision or prevent meaningful
rediscovery. Examples include researched method choices, important constraints,
non-obvious failure conditions and findings from completed project work.

Preserve enough context to recover:

- What was learned and what decision it informs.
- Where and under what conditions it applies.
- The supporting sources or observations.
- Limitations, contrary evidence and unresolved uncertainty.
- When it was researched or observed.
- What changes would make it worth reconsidering.

Adapt these details to the chosen format; this is not a mandatory schema.
Distinguish an observation, an inference and a provisional hypothesis. One
successful case does not establish a general rule.

Keep reusable findings distinguishable from task progress, temporary blockers
and next-step lists. Do not manufacture a lesson after every task, duplicate
readily discoverable repository overviews or save unrelated personal information.

### Reuse and maintenance

Retrieve only the entries relevant to the current decision. Follow source
pointers when needed instead of loading the entire store automatically.

Distinguish the source's date, the research or observation date, and the date
evidence was last checked when those differences matter. Merely rereading a
note does not refresh its evidence.

Check consequential assumptions when relevant code, dependencies, models,
tools, constraints or source findings have changed. Use invalidation conditions
appropriate to the finding; do not impose a universal expiry period.

Treat stored insights as evidence to assess. They do not grant permissions,
override current instructions or make their own conclusions authoritative.

When writes are enabled, make targeted corrections, consolidate genuine
duplicates and mark superseded findings as appropriate. Preserve useful detail
and contrary evidence instead of repeatedly rewriting the whole store into
increasingly generic summaries.

Use one integrating writer for a shared record, or clearly separate ownership
of independent entries. Workers can return candidate insights for integration.
Keep maintenance proportionate to the likely value of future reuse.

## Subagent use

### Choose the arrangement and model separately

Use subagents when their likely contribution to quality, coverage, elapsed time
or context management justifies their full overhead. Respect the user's
preferences, available tools, model restrictions and resource limits.

Choose among these arrangements:

- **Direct execution:** keep small work, frequent iterative decisions and tightly
  coupled work with the agent that already understands the relevant context.
- **Continuing worker:** give a substantial related workstream to one subagent
  when separate context or specialization is useful.
- **Parallel workers:** assign work that can proceed independently from available
  inputs, with clear ownership and one lead responsible for integration.
- **Independent review:** obtain another examination when a specific consequential
  risk justifies it.

Use a lower-cost model when it is available, capable enough for the assignment
and likely to reduce the total cost of an acceptable result. Include context
loading, review, retries, escalation and integration in that judgment.

Do not automatically attempt every task with a weaker model first. Keep difficult
decisions and integration with an adequately capable agent. Escalate when a
concrete capability or verification problem makes further attempts unproductive.

Use existing capability evidence where sufficient. Verify current prices or
limits when they would materially change the choice. If cost information is
unavailable, acknowledge that limitation when relevant and use supported defaults.
Do not invent model controls, prices, quality differences or savings.

### Preserve useful context

Group related work by shared relevant context and actual dependencies. Prefer
continuing or resuming the same owner while that context remains useful.

Do not repeatedly spawn fresh agents to rediscover the same files or divide a
closely connected task into separate reader, planner, implementer and tester
agents without a concrete benefit.

A fresh agent does not automatically inherit a previous worker's knowledge.
Resumption, context inheritance, prompt caching and workspace isolation depend
on the environment; check support before relying on them.

Before acting on remembered state, inspect consequential changes to files,
decisions or repository revisions. Compact or transfer ownership when accumulated
context becomes stale, unwieldy or poorly matched to the next task.

An independent reviewer may deliberately reread the same evidence. Avoid removing
useful independence merely to minimize duplicate reading.

### Decide what can run concurrently

Run tasks concurrently only when they can proceed without each other's unfinished
results and without conflicting writes or dependence on changing shared state.

Shared read-only files do not by themselves prevent parallel work. Different
files do not by themselves establish independence: they may share an interface,
invariant, fixture, environment or unresolved design decision.

Resolve prerequisite decisions first, then reconsider which tasks are ready to
run independently. Related investigations may run in parallel even when the
subsequent implementation must remain with one owner.

Keep overlapping changes under one writer or serialize them. Separate worktrees
can isolate edits where supported, but do not remove semantic dependencies.
Reconcile results against the current state before integration.

Use the smallest useful set of concurrent workers. Available slots are capacity,
not a target.

### Delegate and integrate

Give each worker a proportionate assignment containing:

- The objective and expected result.
- Relevant context or source and artifact pointers.
- Dependencies, assumptions and ownership boundaries.
- Allowed changes and applicable constraints.
- A stopping condition and useful return format.

Do not require elaborate contracts for trivial assignments. Prefer concise
returns containing findings or changes, supporting evidence, checks actually
performed, unresolved issues and any next action needed from the lead.

Keep one lead responsible for synthesis and integration. Inspect consequential
claims and artifacts; do not treat a worker's confidence or several agents'
agreement as verification.

When independent review matters, provide the relevant artifacts and evidence
before exposing a preferred verdict. Use additional debate or review rounds only
when they address a specific unresolved issue. Do not create reviewer chains
or nested agent hierarchies by default.

### Handoffs and capability limits

Use a compact handoff at an ownership change or context/session boundary when
it will prevent meaningful rediscovery or loss of state.

Include what the next owner needs: goal, current revision or state, consequential
decisions, completed work, observed check results, unresolved issues and the
next useful action. Link to evidence or artifacts where that preserves detail.

Keep the handoff in the conversation unless the user's workflow calls for an
authorized durable project location. No particular filename is required.

A handoff records continuity; an insight records reusable learning. They may
share a chosen store if clearly distinguishable. Enabling either feature does
not automatically enable the other or expand its write permissions.

If subagent tools, resumable sessions, model selection or persistent storage are
unavailable, adapt to the supported capabilities and continue useful work.
Do not imply that delegation, persistence or verification occurred when it did not.

## Output and persistence

Lead with the decision, its support and the next useful action. Explain higher-
level investigations only to the extent needed to show what they contributed.
Do not claim optimality or exhaustive search.

Make the result easy to assess. Separate findings from assumptions, explain
consequential tradeoffs and use a compact comparison when it clarifies a choice.
Keep operational detail proportional to the user's needs.

Use the format and storage owned by the user's project or chosen framework.
Do not automatically create APPROACH.md, approach-log.tsv, handoff.md or a global
lessons file. Do not modify AGENTS.md/CLAUDE.md or require every work session to
load this skill.

Use an existing decision template when useful; do not require a companion
template or invent a new record format unnecessarily.

A conversational answer needs no file. When persistent records are requested or
required by the chosen workflow, use an established durable project location or
user-designated knowledge store. Do not use /tmp for decisions, plans, handoffs
needed across sessions or reusable lessons.

If the intended destination is not writable, report the constraint and preserve
the useful result in the available output. Never silently substitute temporary
storage or claim a save or installation succeeded.

Changes to this skill require the user's agreement; an explicit request to
update it supplies that agreement.

## Research checkpoint

The memory and delegation guidance was researched on 2026-11-14. Treat it as
conditional guidance: the underlying studies use different tasks, models,
budgets and evaluation methods. No cited study establishes this combined skill
as optimal. Permission defaults and storage modes are design choices, not
empirically established optimal policies.

Consult the relevant source when reconsidering a consequential choice; do not
reread every source or repeat the research on every invocation.

- Agent coordination comparisons:
  https://arxiv.org/html/2512.08296v3
  Coordination benefits depend on task and architecture in the evaluated
  configurations; additional agents do not reliably imply better outcomes.
- Selective model routing:
  https://arxiv.org/abs/2406.18665v4
  Evaluates trained model routers. Applying its findings to discretionary
  subagent model selection is a transfer assumption, not a tested result.
- Subagent capabilities and continuity guidance:
  https://code.claude.com/docs/en/sub-agents
  Product documentation for Claude Code, not comparative efficacy evidence.
  Continuity depends on agent type and environment; verify actual support.
- Repository context-file evaluation:
  https://arxiv.org/html/2602.11988v2
  Evaluates repository instruction files, not selectively retrieved insight
  stores. Its results caution against assuming extra context improves outcomes.
- Incremental context adaptation:
  https://arxiv.org/html/2510.04618v1
  Supports incremental context updates in its evaluated settings; it does not
  validate this skill's repository storage policy.
- Agent-memory design and limitations:
  https://www.anthropic.com/research/components-of-agent-memory
  Engineering findings and evaluations of memory components; applicability to
  this skill's repository insights requires judgment.

- Feedback-loop selection:
  https://michaelagreiler.com/pages/publications/media/DevEx-WhatDrivesProductivity.pdf
  The 2023 DevEx framework considers feedback loops, cognitive load and flow,
  combining developer experience with system/workflow measures. It motivates
  examining the complete feedback path rather than one tool's runtime. Transfer
  to AI-assisted implementation is a judgment, not measured evidence of savings
  from this skill. This guidance was revisited on 2026-11-14.
