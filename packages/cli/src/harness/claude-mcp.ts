// Claude Code plugin MCP server (claude:architecture/claude-integration, decision D11 option E).
// A JSON-RPC 2.0 subset over newline-delimited stdio: initialize, ping, tools/list, tools/call.
// Each workflow tool forwards one protocol-1 request to the persistent runner (core/workflow-runner.ts),
// so the writer lease lives in this process for the whole session. One bind per session: the mod sends a
// nonce it generated; every other call must repeat it. A second bind is refused.
// Replies stay under MAX_RESULT_BYTES, the host's MCP result limit. A prepared request is kept here, keyed by
// requestId, and the mod reads it in bounded `detail` pages. `validate` takes the requestId and uses the kept request.
import type { RunnerResponse } from '../core/workflow-runner.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MIN_NONCE_LENGTH = 16;
/** Largest MCP tool result the server delivers (the host's limit, 16 KB). A larger reply is not delivered. */
export const MAX_RESULT_BYTES = 16 * 1024;
/** Characters of the serialized prepared request per `detail` page. JSON escapes one character in at most 6 bytes, so a page stays under the bound. */
export const DETAIL_CHUNK_CHARS = 2048;

/** The part of the runner this server uses; tests pass a fake. */
export interface RunnerPort { handleLine(line: string): Promise<RunnerResponse | null> }

type Forward = 'inspect' | 'prepare' | 'executeTest' | 'validate' | 'record' | 'capture' | 'cancel';
interface ToolSpec { name: string; description: string; forward?: Forward; release?: boolean; bind?: boolean; detail?: boolean }

/** One MCP tool per runner operation. `close` releases requests; the runner's own `close` is never exposed. */
export const TOOLS: readonly ToolSpec[] = [
  { name: 'bind', description: 'Bind this session once with a nonce the mod generated. Required before any other tool; a second bind is refused.', bind: true },
  { name: 'inspect', description: 'Inspect a prepared or recorded workflow request.', forward: 'inspect' },
  { name: 'prepare', description: 'Prepare a workflow request and take the writer lease for it. The reply is compact; read the request with detail.', forward: 'prepare' },
  { name: 'detail', description: 'Read one bounded page of a prepared request by requestId and offset.', detail: true },
  { name: 'executeTest', description: 'Run the test requirements of a prepared request.', forward: 'executeTest' },
  { name: 'validate', description: 'Validate the WorkflowResult for an open prepared request (requestId) against the request the server holds.', forward: 'validate' },
  { name: 'record', description: 'Record a validated WorkflowResult.', forward: 'record' },
  { name: 'capture', description: 'Capture a proposed contribution.', forward: 'capture' },
  { name: 'cancel', description: 'Cancel a request and release its lease when the workers are proven stopped.', forward: 'cancel' },
  { name: 'close', description: 'Release the lease of one open request (requestId). Without requestId, closes every open request of this session.', forward: 'cancel', release: true },
];

const NONCE = 'nonce';
type Json = Record<string, unknown>;
/** The runner's Result as the server reads it. */
interface Outcome { ok: boolean; value?: unknown; error?: { code?: string; message?: string }; notices?: unknown[] }
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (value: unknown, isError: boolean) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError });
const byteLength = (s: string) => new TextEncoder().encode(s).length;

export interface McpServerOptions { name?: string; version?: string }

