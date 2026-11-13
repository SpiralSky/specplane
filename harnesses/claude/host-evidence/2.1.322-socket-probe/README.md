# Claude Code 2.1.322 Plugin Socket Probe

Evidence fixture for HANDOFF.md unit 1 (mod-spawned long-lived Node core over Unix socket).

**Status: prepared for live testing, not live-verified.** API signatures were checked
against the locally installed declarations written by Claude Code 2.1.312; 2.1.322
is the intended live target from the handoff. This fixture is not shipped with the
plugin and does not expose Specplane actions or authorize caller identity.

## Architecture & Design Choices

1. **Mod Spawn (`$.process.spawn`)**: At `session.start`, the plugin spawns `hooks/server.cjs` with `argv: ['node', serverScript, socketPath]`. Standard input is closed immediately by the engine.
2. **Short Unix Socket Path**: The socket path is `/tmp/sp-probe-<sanitizedSessionId>.sock` (at most 59 ASCII bytes). The listener refuses an existing path and sets socket mode `0600`; it never removes a socket it did not bind.
3. **HTTP over Unix Socket (`$.http.fetch`)**: The registered probe tool sends requests with `{ socketPath }`.
4. **Engine-Provided Identity**: Main agent calls have no `e.agentId`; subagent calls carry `e.agentId` pinned by the engine. The mod resolves the agent type via `$.agent.list()` and forwards it in the request payload.
5. **Request Counter & PID**: The server tracks `process.pid` and increments `requestCount`, verifying repeated calls reuse the same process instance.
6. **Graceful Shutdown & Cleanup**: `session.end` posts to `/shutdown`, unlinking the socket file and exiting cleanly. Signal handlers (`SIGTERM`, `SIGINT`) also trigger cleanup.

## Draining vs. Not Draining the Spawn Stream

- **With draining**: The first pulls start the child and collect its readiness line. A background loop then reads the stream to completion and awaits `child.result`.
- **Without draining**: For a separate live run, set `serverStreamDraining = false` in `hooks/register.ts`. The readiness pull still starts the child, but later output is unconsumed. Call the tool with `action: "flood", size: 2097152` and compare with the draining run. The server replies only after its stdout write completes. Record whether it stalls or fails; this has not been observed in the host yet. Restore the flag afterward.
- Merely creating the stream without pulling it is a third condition: the declarations describe spawn as lazy. Ending the stream kills its child according to those declarations. Neither behavior is established by the Node-only tests.

## Observing Lifecycle & Crash Behavior

- **Normal Request**: POST `/probe` returns current PID and incremented request counter.
- **Controlled failure**: POST `/crash` returns HTTP 500 then exits with code 42, running Node's exit cleanup. This is not an uncatchable crash.
- **Unclean failure**: Kill only the PID returned by this probe with `SIGKILL`. Record child disappearance and stale socket presence. The offline test covers this case; a restart refuses the stale path. Remove that exact fixture socket only after confirming the old PID is gone. Automatic restart is outside this probe.
- **Stream Backpressure**: POST `/flood` causes the server to write large output to stdout, demonstrating whether the stream is properly drained.

## What Offline Checks Prove vs. Real Host

- **Offline tests prove**:
  - Node HTTP server binds to and serves requests over a Unix domain socket.
  - Process PID remains constant while request counter increments on successive requests.
  - Synthetic metadata is returned unchanged; this does not attest engine identity.
  - Graceful `/shutdown` unlinks the socket file and terminates the process.
  - Controlled `/crash` exits; `SIGKILL` leaves a stale socket that a new listener refuses to remove.
  - A Node parent draining stdout receives a 2 MiB burst. This does not prove QuickJS stream behavior.
- **Real host checks require**:
  - Live invocation inside Claude Code (`claude -p --plugin-dir`).
  - Host engine dispatch of `$.http.fetch` with `socketPath` in the QuickJS sandbox.
  - Subagent spawning with engine-pinned `agentId` and `$.agent.list()` populated.
  - Host process lifecycle hooks (`session.start`, `session.end`) timing.

## Live Verification by Coordinator

When authorized, test against live Claude Code:
```bash
claude -p --plugin-dir harnesses/claude/host-evidence/2.1.322-socket-probe "Use the socket_probe tool to check server PID, then spawn a subagent to do the same."
```

The handoff requires session-specific user agreement before temporarily changing
`bypass_guards.headless_block`. Do not disable it as part of this fixture. Repeat
the same calls interactively with the user. Record two main calls and a subagent
call: PID must stay fixed, counters must increase, and only the subagent should
carry an engine agent ID. `model` currently comes from `$.session.model()` and
must not be interpreted as proof of the subagent's own model.

Record process and socket state after normal session end, after killing the host,
and after killing the child. Bound each live run externally so the no-drain
experiment cannot hang indefinitely. Host cleanup after a crash remains unknown.

Offline validation, from `packages/cli`:
```sh
npm run build
SPECPLANE_TEST_RUNNER=bun sh scripts/test.sh ./dist/harness/claude-socket-probe.test.js
```
