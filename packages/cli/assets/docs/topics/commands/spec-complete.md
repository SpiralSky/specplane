# Verify an architecture specification is implemented

`spec implement` verifies an existing architecture specification on HEAD and records it as implemented only when all its checks pass. No plan is required.

```sh
specplane spec implement architecture/example --json
```

Replace the example identifier with an architecture specification ID or a unique slug. The command runs deterministic tests against committed content and ignores uncommitted changes. Intelligent judgement comes from current results recorded by an LLM in a harness; the CLI reports missing verdicts as `needs harness` and leaves implementation status unchanged. A current failed result also refuses implementation.

Recording implementation needs `test.record` with mode allow. An LLM additionally needs `architecture.llm_may_mark_implemented` enabled. JSON reports the tested commit, outcomes, missing checks, harness requirements and whether implementation was recorded. Evidence goes into git notes without changing the spec body or its approval. The former `spec complete` and `spec implementation` declaration commands have been removed.