export function createClaudeMcpServer(runner: RunnerPort, options: McpServerOptions = {}) {
  let bound: string | null = null;
  let counter = 0;
  /** Prepared requests this session holds open: the full request (server side only) and its serialized form for detail pages. */
  const open = new Map<string, { request: Json; json: string }>();

  async function forwardOne(method: Forward, params: Json): Promise<Outcome | undefined> {
    const id = `mcp-${++counter}`;
    const response = await runner.handleLine(JSON.stringify({ id, method, params }));
    return response ? response.result as Outcome : undefined;
  }

  /**
   * Cancels one request. It leaves the open set before the cancel, so overlapping closes (requests run concurrently)
   * never cancel it twice; it returns to the set if the runner neither released it nor reported it already stopped.
   */
  async function release(requestId: string): Promise<{ released: boolean; outcome: Outcome | undefined }> {
    const held = open.get(requestId);
    open.delete(requestId);
    const outcome = await forwardOne('cancel', { requestId });
    const released = outcome?.ok === true || outcome?.error?.code === 'STALE_STATE';
    if (!released && held !== undefined) open.set(requestId, held);
    return { released, outcome };
  }

  /** Cancels every open request of this session. Each request is released or reported; none is dropped silently. */
  async function closeAll(): Promise<unknown> {
    const closed: string[] = [];
    const failed: { requestId: string; code: string; message: string }[] = [];
    for (const requestId of [...open.keys()]) {
      if (!open.has(requestId)) continue; // closed by an overlapping close
      const { released, outcome } = await release(requestId);
      if (released) closed.push(requestId);
      else failed.push({ requestId, code: outcome?.error?.code ?? 'NO_RESPONSE', message: outcome?.error?.message ?? 'Empty runner response.' });
    }
    const payload = { protocol: 1, ok: failed.length === 0, value: { closed, failed }, notices: [] };
    return text(payload, failed.length > 0);
  }

  /** Cancels a prepared request whose reply cannot be delivered, so its lease is not held by a request nobody can close. */
  async function undeliverable(requestId: string): Promise<unknown> {
    await release(requestId);
    return text(`The reply for prepared request ${requestId} exceeds ${MAX_RESULT_BYTES} bytes and was not delivered; the request was cancelled and its lease released.`, true);
  }

  function detailPage(args: Json): unknown {
    const requestId = args.requestId;
    const held = typeof requestId === 'string' ? open.get(requestId) : undefined;
    if (!held) return text(`Request ${String(requestId)} is not open.`, true);
    const offset = args.offset ?? 0;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > held.json.length) return text('detail offset must be an integer from 0 to the size of the request.', true);
    const chunk = held.json.slice(offset, offset + DETAIL_CHUNK_CHARS);
    const next = offset + chunk.length;
    const done = next >= held.json.length;
    return text({ protocol: 1, ok: true, value: { requestId, offset, total: held.json.length, chunk, next: done ? null : next, done }, notices: [] }, false);
  }

  async function prepared(outcome: Outcome): Promise<unknown> {
    const request = outcome.value as Json;
    const requestId = request.requestId;
    if (typeof requestId !== 'string') return text('Prepared request has no requestId; nothing can be closed by id.', true);
    const json = JSON.stringify(request);
    open.set(requestId, { request, json });
    const compact = { protocol: 1, ok: true, value: { requestId, workflow: request.workflow, status: 'prepared', detailChars: json.length }, notices: outcome.notices ?? [] };
    const reply = text(compact, false);
    return byteLength(reply.content[0].text) > MAX_RESULT_BYTES ? undeliverable(requestId) : reply;
  }

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
    if (spec.detail) return detailPage(args);
    if (spec.release && args.requestId === undefined) return closeAll();
    const params: Json = { ...args };
    delete params[NONCE];
    const method = spec.forward!;
    let forwarded: Json = spec.release ? { requestId: params.requestId } : params;
    if (method === 'validate') {
      const held = typeof params.requestId === 'string' ? open.get(params.requestId) : undefined;
      if (!held) return text(`Request ${String(params.requestId)} is not open; nothing was validated.`, true);
      forwarded = { prepared: held.request, result: params.result };
    }
    const outcome = method === 'cancel' ? (await release(String(forwarded.requestId))).outcome : await forwardOne(method, forwarded);
    if (!outcome) return text('Empty runner response.', true);
    if (method === 'prepare' && outcome.ok) return prepared(outcome);
    const reply = text(outcome, !outcome.ok);
    return byteLength(reply.content[0].text) > MAX_RESULT_BYTES ? text(`The ${name} result exceeds ${MAX_RESULT_BYTES} bytes and was not delivered.`, true) : reply;
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
