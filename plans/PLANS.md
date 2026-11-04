<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane plan index -->

# Plans

## Active plans

| ID | Title | Status | Target | Dependencies | Specs |
|----|-------|--------|--------|--------------|-------|
| [2026-10-30-plan-conductor](2026-10-30-plan-conductor/PLAN.md) | Plan conductor — plan run, session mode, and alerts | ready | repository default | [2026-10-30-plan-primitives](archive/2026-10-30-plan-primitives/PLAN.md) | architecture/reference-cli, architecture/agent-skills, feature/plan-execution, feature/configuration, feature/spec-precedence, feature/agent-integration, claude:architecture/claude-integration, claude:feature/claude-integration |
| [2026-11-01-claude-delivery](2026-11-01-claude-delivery/PLAN.md) | Claude extension-owned workflow delivery | draft | repository default | [2026-11-01-extension-packaging](2026-11-01-extension-packaging/PLAN.md) | architecture/reference-cli, architecture/agent-skills, claude:architecture/claude-integration, claude:feature/claude-integration |
| [2026-11-01-codex-delivery](2026-11-01-codex-delivery/PLAN.md) | Codex existing-session delivery | draft | repository default | [2026-11-01-extension-packaging](2026-11-01-extension-packaging/PLAN.md) | architecture/reference-cli, architecture/agent-skills, codex:architecture/codex-integration, codex:feature/codex-integration |
| [2026-11-01-extension-conformance](2026-11-01-extension-conformance/PLAN.md) | Cross-package conformance and rollout evidence | draft | repository default | [2026-11-01-claude-delivery](2026-11-01-claude-delivery/PLAN.md), [2026-11-01-codex-delivery](2026-11-01-codex-delivery/PLAN.md) | architecture/reference-cli, architecture/agent-skills, architecture/file-formats, codex:architecture/codex-integration, claude:architecture/claude-integration |
| [2026-11-01-extension-packaging](2026-11-01-extension-packaging/PLAN.md) | Compatible packages and recoverable installation | draft | repository default | [2026-11-02-product-docs](2026-11-02-product-docs/PLAN.md) | architecture/reference-cli, architecture/agent-skills, feature/agent-integration |
| [2026-11-01-manual-lifecycle](2026-11-01-manual-lifecycle/PLAN.md) | Human gates and neutral CLI lifecycle | draft | repository default | [2026-11-01-workflow-recording](2026-11-01-workflow-recording/PLAN.md) | architecture/reference-cli, architecture/agent-skills, feature/spec-policies, feature/plan-execution, feature/configuration, feature/decisions, feature/agent-integration |
| [2026-11-01-workflow-recording](2026-11-01-workflow-recording/PLAN.md) | Prepared workflows and exact recording | draft | repository default | [2026-11-02-plan-index](2026-11-02-plan-index/PLAN.md), [2026-11-02-target-lifecycle](2026-11-02-target-lifecycle/PLAN.md) | architecture/reference-cli, architecture/agent-skills, architecture/file-formats, feature/plan-steps, feature/spec-policies |
| [2026-11-02-completion-assessment](2026-11-02-completion-assessment/PLAN.md) | Implementation declarations and content assessment | draft | repository default | [2026-11-01-core-foundation](archive/2026-11-01-core-foundation/PLAN.md) | architecture/reference-cli, architecture/file-formats, feature/spec-system, feature/tooling, feature/spec-policies |
| [2026-11-02-plan-index](2026-11-02-plan-index/PLAN.md) | Explicit plan-index snapshots and lifecycle generation | blocked | repository default | [2026-11-02-target-lifecycle](2026-11-02-target-lifecycle/PLAN.md) | architecture/reference-cli, architecture/file-formats, architecture/ci, feature/plan-index, feature/tooling |
| [2026-11-02-product-docs](2026-11-02-product-docs/PLAN.md) | Offline product documentation and release orientation | draft | repository default | [2026-11-01-manual-lifecycle](2026-11-01-manual-lifecycle/PLAN.md), [2026-11-02-completion-assessment](2026-11-02-completion-assessment/PLAN.md), [2026-11-02-plan-index](2026-11-02-plan-index/PLAN.md) | architecture/reference-cli, architecture/file-formats, architecture/agent-skills, feature/agent-integration, feature/tooling |
| [2026-11-02-target-lifecycle](2026-11-02-target-lifecycle/PLAN.md) | Target binding and lifecycle reconciliation | ready | repository default | [2026-11-01-core-foundation](archive/2026-11-01-core-foundation/PLAN.md) | architecture/reference-cli, architecture/file-formats, feature/plan-execution, feature/configuration, feature/tooling, feature/plan-system |

