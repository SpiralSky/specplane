---
title: Configuration
summary: The configuration file, its format and every setting with its default.
related: [permissions, verification, harnesses]
---

# Configuration

All project settings live in `.specplane/config.yaml`. Every key is optional; a key you leave out has its default. Specplane reads the file as committed at `HEAD`, so a change counts once it is committed, and it warns when the working-tree file differs.

```yaml
paths:
  requirements: docs/requirements
  features: docs/specifications/features
  architecture: docs/specifications/architecture
plans:
  dir: plans
permissions:
  preset: architecture-level-llm-control
audit:
  retention: 30
```

Settings are nested by their dotted key: `audit.retention` is `retention` under `audit`. Read them with `config get [key]` or `config list`, which show the value, whether it is set or the default, and the default. Change them with `config set <key> <value>` and `config unset <key>`, which needs the `config.change` permission. An unknown key, or a key of the older model (`spec_roots`, `specs`, `llm_role`, `authorship` as a block, `execution`, `verification`), is reported by `validate`.

Value types: `on` or `off` for switches, whole numbers for counts, folders relative to the repository root, and a number of days or `forever` for retention.

## Settings and defaults

Settings marked later release are read and validated but do nothing yet.

| Key | Default | Meaning |
|-----|---------|---------|
| `paths.requirements` | `docs/requirements` | Folder of the requirements files |
| `paths.requirements_index` | `none (the rule of file-formats §1.2)` | File name of the central requirements file |
| `paths.features` | `docs/specifications/features` | Folder of the feature specifications |
| `paths.architecture` | `docs/specifications/architecture` | Folder of the architecture specifications |
| `paths.test_logs` | `docs/test-logs` | Folder of test logs kept in git (used only when tests.logs is git) |
| `plans.dir` | `docs/plans` | Folder of the plans |
| `plans.worktree_dir` | `a folder next to the project` | Folder in which plan worktrees are created, one subfolder per plan |
| `plans.setup_command` | `none` | Command run once in a new plan worktree; if it fails the plan does not start |
| `plans.start_conditions` | `on` | on requires the plan and the specifications it references to be Approved before it starts |
| `plans.parallelism` | `1` | (later release) Greatest number of tasks in a plan step run at once |
| `notifications.push` | `off` | Whether requests are sent as push notifications, in a harness that supports them |
| `notifications.push_permissions` | `["all"]` | Permissions whose requests are pushed when notifications.push is on |
| `steering.custom` | `[]` | Custom steering added to a permission or command: items {permission|command, scope, text}; command '*' applies overall; scope is all, a spec type, or a plan id |
| `permissions.preset` | `architecture-level-llm-control` | The active preset: one of the four default presets or a custom preset |
| `harness.install_block` | `on` | off stops setup writing the marked block into shared instruction files |
| `harness.separation_check` | `on` | Whether the optional feature and architecture separation instructions are used |
| `harness.instructions` | `{}` | Replacement text for the instructions delivered with a command: harness.instructions.<command> |
| `harness.retrieval_include_references` | `off` | Whether retrieving a specification also includes the sections it references |
| `authorship.record_llm` | `on` | Whether the harness adds the LLM as an author when it writes or changes a specification |
| `audit.retention` | `30` | Days audit log entries are kept, or forever |
| `auto_warn` | `on` | Whether each command ends by reporting the number of warnings |
| `architecture.llm_may_mark_implemented` | `on` | Whether an LLM may mark an architecture specification implemented once its checks pass |
| `tests.logs` | `local` | Where full test logs are kept |
| `tests.logs_retention` | `30` | Days local test logs are kept, or forever |
| `pre_commit.duplicate_requirement_ids` | `off` | Check that refuses a commit in which two requirements share an identifier |
| `pre_commit.tests` | `off` | Check that refuses a commit when the deterministic tests of an architecture specification fail |
| `coverage.requirement_only` | `[]` | Requirements annotated as requirement-only; uncovered warnings are still reported |
| `decisions.enabled` | `off` | Whether user decision records are stored and retrieved |
| `subprojects` | `[]` | The named locations in the project that are subprojects: items `{name, path}`; the folder holds `requirements/`, `features/` and `architecture/` |
| `strict_mode.enabled` | `off` | Strict mode as a whole: the optional tighter lock-down of roles (off by default) |
| `strict_mode` | `{}` | Each strict mode measure on its own (default on while strict mode is on): strict_mode.<measure> |
| `bypass_guards` | `{}` | Each guardrail against permission bypass on its own (default on): bypass_guards.<measure> |

## Reading the notes

`audit.retention` and `tests.logs_retention` default to 30 days; see `verification` for what is kept and for the warning about logs kept in git. See `permissions` for the presets, and `plans` for plan folders and worktrees.

## Subprojects

A subproject is a part of the project with its own feature and architecture specifications and, optionally, its own requirements. Declare each one in `.specplane/config.yaml`:

```yaml
subprojects:
  - {name: claude, path: harnesses/claude/specs}
```

The folder at `path` holds `requirements/` (optional), `features/` and `architecture/`. A name is lowercase with dashes, unique, and not `root` or `file`; paths must be inside the repository and must not contain each other. Edit the file and commit it, like any other setting.

- A cite in a subproject without a project name means that subproject. Write `root:R5` for the root project and `claude:R7` or `claude:harness R14` for another project. A subproject with no requirement files of its own uses the root project's requirements for plain requirement cites.
- Requirement IDs are unique within the root project and within each subproject; the same ID may appear in two projects.
- `validate` checks each subproject and names the project in every finding, with a count per project. The root project's requirements outrank a subproject's: a subproject requirement with the title of a root requirement but a different text is a warning to resolve, and the root requirement wins.
- Name a subproject specification with its project: `claude:feature/harness`. Use that ID with `approve`, `reopen`, `override`, `validate`, `coverage` and test or implementation records; root specifications keep their plain IDs. A specification that cites one in another project stays awaiting review until the cited one is approved. Coverage names subproject items the same way (`claude:R7`). Inside a subproject, `R5` and `root:R5` mean different requirements.
