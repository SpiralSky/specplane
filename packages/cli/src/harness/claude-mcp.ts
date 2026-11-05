// Claude Code plugin MCP server (claude:architecture/claude-integration, decision D11 option E).
// A JSON-RPC 2.0 subset over newline-delimited stdio: initialize, ping, tools/list, tools/call.
// Each workflow tool forwards one protocol-1 request to the persistent runner (core/workflow-runner.ts),
// so the writer lease lives in this process for the whole session. One bind per session: the mod sends a
// nonce it generated; every other call must repeat it. A second bind is refused.
// Replies stay under MAX_RESULT_BYTES, the host's MCP result limit. A prepared request is kept here, keyed by
// requestId, and the mod reads it in bounded `detail` pages. `validate` takes the requestId and uses the kept request.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunnerResponse } from '../core/workflow-runner.js';
import { resolveSuite, type SuiteTable } from './claude-suites.js';
import type { ConfirmationChallenge, ConfirmationResponse, InteractionPort } from '../core/contracts.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MIN_NONCE_LENGTH = 16;
/** Largest MCP tool result the server delivers (the host's limit, 16 KB). A larger reply is not delivered. */
export const MAX_RESULT_BYTES = 16 * 1024;
/** Characters of the serialized prepared request per `detail` page. JSON escapes one character in at most 6 bytes, so a page stays under the bound. */
export const DETAIL_CHUNK_CHARS = 2048;

/**
 * D17 option A (spec: `### Confirming finalised content`; live check pending): the server-side interaction port. The core confirms
 * finalized content inside this process, which has no screen. The port parks the core's challenge under the `record` call
 * that raised it (found through async context, so concurrent records cannot mix) until the mod answers through a second
 * `record` call carrying `confirmation`. Give the runner `interaction: bridge.port` and pass the same bridge to
 * createClaudeMcpServer.
 */
export interface ConfirmationBridge {
  port: InteractionPort;
  /** Runs fn (a record call); resolves when it finishes or when the core parks a challenge, whichever is first. */
  run<T>(requestId: string, fn: () => Promise<T>): Promise<{ kind: 'done'; value: T | undefined } | { kind: 'parked'; challenge: ConfirmationChallenge }>;
  parked(requestId: string): ConfirmationChallenge | undefined;
  /** Ends the parked call with a response, or with null (no response); resolves with the parked call's outcome. */
  answer(requestId: string, response: ConfirmationResponse | null): Promise<unknown>;
}

export function createConfirmationBridge(): ConfirmationBridge {
  const context = new AsyncLocalStorage<{ requestId: string; onParked(challenge: ConfirmationChallenge): void }>();
  const held = new Map<string, { challenge: ConfirmationChallenge; resolve(r: ConfirmationResponse | null): void; pending: Promise<unknown> }>();
  const pendings = new Map<string, Promise<unknown>>();
  return {
    port: {
      confirm: challenge => new Promise<ConfirmationResponse | null>(resolve => {
        const store = context.getStore();
        if (!store || held.has(store.requestId)) return resolve(null); // no calling record to answer through: unavailable
        held.set(store.requestId, { challenge, resolve, pending: pendings.get(store.requestId) ?? Promise.resolve() });
        store.onParked(challenge);
      }),
    },
    run(requestId, fn) {
      return new Promise(resolve => {
        const pending = context.run({ requestId, onParked: challenge => resolve({ kind: 'parked', challenge }) }, fn);
        pendings.set(requestId, pending);
        const clear = () => { held.delete(requestId); pendings.delete(requestId); };
        pending.then(value => { clear(); resolve({ kind: 'done', value }); }, () => { clear(); resolve({ kind: 'done', value: undefined }); });
      });
    },
    parked: requestId => held.get(requestId)?.challenge,
    async answer(requestId, response) {
      const entry = held.get(requestId);
      if (!entry) return undefined;
      held.delete(requestId);
      entry.resolve(response);
      return entry.pending;
    },
  };
}

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
  { name: 'executeTest', description: 'Run the configured suites a prepared request requires. Takes requestId and optionally criterionIds (a subset of the criteria of the request); the server resolves every command from the verification suites bound to the request.', forward: 'executeTest' },
  { name: 'validate', description: 'Validate the WorkflowResult for an open prepared request (requestId) against the request the server holds.', forward: 'validate' },
  { name: 'record', description: 'Record a validated WorkflowResult. Finalized content first returns a CONFIRMATION_REQUIRED challenge; repeat the call with the same proposal and the mod\'s `confirmation` response.', forward: 'record' },
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

export interface McpServerOptions {
  name?: string; version?: string; confirmations?: ConfirmationBridge; now?: () => number;
  /** The configured suites (`verification.suites`) and mode the core bound to a prepared request; absent or undefined, `executeTest` is unavailable. */
  verificationFor?: (requestId: string) => { mode: 'auto' | 'manual'; suites: SuiteTable } | undefined;
}

/** The only keys `executeTest` accepts from the caller (`architecture/claude-integration` § Reviewed test suites: `requestId` and `criterionIds`); a command, arguments, cwd or environment are never among them. */
const EXECUTE_TEST_KEYS = new Set(['requestId', 'criterionIds', NONCE]);