## Archived plans

| ID | Title | Status | Target | Specs |
|----|-------|--------|--------|-------|
| [2026-10-28-reference-cli-core](archive/2026-10-28-reference-cli-core/PLAN.md) | Reference CLI core — validate and generate commands | done | repository default | feature/tooling, feature/configuration, feature/spec-system, feature/plan-system, feature/plan-steps, feature/plan-index, feature/spec-overlays, architecture/reference-cli, architecture/file-formats, architecture/repository-layout, architecture/agent-skills |
| [2026-10-29-assist-and-approve](archive/2026-10-29-assist-and-approve/PLAN.md) | Refine-then-write assist, the review role, and approval commands | done | repository default | feature/spec-policies, feature/configuration, feature/agent-integration, feature/tooling, architecture/agent-skills, architecture/reference-cli, architecture/file-formats, claude:feature/claude-integration, claude:architecture/claude-integration |
| [2026-10-29-claude-harness-files](archive/2026-10-29-claude-harness-files/PLAN.md) | Claude Code harness files — skills, hooks, CLAUDE.md | done | repository default | claude:feature/claude-integration, claude:architecture/claude-integration, feature/agent-integration, architecture/agent-skills |
| [2026-10-29-claude-instructions-and-enforcement](archive/2026-10-29-claude-instructions-and-enforcement/PLAN.md) | Claude harness — standing instructions, enforcement hooks, live view | done | repository default | claude:feature/claude-integration, claude:architecture/claude-integration, feature/agent-integration, architecture/agent-skills, architecture/file-formats |
| [2026-10-29-claude-plugin-hardening](archive/2026-10-29-claude-plugin-hardening/PLAN.md) | Claude plugin hardening — hook guards and HANDOFF button | done | repository default | claude:architecture/claude-integration, claude:feature/claude-integration |
| [2026-10-29-cli-claude-harness-init](archive/2026-10-29-cli-claude-harness-init/PLAN.md) | CLI init --harness claude, harness registry, and skill findings | done | repository default | claude:feature/claude-integration, claude:architecture/claude-integration, feature/agent-integration, feature/tooling, architecture/agent-skills, architecture/reference-cli |
| [2026-10-29-cli-forge-ci-publish](archive/2026-10-29-cli-forge-ci-publish/PLAN.md) | Forge integration, CI workflows, and npm publish setup | done | repository default | architecture/reference-cli, architecture/ci, feature/plan-execution, feature/plan-status, feature/configuration, feature/plan-index, feature/tooling |
| [2026-10-29-cli-plan-commands](archive/2026-10-29-cli-plan-commands/PLAN.md) | CLI plan commands, effective status, and live activity | done | repository default | feature/tooling, feature/plan-status, feature/plan-index, feature/plan-system, feature/plan-steps, architecture/reference-cli, architecture/file-formats |
| [2026-10-29-cli-plan-flows](archive/2026-10-29-cli-plan-flows/PLAN.md) | CLI plan flows — start, finish, abandon, cleanup, archive, restack | done | repository default | feature/plan-execution, feature/plan-status, feature/plan-steps, feature/tooling, feature/configuration, architecture/reference-cli, architecture/file-formats |
| [2026-10-29-cli-spec-search](archive/2026-10-29-cli-spec-search/PLAN.md) | CLI spec and search commands, validation hardening | done | repository default | feature/tooling, feature/spec-system, feature/spec-overlays, feature/spec-precedence, feature/decisions, feature/configuration, architecture/reference-cli, architecture/file-formats |
| [2026-10-29-feature-spec-alignment](archive/2026-10-29-feature-spec-alignment/PLAN.md) | Align architecture specs and CLI with applied feature specs | done | repository default | feature/configuration, feature/decisions, feature/plan-index, feature/plan-status, feature/plan-steps, feature/plan-system, feature/spec-precedence, feature/tooling, architecture/reference-cli, architecture/file-formats, architecture/agent-skills, claude:feature/claude-integration, claude:architecture/claude-integration |
| [2026-10-30-plan-primitives](archive/2026-10-30-plan-primitives/PLAN.md) | Plan primitives — next, step-done, and harness doc fixes | done | repository default | architecture/reference-cli, architecture/agent-skills, feature/plan-status, feature/agent-integration, claude:architecture/claude-integration, claude:feature/claude-integration |
| [2026-11-01-core-foundation](archive/2026-11-01-core-foundation/PLAN.md) | Core contracts, coordination and provenance | done | repository default | architecture/reference-cli, architecture/file-formats, feature/tooling, feature/agent-integration |

