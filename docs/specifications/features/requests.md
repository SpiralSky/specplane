---
id: feature/requests
title: Requests
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 17593fb2d8b9e511414505bbc75c799d37eb5297
  note: approved by the LLM, not a human, under the user's 2026-11-09 delegation (hand-edited; see docs/work-records/2026-11-09-spec-format.md)
  fingerprint: spec-v3:sha256:141a2583a7e3b4baef09af33a4e6b8f89712228d12a649f7b867d5cb65fad0db
  cited:
    R52: sec-v1:sha256:e7b41b16ba6c1c06265d8f137afe76ee0defddfecc4cdc1d63ad92e6cdee0d32
    R52.1: sec-v1:sha256:0a894f4ecc226b5ad80866361c97a4db4c0991ddaaab1e83688fc9f79759b909
    R52.2: sec-v1:sha256:c88fa9d3aaeda1eb43f1d9c5fc722c6a25d1e55aa15220b3018e688950f7c80b
    R52.3: sec-v1:sha256:7ccc6a564648284fe8be49fe5baac492b524f44fc81c43b8196cd89354d82de8
    R52.4: sec-v1:sha256:230a2f7f0579e2e8b5502686dcf17e9e96f894a76b5725f8c3cddc0f7efb376d
    R52.5: sec-v1:sha256:1eb02be688ace3461558f9963660c8f77bfa3793071cd4ba6b0b0b57832d959a
    plan-execution R27.1: sec-v1:sha256:eb372e0c9bc8e7d6356a33d6dfcea88ad37c6e2adec2470a2b7fa7464efc6783
    R18: sec-v1:sha256:f8638c210b1f25a3dcf8a55c5f3919bc18be649f8d396857afafd8c89e8f3e7a
    R27.5: sec-v1:sha256:836c1757cc94b4868c4b0557ccad75922afbe2139a05ac1904fa10fd92ae540f
    R27.5.1: sec-v1:sha256:c102ee66bb1aafea4a2e3eec4e38a2ccc629f1e2aac64e1f29429ad21b7c8352
    R27.5.2: sec-v1:sha256:18f5876b1b4c58dbc8c75ff778b67c4a391c668982cac78ffd471da255dc5ea8
    R59.1: sec-v1:sha256:4320f30d549eaa3702c1ea3f63e3344881bb71a010317f209e952d875ded4a67
    plan-execution R27.5: sec-v1:sha256:3a43aca88d2824049cc58660daae61614ab24c1132330cca61f1b2976b622b74
    plan-execution R27.5.1: sec-v1:sha256:72f8d7d67a253e4d40e858add1322f6df26964732e785a8ce0e2d3c0c597ed0a
    plan-execution R27.5.2: sec-v1:sha256:560a53b2f020e30bb892a3b85af257f7df553c955f10ef01139d8300be99ccdb
    roles-and-permissions R50: sec-v1:sha256:6e06bc008e3c498900010a6e4117f60f0626279609ce22d6b0bcb36c4c245ce2
    roles-and-permissions R57: sec-v1:sha256:1b06f3e6eaf07d7054ecb2cfcd8fb151df181db7d98bba461eae8802dd944f38
    roles-and-permissions §2: sec-v1:sha256:e14c6ef033b445261b57332bf2eb941691aae0ac6d1c884fa4e9a594470000af
    steering R59: sec-v1:sha256:7078d03a4c2a8767271e37f7c1b6ed4551ee563aa732399d8e620e759d99deb4
    configuration R25: sec-v1:sha256:e07f837db35bfe39bbd28e56e36f3bbb1d0afc25bc3b8784f90a92be6d49b071
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R52, R52.1, R52.2, R52.3, R52.4, R52.5]
references: [plan-execution R27.1, R18, R27.5, R27.5.1, R27.5.2, R59.1, plan-execution R27.5, plan-execution R27.5.1, plan-execution R27.5.2, roles-and-permissions R50, roles-and-permissions R57, roles-and-permissions §2, steering R59, configuration R25]
---

# Requests

A request is how an LLM asks the user to approve an action it is not allowed to do alone. It lets a permission sit between allow and deny: the LLM says what it wants done, the user looks at it, and the action happens only if the user accepts. This spec describes the requests list, the command that opens it, who may accept a request, when a request is sent, how it is shown to the user, and notifications. Requests are part of the first release (Phase 1 of `docs/release-plan.md`); nothing here is a later release.

How requests behave inside a plan run (blocking and non-blocking, `R27.5`, `R27.5.1`, `R27.5.2`) is described in `plan-execution R27.5`, `plan-execution R27.5.1` and `plan-execution R27.5.2`. This spec does not repeat it.

## §1 Terms

- **Request:** a message from an LLM (or from a command run under an LLM role) to the user, naming one action and asking that it be done. It is pending until it is accepted or declined.
- **Requests list:** the single list of all requests, whether or not a session is active. It keeps pending requests until the user answers them.
- **Accept:** the user approves the request, and the requested action is done. **Decline:** the user refuses it, and nothing changes.

## R52: Requests System

