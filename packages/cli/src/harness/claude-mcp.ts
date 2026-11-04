// Claude Code plugin MCP server (claude:architecture/claude-integration, decision D11 option E).
// A JSON-RPC 2.0 subset over newline-delimited stdio: initialize, ping, tools/list, tools/call.
// Each workflow tool forwards one protocol-1 request to the persistent runner (core/workflow-runner.ts),
// so the writer lease lives in this process for the whole session. One bind per session: the mod sends a
// nonce it generated; every other call must repeat it. A second bind is refused.
import type { RunnerResponse } from '../core/workflow-runner.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MIN_NONCE_LENGTH = 16;

/** The part of the runner this server uses; tests pass a fake. */
export interface RunnerPort { handleLine(line: string): Promise<RunnerResponse | null> }

type Forward = 'inspect' | 'prepare' | 'executeTest' | 'validate' | 'record' | 'capture' | 'cancel';
interface ToolSpec { name: string; description: string; forward?: Forward; release?: boolean; bind?: boolean }

/** One MCP tool per runner operation. `close` releases one request's lease; the runner's own `close` is never exposed. */
export const TOOLS: readonly ToolSpec[] = [
  { name: 'bind', description: 'Bind this session once with a nonce the mod generated. Required before any other tool; a second bind is refused.', bind: true },
  { name: 'inspect', description: 'Inspect a prepared or recorded workflow request.', forward: 'inspect' },
  { name: 'prepare', description: 'Prepare a workflow request and take the writer lease for it.', forward: 'prepare' },
  { name: 'executeTest', description: 'Run the test requirements of a prepared request.', forward: 'executeTest' },
  { name: 'validate', description: 'Validate a WorkflowResult against a prepared request.', forward: 'validate' },
  { name: 'record', description: 'Record a validated WorkflowResult.', forward: 'record' },
  { name: 'capture', description: 'Capture a proposed contribution.', forward: 'capture' },
  { name: 'cancel', description: 'Cancel a request and release its lease when the workers are proven stopped.', forward: 'cancel' },
  { name: 'close', description: 'Close one workflow request so its lease is released at workflow end (cancels that request only).', forward: 'cancel', release: true },
];

const NONCE = 'nonce';
type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (value: unknown, isError: boolean) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError });

export interface McpServerOptions { name?: string; version?: string }

export function createClaudeMcpServer(runner: RunnerPort, options: McpServerOptions = {}) {
  let bound: string | null = null;
  let counter = 0;

  async function callTool(name: string, args: Json): Promise<unknown> {
    const spec = TOOLS.find(t => t.name === name);
    if (!spec) return text(`Unknown tool: ${name}.`, true);
    if (spec.bind) {
      if (bound !== null) return text('This session is already bound; a second bind is refused.', true);
      const nonce = args[NONCE];
      if (typeof nonce !== 'string' || nonce.length < MIN_NONCE_LENGTH) return text(`bind needs a nonce of at least ${MIN_NONCE_LENGTH} characters.`, true);
      bound = nonce;
      return text({ bound: true }, false);
    }
    if (bound === null) return text('Session is not bound; call bind first.', true);
    if (args[NONCE] !== bound) return text('Nonce does not match the bound session.', true);
    const params: Json = { ...args };
    delete params[NONCE];
    const method = spec.forward!;
    const id = `mcp-${++counter}`;
    const response = await runner.handleLine(JSON.stringify({ id, method, params: spec.release ? { requestId: params.requestId } : params }));
    if (!response) return text('Empty runner response.', true);
    return text(response.result, !response.result.ok);
  }

  /** Handles one JSON-RPC message; resolves with the reply, or null for notifications. */
  async function handle(message: unknown): Promise<Json | null> {
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: isObject(message) && 'id' in message ? message.id as never : null, error: { code: -32600, message: 'Invalid request.' } };
    }
    const hasId = 'id' in message;
    const id = message.id as string | number | null;
    if (!hasId) return null; // notifications/initialized and other notifications need no reply
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, msg: string) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });
    switch (message.method) {
      case 'initialize':
        return reply({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: options.name ?? 'specplane', version: options.version ?? '0.1.0' } });
      case 'ping': return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: { nonce: { type: 'string' } }, required: [NONCE], additionalProperties: true } })) });
      case 'tools/call': {
        const params = isObject(message.params) ? message.params : {};
        if (typeof params.name !== 'string') return fail(-32602, 'tools/call needs a tool name.');
        const args = isObject(params.arguments) ? params.arguments : {};
        return reply(await callTool(params.name, args));
      }
      default: return fail(-32601, `Method not found: ${message.method}.`);
    }
  }

  /** Serves newline-delimited JSON-RPC until the input ends. Requests run concurrently, as the runner allows. */
  async function serve(io: { input: AsyncIterable<string | Uint8Array>; write(line: string): void }): Promise<void> {
    const pending = new Set<Promise<void>>();
    const emit = (reply: Json | null) => { if (reply) io.write(JSON.stringify(reply) + '\n'); };
    const submit = (line: string) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { emit({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); return; }
      const p = handle(parsed).then(emit, () => undefined).finally(() => pending.delete(p));
      pending.add(p);
    };
    let buffer = '';
    for await (const chunk of io.input) {
      buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) { submit(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    submit(buffer);
    await Promise.all([...pending]);
  }

  return { handle, serve, isBound: () => bound !== null };
}
