---
id: feature/configuration
title: Configuration
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R25, R25.1, R54]
references: [R12, R13.1, R22, R24.1, R32, R36.1, R36.3, R42, R47, R51, R52.5, R61.4, harness R14, plan-execution R27, plan-execution R31, requests R52, roles-and-permissions R50, roles-and-permissions R56, roles-and-permissions R57, specifications R9, steering R51, steering R59, verification R12, verification R13, verification R61]
---

# Configuration

Configuration is how a project and its users adjust Specplane's behaviour without changing Specplane itself. This spec lists every setting, what it means, its default, and who may change it. It also describes how permissions are documented so that people and LLMs can always read what each permission allows. Settings are shared with the project like other project files, so a change is visible to everyone working on it. Most settings are part of the first release (Phase 2 of `docs/release-plan.md`); the settings that belong to later releases are marked.

## §1 Terms

- **Setting**: one named option with a value, for example `auto_warn`.
- **Default**: the value used when a project does not set the option. A project with no configuration at all works with every default.
- **Configuration change**: setting, changing or removing any setting, including which preset is active.

## R25: Accessible Configurations

Every setting can be read and changed both from the CLI and from the harness. A person sees the current value of a setting, whether it is the default or has been set, and what the default is. Changing a setting in one place is immediately the value in the other.

- A setting that is not set uses its default, and a project is never required to configure anything.
- Setting a value to its default, or removing the setting, has the same effect.
- A change to a setting takes effect for the next command; it does not change work already done. For example, changing the audit retention affects what is kept from the next command on.
- A setting that does not apply to the current harness is accepted and ignored there (for example push notifications in a harness without them).
- The names below are what the user sees in commands and documentation. Each setting is described in the user documentation with its default (`R22`).

### Settings

Plans and worktrees (`plan-execution R27`, `plan-execution R31`):

| Setting | Meaning | Default |
|---------|---------|---------|
| `plans.worktree_dir` | Folder in which plan worktrees are created, one subfolder per plan | A folder next to the project |
| `plans.setup_command` | Command run once in a new plan worktree, for example to install dependencies. If it fails, the plan does not start | None |
| `plans.start_conditions` | `on` requires the plan and every specification it already references to be Approved before the plan starts; `off` skips that check | `on` |

Requests and steering (`requests R52`, `steering R59`, `steering R51`):

| Setting | Meaning | Default |
|---------|---------|---------|
| `notifications.push` | Whether requests are sent as push notifications, in a harness that supports them (`R52.5`) | `off` |
| `notifications.push_permissions` | The permissions whose requests are pushed when `notifications.push` is on; by default all of them. A permission left out is shown only in the requests list | All permissions |
| `steering.custom` | Custom steering added to a permission or command, in addition to the generated steering. May be general (a whole permission) or specific (a permission for one spec type or plan) | None |

Roles and permissions (`roles-and-permissions R57`, `roles-and-permissions R56`):

| Setting | Meaning | Default |
|---------|---------|---------|
| `permissions.preset` | The active preset, one of the four default presets. In a later release also a preset the user has created | The first default preset |

Harness (`harness R14`, `specifications R9`):

| Setting | Meaning | Default |
|---------|---------|---------|
| `harness.instructions` | A replacement text for the instructions delivered with a command. It changes only the text; limits Specplane checks itself still apply | The command's documentation |
| `harness.retrieval_include_references` | Whether retrieving a specification also includes the sections it references, when the request does not say | `off` |
| `authorship.record_llm` | Whether the harness adds the LLM as an author when it writes or changes a specification | `on` |

Verification (`verification R12`, `verification R13`, `verification R61`):

| Setting | Meaning | Default |
|---------|---------|---------|
| `audit.retention` | How long audit log entries are kept, in days, or `forever` (`R13.1`) | 30 days |
| `auto_warn` | Whether each command ends by reporting the number of warnings (`R24.1`) | `on` |
| `architecture.llm_may_mark_implemented` | Whether an LLM may mark an architecture specification implemented once its checks pass (`R36.1`). When `off`, only a person can | `on` |
| `tests.logs` | Where full test logs are kept: `local`, `git` or `off` (`R61.4`) | `local` |
| `tests.logs_retention` | How long local test logs are kept, in days, or `forever`. Does not apply to logs kept in git | 30 days |
| `pre_commit.duplicate_requirement_ids` | Installs a check that refuses a commit in which two requirements share an identifier (`R32`). Later release | `off` |
| `pre_commit.tests` | Installs a check that refuses a commit when the deterministic tests of an architecture specification fail (`R36.3`). Later release | `off` |

