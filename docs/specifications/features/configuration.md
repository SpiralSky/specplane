---
id: feature/configuration
title: Configuration
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 17593fb2d8b9e511414505bbc75c799d37eb5297
  note: re-approved by the LLM, not a human, under the user's 2026-11-09 delegation after the session 16 fixes (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
  fingerprint: spec-v3:sha256:bc5cb2158b8f3f4fa7cfecebb10f18092c9ef5ca70ca9a8c4268d1dd4600d14e
  cited:
    R25: sec-v1:sha256:a35f2408fdd551133788666ca466d5fd6504c7d59501c92e5f4722324da14f6f
    R25.1: sec-v1:sha256:7c947cd0b93e0df3959701427d946506f2e4f6fb4276ac6217ac4822862c3cb3
    R54: sec-v1:sha256:99d04a3acc58df5c68825aa1c385927fdf6f1de62aef000abeb2a3d3ecaa6e0d
    later-releases R37: sec-v1:sha256:a56a6805e16e75b483b3459d08775ee9b700b0a479a8daa05075a6a014facc23
    R13.1: sec-v1:sha256:847f7387b19758600e7498a0b329fa4681747b474745e7bc10935acb0550fe61
    R22: sec-v1:sha256:3447e20b17238f3f89477fa7bffbdd2bc9ce994e0abedb6687f26536e580ceba
    R24.1: sec-v1:sha256:d6aba29cb588a161cab3725b6424c50ddb9d71c43d7e35d94c9cebd1f657270d
    R32: sec-v1:sha256:35f3b2987a59ef842f5820b86506385391407254f04027c8424055165ef611de
    R36.1: sec-v1:sha256:c20b9d48b9951357960cb9bd32ebd181f0bbc48d0cd2a826d619f2e1468efa2e
    R36.3: sec-v1:sha256:54a233af43c455e45238c0db36a73464b5f4631bf22b6a62faabec1ebe78ba91
    R42: sec-v1:sha256:b667bcbca6d9b5707ed8111550004d00564a7ed4427e459d81f17123977f12b7
    R47: sec-v1:sha256:fe34b03e48652f20bf25ef6b4e150b084b73f3d30a552a60d1ce3e1d50afb68c
    R51: sec-v1:sha256:84e8559eef7aeda622d975bdca68672a47f00e4e4ceba7f9468736143dd52768
    R52.5: sec-v1:sha256:1eb02be688ace3461558f9963660c8f77bfa3793071cd4ba6b0b0b57832d959a
    R61.4: sec-v1:sha256:5302283772fba54d0b0f69d5db1687c989430cd50a3e8cfec5f245df46f3866f
    harness R14: sec-v1:sha256:c55f58fe1dea4db1a9b76c56fc683dad6c33fb43da8bca5e125c7a55e7ddd0ad
    plan-execution R27: sec-v1:sha256:16be697fca95202f6580e27147551a2774b7edabed2ca7abceb3656e707507db
    plan-execution R31: sec-v1:sha256:07283bbef0618052d7e6cd60e6897bb733491dc49cbf7aabe08939fe8e768fce
    requests R52: sec-v1:sha256:4be72ae24a0b5e7c5b2eefb5802cfce58bb3673eef335e1e8496d43183631388
    roles-and-permissions R50: sec-v1:sha256:6e06bc008e3c498900010a6e4117f60f0626279609ce22d6b0bcb36c4c245ce2
    roles-and-permissions R56: sec-v1:sha256:bb5d5bfb69c08d216d818c2b0ccd916e21fa1d60b85785285302a95fdb94975e
    roles-and-permissions R57: sec-v1:sha256:1b06f3e6eaf07d7054ecb2cfcd8fb151df181db7d98bba461eae8802dd944f38
    specifications R9: sec-v1:sha256:faa3544c96036f5eb5010877f99d4e5bd3e346628f86440922d0b919ba0203e7
    steering R51: sec-v1:sha256:b3c2c9caabca37dd96851061c01a1d38acbb1c1ecfb56c76a8f674ccd8f86ae7
    steering R59: sec-v1:sha256:7078d03a4c2a8767271e37f7c1b6ed4551ee563aa732399d8e620e759d99deb4
    verification R12: sec-v1:sha256:484b62a0426573bb939604d0c9fc46e062bca21f980e03c62def28f142db4132
    verification R13: sec-v1:sha256:99caab386dc99044e2012a678aedafb986120fbe2a5250bd5bb919a773cdd240
    verification R61: sec-v1:sha256:8faf1fe8368dd68ecc9eaf7104385c4bf47d9db883e0bdcfbcf8323b9b38a87d
    later-releases R39: sec-v1:sha256:d4c8c3775db38dd07768b63a6a9d085d73723488c312455662e303036230dd47
    plan-execution R31.2: sec-v1:sha256:451758ee1a6bb0b41cc11814fddf4f249bf56481d6e0806cf8af467e011e3257
    roles-and-permissions R44: sec-v1:sha256:1936fdd41a426f2a4d76c443f8a2a2520b04d8ac949469f1cf9cadbdce59de01
    roles-and-permissions R44.1: sec-v1:sha256:de2157fc4b7cadad8daf8b776e801dc4e77ece1990d5623190b16287527da0f5
    roles-and-permissions R48: sec-v1:sha256:6f356da94bdc42153c9510674b379680dd638066226a3650520cff0a4f8ca2d5
    roles-and-permissions R55: sec-v1:sha256:f5d2bf684313f3759d3b312fc06c266ba043957215de27e4ee3784e89de38a80
    roles-and-permissions R55.1: sec-v1:sha256:20e7beb17ecd21102737f574b1c3c473e5861fa13d8db5d7723956088f7f2daf
    roles-and-permissions R58: sec-v1:sha256:d7ec215e8a95f13439d06e3727cf9048f635da9c3bf3b6f993671f6edf3944ff
    specifications R4: sec-v1:sha256:cd3d9f4708e83188bb585d825b4e678ddbeb0f889bbd892a17bfcf712ad93eb3
    verification R64: sec-v1:sha256:91a6b1828ee416b379dc02c2c97c18c6364b1256690ea4c6d3c89e950b1b4a2e
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R25, R25.1, R54]
references: [later-releases R37, R13.1, R22, R24.1, R32, R36.1, R36.3, R42, R47, R51, R52.5, R61.4, harness R14, plan-execution R27, plan-execution R31, requests R52, roles-and-permissions R50, roles-and-permissions R56, roles-and-permissions R57, specifications R9, steering R51, steering R59, verification R12, verification R13, verification R61, later-releases R39, plan-execution R31.2, roles-and-permissions R44, roles-and-permissions R44.1, roles-and-permissions R48, roles-and-permissions R55, roles-and-permissions R55.1, roles-and-permissions R58, specifications R4, verification R64]
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
| `harness.separation_check` | Whether the optional instructions that check feature and architecture separation and warn per change or review are used (`specifications R4`, `harness R14`) | `on` (assumption) |
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
| `coverage.requirement_only` | Requirements the owner keeps requirement-only, which coverage does not report (`verification R64`). Assumption: the page has no way to mark this | None |