## Dependency graph

```mermaid
graph TD
    p_2026_10_28_reference_cli_core[reference-cli-core]:::done
    p_2026_10_29_assist_and_approve[assist-and-approve]:::done
    p_2026_10_29_claude_harness_files[claude-harness-files]:::done
    p_2026_10_29_claude_instructions_and_enforcement[claude-instructions-and-enforcement]:::done
    p_2026_10_29_claude_plugin_hardening[claude-plugin-hardening]:::done
    p_2026_10_29_cli_claude_harness_init[cli-claude-harness-init]:::done
    p_2026_10_29_cli_forge_ci_publish[cli-forge-ci-publish]:::done
    p_2026_10_29_cli_plan_commands[cli-plan-commands]:::done
    p_2026_10_29_cli_plan_flows[cli-plan-flows]:::done
    p_2026_10_29_cli_spec_search[cli-spec-search]:::done
    p_2026_10_29_feature_spec_alignment[feature-spec-alignment]:::done
    p_2026_10_30_plan_conductor[plan-conductor]:::ready
    p_2026_10_30_plan_primitives[plan-primitives]:::done
    p_2026_11_01_claude_delivery[claude-delivery]:::draft
    p_2026_11_01_codex_delivery[codex-delivery]:::draft
    p_2026_11_01_core_foundation[core-foundation]:::done
    p_2026_11_01_extension_conformance[extension-conformance]:::draft
    p_2026_11_01_extension_packaging[extension-packaging]:::draft
    p_2026_11_01_manual_lifecycle[manual-lifecycle]:::draft
    p_2026_11_01_workflow_recording[workflow-recording]:::draft
    p_2026_11_02_completion_assessment[completion-assessment]:::draft
    p_2026_11_02_plan_index[plan-index]:::blocked
    p_2026_11_02_product_docs[product-docs]:::draft
    p_2026_11_02_target_lifecycle[target-lifecycle]:::ready
    p_2026_10_29_feature_spec_alignment --> p_2026_10_29_assist_and_approve
    p_2026_10_29_claude_harness_files --> p_2026_10_29_claude_instructions_and_enforcement
    p_2026_10_28_reference_cli_core --> p_2026_10_29_cli_claude_harness_init
    p_2026_10_28_reference_cli_core --> p_2026_10_29_cli_forge_ci_publish
    p_2026_10_29_cli_plan_flows --> p_2026_10_29_cli_forge_ci_publish
    p_2026_10_28_reference_cli_core --> p_2026_10_29_cli_plan_commands
    p_2026_10_29_cli_spec_search --> p_2026_10_29_cli_plan_commands
    p_2026_10_28_reference_cli_core --> p_2026_10_29_cli_plan_flows
    p_2026_10_29_cli_plan_commands --> p_2026_10_29_cli_plan_flows
    p_2026_10_28_reference_cli_core --> p_2026_10_29_cli_spec_search
    p_2026_10_30_plan_primitives --> p_2026_10_30_plan_conductor
    p_2026_11_01_extension_packaging --> p_2026_11_01_claude_delivery
    p_2026_11_01_extension_packaging --> p_2026_11_01_codex_delivery
    p_2026_11_01_claude_delivery --> p_2026_11_01_extension_conformance
    p_2026_11_01_codex_delivery --> p_2026_11_01_extension_conformance
    p_2026_11_02_product_docs --> p_2026_11_01_extension_packaging
    p_2026_11_01_workflow_recording --> p_2026_11_01_manual_lifecycle
    p_2026_11_02_plan_index --> p_2026_11_01_workflow_recording
    p_2026_11_02_target_lifecycle --> p_2026_11_01_workflow_recording
    p_2026_11_01_core_foundation --> p_2026_11_02_completion_assessment
    p_2026_11_02_target_lifecycle --> p_2026_11_02_plan_index
    p_2026_11_01_manual_lifecycle --> p_2026_11_02_product_docs
    p_2026_11_02_completion_assessment --> p_2026_11_02_product_docs
    p_2026_11_02_plan_index --> p_2026_11_02_product_docs
    p_2026_11_01_core_foundation --> p_2026_11_02_target_lifecycle
    classDef draft fill:#f9fafb,color:#374151,stroke:#d1d5db
    classDef ready fill:#22c55e,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef in_progress fill:#3b82f6,color:#fff
    classDef review fill:#60a5fa,color:#fff
    classDef done fill:#9ca3af,color:#fff
    classDef abandoned fill:#9ca3af,color:#fff,text-decoration:line-through
    classDef shelved fill:#fef3c7,color:#92400e,stroke:#d97706
```