export function createClaudeMcpServer(runner: RunnerPort, options: McpServerOptions = {}) {
  let bound: string | null = null;
  let counter = 0;
  const bridge = options.confirmations;
  const now = options.now ?? Date.now;
  /** The proposal (canonical JSON) each parked challenge belongs to; the second record call must repeat it. */
  const proposals = new Map<string, string>();
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
    await bridge?.answer(requestId, null); // a parked confirmation ends as a refusal before the request is cancelled
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
    // Spec § Reviewed test suites: every suite a criterion requires must be configured, or the request is cancelled and its lease released.
    const criteria = Array.isArray(request.criteria) ? (request.criteria as Array<{ testRequirements?: unknown[] }>) : [];
    const required = criteria.flatMap(c => (Array.isArray(c.testRequirements) ? c.testRequirements : []) as Array<{ suiteId?: unknown }>);
    if (request.workflow === 'plan-step' && required.length > 0) {
      const configured = options.verificationFor?.(requestId)?.suites;
      const unknown = required.map(r => r.suiteId).filter(id => !configured || typeof id !== 'string' || !resolveSuite(configured, id));
      if (unknown.length > 0) {
        await release(requestId);
        return text(`Request ${requestId} requires suites that are not in verification.suites (${[...new Set(unknown.map(String))].join(', ')}). The request was cancelled and its lease released.`, true);
      }
    }
    const json = JSON.stringify(request);
    open.set(requestId, { request, json });
    const compact = { protocol: 1, ok: true, value: { requestId, workflow: request.workflow, status: 'prepared', detailChars: json.length }, notices: outcome.notices ?? [] };
    const reply = text(compact, false);
    return byteLength(reply.content[0].text) > MAX_RESULT_BYTES ? undeliverable(requestId) : reply;
  }

  const refusal = (code: string, message: string, details: unknown = null): Outcome =>
    ({ ok: false, error: { code, message, retryable: false, details } as Outcome['error'] });
  const protocol = (o: Outcome | Record<string, unknown>) => ({ protocol: 1, notices: [], ...o });
  const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  function sortKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
    return v;
  }

  /** Ends a parked confirmation as a refusal, closes the request, and replies with the refusal. Nothing is written. */
  async function endParked(requestId: string, why: string): Promise<unknown> {
    proposals.delete(requestId);
    await release(requestId);
    return text(protocol(refusal('CONFIRMATION_REQUIRED', `${why} Nothing was recorded and the request was closed.`)), true);
  }

  /** D17 A: record with the parked-challenge flow (see ConfirmationBridge). */
  async function recordWithConfirmation(params: Json): Promise<unknown> {
    const requestId = typeof params.requestId === 'string' ? params.requestId : '';
    const { confirmation, ...proposal } = params;
    const reply = (outcome: Outcome | undefined) => {
      if (!outcome) return text('Empty runner response.', true);
      const r = text(outcome, !outcome.ok);
      return byteLength(r.content[0].text) > MAX_RESULT_BYTES ? text(`The record result exceeds ${MAX_RESULT_BYTES} bytes and was not delivered.`, true) : r;
    };
    const pendingChallenge = bridge!.parked(requestId);
    if (confirmation !== undefined) {
      if (!pendingChallenge) return text(protocol(refusal('CONFIRMATION_REQUIRED', 'No confirmation is pending for this request (it was answered, expired or ended); nothing was recorded.')), true);
      const c = confirmation;
      const valid = isObject(c) && typeof c.challengeId === 'string' && (c.decision === 'confirm' || c.decision === 'decline') && typeof c.interactionId === 'string' && c.interactionId.length > 0;
      if (!valid) return endParked(requestId, 'The confirmation response is malformed.');
      const response = c as unknown as ConfirmationResponse;
      if (response.challengeId !== pendingChallenge.challengeId) return endParked(requestId, 'The confirmation answers a different challenge.');
      if (!same(proposal, JSON.parse(proposals.get(requestId) ?? 'null'))) return endParked(requestId, 'The proposal differs from the one the challenge was raised for.');
      if (now() >= Date.parse(pendingChallenge.expiresAt)) return endParked(requestId, 'The confirmation challenge expired.');
      proposals.delete(requestId);
      const outcome = await bridge!.answer(requestId, response) as Outcome | undefined;
      if (outcome?.ok !== true) await release(requestId); // a declined or refused confirmation closes the request
      return reply(outcome);
    }
    if (pendingChallenge) return endParked(requestId, 'A confirmation is already pending for this request; it was ended.');
    proposals.set(requestId, JSON.stringify(proposal));
    const first = await bridge!.run(requestId, () => forwardOne('record', proposal));
    if (first.kind === 'done') { proposals.delete(requestId); return reply(first.value); }
    const challengeReply = text(protocol(refusal('CONFIRMATION_REQUIRED', 'Finalized content needs the user\'s confirmation: show challenge.summary unmodified and repeat this call with the same proposal and a confirmation.', { challenge: first.challenge })), true);
    if (byteLength(challengeReply.content[0].text) > MAX_RESULT_BYTES) return endParked(requestId, `The confirmation summary exceeds ${MAX_RESULT_BYTES} bytes and cannot be shown natively; use the manual command.`);
    return challengeReply;
  }

  /**
   * Runs the suites a held request needs, with commands from `verification.suites` only (spec: Reviewed test suites). The caller
   * may send requestId, criterionIds and the nonce; any other key (executable, args, cwd, env, a command in any form) is refused
   * before anything runs. A mapped criterion's `suiteId` runs for that criterion; for a plan-step in `auto` mode, with no
   * criterionIds given, every configured suite also runs step-level. An unknown suiteId is refused and cancels the request.
   */
  async function runReviewedSuites(args: Json): Promise<unknown> {
    const extra = Object.keys(args).filter(k => !EXECUTE_TEST_KEYS.has(k));
    if (extra.length > 0) return text(`executeTest takes requestId and criterionIds only; the server fixes the command. Refused keys: ${extra.join(', ')}.`, true);
    const requestId = args.requestId;
    const held = typeof requestId === 'string' ? open.get(requestId) : undefined;
    if (typeof requestId !== 'string' || !held) return text(`Request ${String(requestId)} is not open.`, true);
    const verification = options.verificationFor?.(requestId);
    if (!verification) return text('Test suites are not available for this request: no verification configuration is bound to it.', true);
    const suites = verification.suites;
    const allCriteria = (Array.isArray(held.request.criteria) ? held.request.criteria : []) as Array<{ id: string; testRequirements?: Array<{ suiteId: string; format: string }> }>;
    let criteria = allCriteria;
    if (args.criterionIds !== undefined) {
      const ids = args.criterionIds;
      const known = new Set(allCriteria.filter(c => (c.testRequirements ?? []).length > 0).map(c => c.id));
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every(i => typeof i === 'string' && known.has(i)) || new Set(ids).size !== ids.length) {
        return text('criterionIds must be a nonempty list of distinct ids of this request\'s criteria that carry test requirements; nothing ran.', true);
      }
      criteria = allCriteria.filter(c => (ids as string[]).includes(c.id));
    }
    type Command = NonNullable<ReturnType<typeof resolveSuite>>;
    const runs: Array<{ suiteId: string; command: Command; criterionIds: string[]; stepLevel: boolean }> = [];
    const mapped = new Map<string, { command: Command; criterionIds: string[] }>();
    for (const c of criteria) for (const r of c.testRequirements ?? []) {
      const command = resolveSuite(suites, r.suiteId);
      if (!command) { await release(requestId); return text(`Unknown suiteId ${JSON.stringify(r.suiteId)}. The request was cancelled and its lease released.`, true); }
      if (command.format !== r.format) { await release(requestId); return text(`Suite ${JSON.stringify(r.suiteId)} reports ${command.format}, but the request requires ${r.format}. The request was cancelled and its lease released.`, true); }
      const entry = mapped.get(r.suiteId) ?? { command, criterionIds: [] };
      entry.criterionIds.push(c.id);
      mapped.set(r.suiteId, entry);
    }
    for (const [suiteId, { command, criterionIds }] of mapped) runs.push({ suiteId, command, criterionIds, stepLevel: false });
    if (held.request.workflow === 'plan-step' && verification.mode === 'auto' && args.criterionIds === undefined) {
      for (const suiteId of Object.keys(suites).sort()) {
        const command = resolveSuite(suites, suiteId);
        if (command) runs.push({ suiteId, command, criterionIds: [], stepLevel: true });
      }
    }
    if (runs.length === 0) return text(`Request ${requestId} has no test requirements to run.`, true);
    const receipts: unknown[] = [];
    for (const { suiteId, command, criterionIds, stepLevel } of runs) {
      const params: Json = { requestId, criterionIds, executable: command.executable, args: command.args, reportFormat: command.format };
      if (stepLevel) params.suiteId = suiteId;
      const outcome = await forwardOne('executeTest', params);
      if (!outcome?.ok) return text(outcome ?? 'Empty runner response.', true);
      const v = outcome.value as { artifact: unknown; executionId: unknown; exitCode: unknown; signal: unknown; assertions?: Array<{ suiteId: string; executed: number; failed: number; skipped: number }> };
      receipts.push({ suiteId, stepLevel, criterionIds, artifact: v.artifact, executionId: v.executionId, exitCode: v.exitCode, signal: v.signal, suites: (v.assertions ?? []).map(a => ({ suiteId: a.suiteId, executed: a.executed, failed: a.failed, skipped: a.skipped })), notices: outcome.notices ?? [] });
    }
    const reply = text({ protocol: 1, ok: true, value: { requestId, receipts }, notices: [] }, false);
    return byteLength(reply.content[0].text) > MAX_RESULT_BYTES ? text(`The executeTest result exceeds ${MAX_RESULT_BYTES} bytes and was not delivered.`, true) : reply;
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
    if (method === 'record' && bridge) return recordWithConfirmation(params);
    if (method === 'executeTest') return runReviewedSuites(args);
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