A requests system exists so that LLMs can send requests to the user to approve. Every permission can be set to `request user` as an alternative to allow and deny (`R52.3`, `roles-and-permissions R50`).

- A request names the action that is asked for, who sent it, and why, in plain words. It is added to the requests list.
- If there is no active session, for example when a plan runs in the background, the request still goes to the requests list. The user can accept it later, in a later session.
- A request that is never answered stays pending. It does nothing by itself and does not expire.
- A request that is declined, or never accepted, leaves everything as it was. The action is not done, in part or in full.
- Accepting a request does the requested action once, as it was requested. If the situation has changed, for example a specification was edited after the request was sent, the user is shown the request against the current state, and the action is checked again when it is accepted (`R52.2`).

Test T1 (deterministic): set a permission to `request user`, run the action as the LLM role, expect no change and one pending request; accept it as a role with the permission and expect the change; repeat and decline, expect no change.

Scenario: Given a permission set to `request user` and no active session, When a background plan step needs that action, Then a request appears in the requests list, and the step continues without the action or the plan stops (`plan-execution R27.5.1`, `plan-execution R27.5.2`); the user accepts it the next day.

### R52.1: Requests Command

A command opens an interactive requests pane in the harness. In it the user can view all requests, open one to read it in full, and accept or decline it.

- The pane shows pending requests first, and shows enough of each to decide: the sender, the action, and the reason. A request that involves a specification shows the difference as in `R52.4`.
- Requests that were already answered are visible in the pane for context, marked as accepted or declined.
- Like other harness commands, the harness runs the command itself and passes arguments to the LLM only if there are any (`R18`).

### R52.2: Requests Permissions

To accept a request, the role of the person accepting must have the permission to do what is requested. For example, to accept a request to change a plan's status, the role needs the permission to change plan statuses.

- The check is made at the moment of acceptance, against the permissions in force then (`roles-and-permissions §2`). Changing the active preset does not rewrite pending requests.
- A role without the permission cannot accept the request. Acceptance fails, the user is told which permission is missing, and the request stays pending (`roles-and-permissions §2`).
- The permission of the role to accept is the permission to do the action, not a separate "accept requests" permission. A role that holds the permission with mode `allow` may accept. A role whose own mode for it is `request user` or `deny` may not, because a user's request to the user would go nowhere.
- Accepting never gives the LLM the permission. The action is done once, on the user's authority.
- Approvals stay with a human: when the requested action is approving a specification, a plan or a decision, accepting needs a role that has the approval permission, and an LLM role cannot accept (`roles-and-permissions R57`).

Test T1 (deterministic): with a role lacking the permission for the requested action, try to accept and expect failure with the request still pending; with a role holding it, expect success.

### R52.3: Request Permission Type

`request user` in every section of the requirements means sending a request to the harness user through the requests system. It exists globally for every permission, along with allow and deny.

- Under `request user` the action is not done. A request is sent and the action is done only if the user accepts it.
- A role with allow may still send a request, or ask the user to run a command instead of acting, when steering says so (`R59.1`, `steering R59`). Without such steering, a role with allow acts directly.
- A role with deny cannot send a request for that action. Deny is final; if the user wants the action, they change the permission or do it themselves.
- Examples: with the Full Manual Editing preset, editing specifications is denied, so no request to edit a specification can be sent, and a plan step that needs one stops (`roles-and-permissions R57`, `plan-execution R27.1`). In the presets where the LLM role has `request user` for editing a type of specification, the edit is sent as a request.

Test T1 (intelligent): read the default presets and check that every `request user` permission produces a request, that deny never does, and that allow produces one only when steering asks for it.

### R52.4: Request Dialogue

If a session is active, a new request opens a dialogue for the user to view and answer it. If the user closes the dialogue without answering, the request stays pending in the requests list (`R52.1`).

- A request that involves a specification shows the difference from the last approved version of that specification, in git diff style: additions in green and deletions in red. If the specification has never been approved, the whole text is shown as additions.
- Other requests show the action and the reason in plain words, with the parameters of the action (for example the plan and the status it would change to).
- If several requests arrive at once, they are shown one after another and none is lost.

Scenario: Given the LLM role with spec editing set to `request user`, When the LLM proposes a change to an approved feature specification, Then the user sees a dialogue with the changed lines in green and red against the last approved text, and the specification is edited only if the user accepts.

### R52.5: Request Notifications

If the harness supports push notifications, new requests can be sent to the user as push notifications.

- This is configurable overall and per permission. It is disabled by default.
- A notification carries only a short summary and says that a request is pending; the user answers in the requests pane or dialogue, never from the notification alone.
- A harness without push support ignores the setting. Requests are still in the requests list.
- The names of the configuration keys are left to `configuration R25`.

## §2 Edge cases

- A request for an action the user could do directly gives the same result either way; the request only moves the decision to the user.
- If the requested action has become impossible when it is accepted (for example the plan was deleted), acceptance reports that and does nothing.
- Pending requests are shown in a plan's final review (`R27.5.2`, `plan-execution R27.5.2`).
