# Implementation declarations and freshness

Implementation status is `incomplete`, `partial` or `complete`. Review status is independent. Declaring completion records an assessment of requirement content; it does not itself verify executable behavior.

```sh
specplane spec complete feature/example --dry-run --json
specplane spec implementation feature/example --status partial --dry-run --json
```

Replace `feature/example` with an existing specification ID. Preview first, inspect the result, then explicitly invoke the command without `--dry-run` to write metadata. These commands preserve the body and do not commit, stage, push, run tests or approve the specification.

A current assessment matches the recorded requirement fingerprints. Changes to a requirement or its dependency closure can make an earlier completion declaration stale. Inspect declaration and assessment separately; a stale declaration must not be presented as fresh evidence. Unrecorded implementation-revision evidence does not prove code verification.