- Choosing `git` for `tests.logs` makes Specplane tell the user that logs in git can expose private information and are not removed by retention (`verification R61`).
- Turning on a pre-commit setting installs the check and turning it off removes it, the same way for both (`verification R12`).
- Settings that existed in earlier versions and no longer have a meaning are not part of configuration. This includes the per-type LLM role and authorship policy, the architecture-leak guard, overlay roots, the plan status source and the plan dependency mode. Their purpose is now served by permissions, requests and steering.

### Validation

Validation checks the configuration (`verification R12`, `R12`).

- An unknown setting is reported, so that a misspelled setting does not silently leave the default in place.
- A malformed setting is reported: a value of the wrong kind (for example text where `on` or `off` is expected), a number that is not positive, a folder that cannot be used, or a permission or preset that does not exist.
- A report names the setting, what is wrong and what is allowed. A bad setting is ignored and its default applies until it is fixed; it never makes Specplane unusable.

Test (deterministic): set a setting that does not exist and set `auto_warn` to a word that is not `on` or `off`; validation reports both by name, and the commands still run with the defaults.

Scenario: Given `auto_warn` is `on`, When the user turns it off in the CLI, Then the next command does not report the warning count and the harness shows the same value.

### R25.1: Configuration Permissions

Changing configuration is a permission with the modes allow, request user and deny (`roles-and-permissions R50`). Presets set the mode for each role (`R42`, `roles-and-permissions R57`).

- In the default presets the user may change configuration, and the LLM role needs the user's agreement (request user). In the most restrictive preset the LLM role cannot change configuration at all (`roles-and-permissions R57`).
- Reading configuration needs no permission; anyone can see every setting.
- A change to the active preset is a configuration change like any other. An LLM can therefore not widen its own permissions unless its preset allows changing configuration (`R47`).
- With request user, the LLM sends a request showing the setting, the old value and the new value, and the change is made only if the user accepts (`requests R52`).
- Each configuration change is recorded in the audit log (`verification R13`).

Scenario: Given the LLM role has configuration set to request user, When the LLM wants to turn `auto_warn` off, Then the user sees a request with the old and new value and nothing changes until it is accepted.

Scenario: Given the LLM role has configuration set to deny, When the LLM tries to change `permissions.preset`, Then the change is refused with an instruction not to work around it, and the refusal is logged.

## R54: Permission Documentation

All permissions are documented, and the documentation can be read from both the CLI and the harness.

- For each permission the documentation shows its name, what it allows and what it does not, which command or action uses it, the mode it has in each default preset, and the steering attached to it (`R51`, `steering R51`).
- A person can ask for the mode of every permission under the active preset, for one permission, or for the whole documentation of one permission, including any custom steering (`steering R59`).
- The LLM can read the same documentation through the harness on demand, so that it can look up what it may do without having it repeated in every session (`harness R14`).
- The documentation always matches what Specplane does: the mode shown for a role is the mode that applies now, including after a change of the active preset.
- A permission that has no documentation or no attached steering is reported as a warning (`verification R12`).
- The same documentation includes which role the reader currently has, so that the answer to "may I do this" is shown for the reader and not only in general.
- Permission documentation is information, and reading it never needs a permission.

Test (deterministic): list the permissions in the CLI and the harness for the same preset; expect identical names and modes, and a warning when a permission is added without steering.

## §2 Edge cases

- If two places set the same setting, the project's saved configuration is the single source; there is no per-user override in the first release.
- A setting with the value of the default that is explicitly written is kept as written, and removing it is not a change in behaviour.
- A configuration change cannot be made by editing around a denied permission: the harness stops such edits where it can, and otherwise validation and the audit log show the change afterwards (`R47`).
- Changing `permissions.preset` does not change pending requests; they are checked when accepted (`requests R52`).
- Settings for a later release can be written already; until the release exists they have no effect and validation does not report them as unknown.
