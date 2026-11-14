import type { AgentInfo, Register } from 'claude-code';

export const PROBE_TOOL = 'socket_probe';

/** Short Unix domain socket path (< 100 bytes) avoiding OS sockaddr_un buffer limits. */
export function getSocketPath(sessionId: string): string {
  const shortId = sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  if (!shortId) throw new Error('Missing session identity');
  return `/tmp/sp-probe-${shortId}.sock`;
}

export const register: Register = on => {
  let socketPath = '';
  const serverStreamDraining = true;

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    const sessionId = await $.session.id();
    socketPath = getSocketPath(sessionId);
    const serverScript = `${$.plugin.root}/hooks/server.cjs`;

    // 1. Spawn the long-lived Node HTTP listener process
    const child = $.process.spawn({
      argv: ['node', serverScript, socketPath],
      cwd: $.plugin.root,
    });

    // 2. Wait for child to report ready on stdout
    let startup = '';
    while (!startup.includes('\n')) {
      const piece = await child.next();
      if (piece.done) throw new Error(`Probe exited before readiness: ${piece.value.code}`);
      if (piece.value.stream === 'stdout') startup += piece.value.text;
    }
    if (!startup.startsWith('READY ')) throw new Error(`Unexpected probe startup: ${startup}`);
    $.ui.log(`probe: server ready on ${socketPath}`, { to: 'debug' });

    // 3. Drain stdout/stderr in background to prevent stream buffer exhaustion
    if (serverStreamDraining) {
      void (async () => {
        try {
          for await (const chunk of child) {
            $.ui.log(`probe [${chunk.stream}]: ${chunk.text.length} characters`, { to: 'debug' });
          }
          const res = await child.result;
          $.ui.log(`probe: server exited code=${res.code} signal=${res.signal}`, { to: 'debug' });
        } catch (err) {
          $.ui.log(`probe: stream drain error ${String(err)}`, { to: 'debug' });
        }
      })();
    }

    // 4. Register the probe tool
    await $.tool.register({
      name: PROBE_TOOL,
      description: 'Specplane socket probe tool for verifying long-lived process and engine identity',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['probe', 'crash', 'flood', 'shutdown'] },
          payload: { type: 'string' },
          size: { type: 'integer', minimum: 1, maximum: 4194304 },
        },
      },
      isDeferred: false,
    });

    return started;
  });

  on('tool.call', async ($, e, next) => {
    const toolName = e.tool;
    if (toolName !== PROBE_TOOL && toolName !== `mcp__${$.plugin.name}__${PROBE_TOOL}`) {
      return next(e);
    }

    // Host engine-provided agent identity: e.agentId is pinned only for subagents
    const agentId = e.agentId;
    let agentType: string | undefined;
    if (agentId) {
      const agents: AgentInfo[] = await $.agent.list();
      const match = agents.find(a => a.id === agentId);
      agentType = match?.type ?? 'unknown';
    }

    const sessionId = await $.session.id();
    const model = await $.session.model();
    const activeSocket = socketPath || getSocketPath(sessionId);
    const action = ((e as Record<string, unknown>).action as string) || 'probe';

    try {
      const response = await $.http.fetch(`http://localhost/${action}`, {
        method: 'POST',
        socketPath: activeSocket,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          agentId,
          agentType,
          sessionId,
          model,
          tool_use_id: e.tool_use_id,
          payload: (e as Record<string, unknown>).payload,
          size: (e as Record<string, unknown>).size,
        }),
      });

      const data = JSON.parse(response.text);
      // The host accepts a string or a content array as a tool result, not an object (observed on 2.1.322).
      return {
        result: JSON.stringify({
          status: response.status,
          serverPid: data.pid,
          requestCounter: data.requestCount,
          agentId,
          agentType,
          model,
          received: data.received,
        }),
      };
    } catch (err) {
      return {
        deny: `Socket probe call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  on('session.end', async ($, e, next) => {
    if (socketPath) {
      try {
        await $.http.fetch('http://localhost/shutdown', {
          method: 'POST',
          socketPath,
        });
      } catch {
        // Child process may already have shut down or crashed
      }
    }
    return next(e);
  });
};
