# Implementation verification and freshness

Only architecture specifications have implementation status: `implemented` or `unimplemented`. Review approval is independent. Verification runs every declared deterministic check against the committed content at HEAD, ignoring uncommitted changes.

```sh
specplane test run architecture/example --json
specplane spec implement architecture/example --json
```

Replace `architecture/example` with an existing architecture specification ID. Running tests shows their outcomes; recording follows the separate `test.record` permission. Marking implemented requires that permission with mode allow, passing deterministic checks from this run, and current harness verdicts for every section requiring intelligent judgement. Missing verdicts are reported as needing a harness. Every current failed result blocks implementation.

Implementation evidence is stored in git notes on the verified commit without changing the specification body or approving it. Code-only commits preserve implementation status; changing the specification content makes it unimplemented, even when the original text is later restored. Passing checks provide evidence, not a guarantee of correctness.