Later releases:

| Setting | Meaning | Default |
|---------|---------|---------|
| `decisions.enabled` | Whether user decision records are stored and retrieved (`later-releases R37`). Later release | `off` |
| `subprojects` | The named locations in the project that are subprojects (`later-releases R39`). Later release | None |
| `plans.parallelism` | The greatest number of tasks in a plan step run at once (`plan-execution R31.2`). Later release | 1 |
| `strict_mode.enabled` and `strict_mode.<measure>` | Strict mode as a whole, and each of its measures (blocking direct file edits in the harness, git safeguards, operating system safeguards) on its own (`roles-and-permissions R55.1`). Later release | `off` |
| `bypass_guards.<measure>` | Each guardrail against permission bypass by headless sessions or the CLI inside an LLM session, on its own (`roles-and-permissions R58`). Later release | `on` (assumption) |
| `roles.os_user_mapping` | The optional mapping from operating system users to roles, kept locally per machine, not in git (`roles-and-permissions R44`). Later release | No mapping |
| `roles.llm_rules` | Rules that give a role to an LLM by subagent, agent type or provider (`roles-and-permissions R44.1`); custom roles and these rules are kept in git (`roles-and-permissions R48`). Later release | The default LLM role |

- Choosing `git` for `tests.logs` makes Specplane tell the user that logs in git can expose private information and are not removed by retention (`verification R61`).
- Turning on a pre-commit setting installs the check and turning it off removes it, the same way for both (`verification R12`).

### Validation

Validation checks the configuration (`verification R12`).

- An unknown setting is reported, so that a misspelled setting does not silently leave the default in place.
- A malformed setting is reported: a value of the wrong kind (for example text where `on` or `off` is expected), a number that is not positive, a folder that cannot be used, or a permission or preset that does not exist.
- A report names the setting, what is wrong and what is allowed. A bad setting is ignored and its default applies until it is fixed; it never makes Specplane unusable.

Test (deterministic): set a setting that does not exist and set `auto_warn` to a word that is not `on` or `off`; validation reports both by name, and the commands still run with the defaults.

Scenario: Given `auto_warn` is `on`, When the user turns it off in the CLI, Then the next command does not report the warning count and the harness shows the same value.

### R25.1: Configuration Permissions

Changing configuration is a permission with the modes allow, request user and deny (`roles-and-permissions R50`). Presets set the mode for each role (`R42`, `roles-and-permissions R57`).

- In every default preset the Standard User may change configuration (allow) and the LLM role needs the user's agreement (request user) (`roles-and-permissions R57`). A custom role can have deny.
- Reading configuration needs no permission; anyone can see every setting.
- A change to the active preset is a configuration change like any other. An LLM can therefore not widen its own permissions without the user's agreement (`roles-and-permissions R55`).
- With request user, the LLM sends a request showing the setting, the old value and the new value, and the change is made only if the user accepts (`requests R52`).
- Each configuration change is recorded in the audit log (`verification R13`).

Scenario: Given the LLM role has configuration set to request user, When the LLM wants to turn `auto_warn` off, Then the user sees a request with the old and new value and nothing changes until it is accepted.

Scenario: Given a custom role whose configuration permission is deny, When an LLM with that role tries to change `permissions.preset`, Then the change is refused with an instruction not to work around it, and the refusal is logged.

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
- The active preset (`permissions.preset`) is part of the first release (Phase 1 of `docs/release-plan.md`), while configuration as a whole is Phase 2; until configuration exists, the default preset is active.
- Settings for a later release can be written already; until the release exists they have no effect and validation does not report them as unknown.
