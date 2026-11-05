/** Persistent protocol-1 NDJSON runner. One process owns the writer lease across prepare, execute, validate and record. */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CoreContext, ExecutionPort, LifecyclePort, Result, WorkflowInitiation } from './contracts.js';
import type { HostSelection } from './compatibility.js';
import { prepareWorkflow } from './workflow-preparation.js';
import { executeWorkflowTest } from './workflow-execution.js';
import { validateWorkflowResult, recordWorkflow } from './workflow-recording.js';
import { cancelWorkflow, inspectWorkflow } from './workflow-lifecycle.js';
import { captureContribution } from './contribution-capture.js';
import { prepareVerifyReview, recordVerifyReview } from './verify-review.js';

export const RUNNER_METHODS = ['inspect', 'prepare', 'executeTest', 'validate', 'record', 'capture', 'cancel', 'close', 'prepareReview', 'recordReview'] as const;
export type RunnerMethod = typeof RUNNER_METHODS[number];
export type RunnerResponse = { id: string | number | null; result: Result<unknown> };
export interface RunnerOptions {
  checkout: string;
  extensionId: string;
  /** Private package inputs per workflow; absent means preparation is refused as incompatible (manual CLI instead). */
  compatibilityFor?: (workflow: string) => { manifest: unknown; host: HostSelection } | undefined;
  /** Host-authorized execution port. Defaults to a direct spawn that inherits this process's sandbox. */
  execution?: ExecutionPort;
  /** Trusted stop proof. Defaults to waiting for this runner's own pending execution to settle. */
  lifecycle?: LifecyclePort;
  context?: Partial<CoreContext>;
  maxLineBytes?: number;
  stopTimeoutMs?: number;
}
export interface RunnerIo { input: AsyncIterable<string | Uint8Array>; write(line: string): void; diagnostic?(text: string): void }

const fail = (code: string, message: string, retryable = false, details: unknown = null): Result<never> =>
  ({ protocol: 1, ok: false, error: { code, message, retryable, details }, notices: [] });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validId = (v: unknown): v is string | number => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isSafeInteger(v));
function closed(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(value, k)); }

/** Default execution port: direct spawn without a shell; abort kills the child and reports CANCELLED. */
export const spawnExecutionPort: ExecutionPort = {
  execute: request => new Promise((resolve, reject) => {
    let executable = request.executable;
    if (!path.isAbsolute(executable)) {
      const found = (request.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(d => path.join(d, executable)).find(f => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } });
      if (!found) return reject(Object.assign(new Error(`Executable not found: ${executable}`), { code: 'OPERATION_FAILED' }));
      executable = found;
    }
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const child = spawn(executable, request.args, { cwd: request.checkout, env: request.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const abort = () => { child.kill('SIGKILL'); };
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    child.stdout.on('data', b => stdout.push(b)); child.stderr.on('data', b => stderr.push(b));
    child.on('error', error => { if (!child.pid) { request.signal?.removeEventListener('abort', abort); const code = (error as NodeJS.ErrnoException).code; reject(Object.assign(error, { code: code === 'EACCES' || code === 'EPERM' ? 'PERMISSION_DENIED' : 'OPERATION_FAILED' })); } });
    child.on('close', (exitCode, signal) => {
      request.signal?.removeEventListener('abort', abort);
      if (request.signal?.aborted) return reject(Object.assign(new Error('Execution cancelled.'), { code: 'CANCELLED' }));
      resolve({ executable, exitCode, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  }),
};

export function createWorkflowRunner(options: RunnerOptions) {
  const controller = new AbortController();
  const tracked = new Set<string>();
  const inflightIds = new Set<string | number>();
  let chain: Promise<unknown> = Promise.resolve();
  let executions = 0; let settled: Promise<void> = Promise.resolve();
  let closing = false; let signalClosed!: () => void; const closedP = new Promise<void>(r => signalClosed = r);
  const base = (): CoreContext => ({ ...options.context, checkout: options.checkout, extensionId: options.extensionId, signal: controller.signal, execution: port, lifecycle });
  const execution = options.execution ?? spawnExecutionPort;
  const port: ExecutionPort = { execute: request => {
    executions++;
    const run = execution.execute(request);
    const done = run.then(() => undefined, () => undefined).finally(() => { executions--; });
    settled = Promise.all([settled, done]).then(() => undefined);
    return run;
  } };
  const lifecycle: LifecyclePort = options.lifecycle ?? { stopWorkflow: async () => {
    // A referenced timer: the stop deadline must keep the process alive until it decides, even when a
    // hung worker holds no handle of its own (Node would otherwise exit before reporting recovery).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(r => { timer = setTimeout(() => r('timeout'), options.stopTimeoutMs ?? 5000); });
    const outcome = await Promise.race([settled.then(() => 'settled' as const), timeout]).finally(() => clearTimeout(timer));
    return outcome === 'settled' && executions === 0 ? { stopped: true, recoveryRequired: false } : { stopped: false, recoveryRequired: true };
  } };
  const cleanContext = (): CoreContext => { const c = base(); delete c.signal; return c; };

  async function cancelAll(): Promise<{ cancelled: string[]; unrecovered: { requestId: string; code: string; message: string }[] }> {
    const cancelled: string[] = []; const unrecovered: { requestId: string; code: string; message: string }[] = [];
    for (const requestId of [...tracked]) {
      const r = await cancelWorkflow(requestId, cleanContext());
      if (r.ok) { tracked.delete(requestId); cancelled.push(requestId); }
      else if (r.error.code === 'STALE_STATE') tracked.delete(requestId); // already finished or unknown: no lease owned here
      else unrecovered.push({ requestId, code: r.error.code, message: r.error.message });
    }
    return { cancelled, unrecovered };
  }

  async function dispatch(method: RunnerMethod, params: Record<string, unknown>): Promise<Result<unknown>> {
    const context = base();
    switch (method) {
      case 'inspect': case 'cancel': {
        if (!closed(params, ['requestId']) || typeof params.requestId !== 'string') return fail('INVALID_REQUEST', `${method} params must be exactly {requestId}.`);
        if (method === 'inspect') return inspectWorkflow(params.requestId, cleanContext());
        const r = await cancelWorkflow(params.requestId, cleanContext());
        if (r.ok) tracked.delete(params.requestId);
        return r;
      }
      case 'prepare': {
        const workflow = typeof params.workflow === 'string' ? params.workflow : '';
        const compat = options.compatibilityFor?.(workflow);
        const r = await prepareWorkflow(params as unknown as WorkflowInitiation, { ...context, compatibility: compat });
        if (r.ok) tracked.add(r.value.requestId);
        return r;
      }
      case 'executeTest': return executeWorkflowTest(params as never, context);
      case 'validate': {
        if (!closed(params, ['prepared', 'result'])) return fail('INVALID_REQUEST', 'validate params must be exactly {prepared, result}.');
        return validateWorkflowResult(params.prepared as never, params.result as never, context);
      }
      case 'record': {
        const r = await recordWorkflow(params as never, context);
        return r;
      }
      case 'capture': return captureContribution(params as never, context);
      case 'prepareReview': {
        if (!closed(params, ['requestId', 'workerSession']) || typeof params.requestId !== 'string' || typeof params.workerSession !== 'string') return fail('INVALID_REQUEST', 'prepareReview params must be exactly {requestId, workerSession}.');
        return prepareVerifyReview({ requestId: params.requestId, workerSession: params.workerSession }, context);
      }
      case 'recordReview': {
        if (!closed(params, ['reviewId', 'reviewerSession', 'result']) || typeof params.reviewId !== 'string' || typeof params.reviewerSession !== 'string') return fail('INVALID_REQUEST', 'recordReview params must be exactly {reviewId, reviewerSession, result}.');
        return recordVerifyReview({ reviewId: params.reviewId, reviewerSession: params.reviewerSession, result: params.result }, context);
      }
      case 'close': return fail('INVALID_REQUEST', 'close is handled by the transport.');
    }
  }

  /** Handle one input line; resolves with the response to write, or null for a blank line. */
  async function handleLine(line: string): Promise<RunnerResponse | null> {
    if (!line.trim()) return null;
    let message: unknown;
    try { message = JSON.parse(line); } catch { return { id: null, result: fail('INVALID_REQUEST', 'Input line is not valid JSON.') }; }
    if (!isObject(message)) return { id: null, result: fail('INVALID_REQUEST', 'Request must be a JSON object.') };
    const id = validId(message.id) ? message.id : null;
    if (id === null) return { id, result: fail('INVALID_REQUEST', 'Request id must be a nonempty string or safe integer.') };
    const extra = Object.keys(message).filter(k => !['id', 'method', 'params'].includes(k));
    if (extra.length) return { id, result: fail('INVALID_REQUEST', `Unknown request fields: ${extra.join(', ')}.`) };
    if (typeof message.method !== 'string' || !(RUNNER_METHODS as readonly string[]).includes(message.method)) return { id, result: fail('INVALID_REQUEST', `Unknown method: ${String(message.method)}.`) };
    const method = message.method as RunnerMethod;
    if (!isObject(message.params ?? {})) return { id, result: fail('INVALID_REQUEST', 'params must be an object.') };
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (inflightIds.has(id)) return { id, result: fail('INVALID_REQUEST', 'A request with this id is already pending.') };
    if (closing) return { id, result: fail('CANCELLED', 'Runner is closing.') };
    inflightIds.add(id);
    try {
      if (method === 'close') {
        closing = true; controller.abort();
        const outcome = await cancelAll().finally(signalClosed);
        return { id, result: outcome.unrecovered.length ? fail('RECOVERY_REQUIRED', 'A workflow worker was not proven stopped; lease retained.', false, outcome) : { protocol: 1, ok: true, value: { closed: true, cancelled: outcome.cancelled }, notices: [] } };
      }
      if (method === 'inspect' || method === 'cancel') return { id, result: await dispatch(method, params) };
      if (method === 'executeTest' && executionQueued) return { id, result: fail('LOCKED', 'Another execution is pending; overlapping executions are refused.', true) };
      const isExecution = method === 'executeTest';
      if (isExecution) executionQueued = true;
      const run = chain.then(() => dispatch(method, params));
      chain = run.catch(() => undefined);
      try { return { id, result: await run }; } finally { if (isExecution) executionQueued = false; }
    } catch (error) {
      return { id, result: fail('OPERATION_FAILED', error instanceof Error ? error.message : String(error)) };
    } finally { inflightIds.delete(id); }
  }
  let executionQueued = false;

  /** Serve until `close`, EOF or input failure. Returns the process exit code (0 clean, 1 recovery required). */
  async function serve(io: RunnerIo): Promise<number> {
    const max = options.maxLineBytes ?? 8 * 1024 * 1024;
    const pending = new Set<Promise<void>>();
    const emit = (r: RunnerResponse | null) => { if (r) io.write(JSON.stringify(r) + '\n'); };
    const submit = (line: string) => { const p = handleLine(line).then(emit).catch(() => undefined).finally(() => pending.delete(p)); pending.add(p); };
    const decoder = new StringDecoder('utf8'); let buffer = ''; let oversize = false;
    try {
      const iterator = io.input[Symbol.asyncIterator]();
      for (;;) {
        const step = await Promise.race([iterator.next(), closedP.then(() => null)]);
        if (step === null || step.done || closing) break;
        const chunk = step.value;
        buffer += typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk));
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (oversize) { oversize = false; continue; }
          submit(line);
        }
        if (Buffer.byteLength(buffer) > max) { buffer = ''; oversize = true; emit({ id: null, result: fail('INVALID_REQUEST', 'Input line exceeds the maximum size.') }); }
      }
      if (buffer.trim() && !oversize && !closing) submit(buffer);
    } catch (error) { io.diagnostic?.(`input failed: ${error instanceof Error ? error.message : String(error)}\n`); }
    // Disconnect (EOF/error/close) cancels pending work; unacknowledged workers need recovery.
    closing = true; controller.abort();
    const outcome = await cancelAll();
    // A worker that was not proven stopped may never settle; do not wait on it.
    if (outcome.unrecovered.length) { io.diagnostic?.(`recovery required: ${JSON.stringify(outcome.unrecovered)}\n`); return 1; }
    await Promise.all([...pending]);
    return 0;
  }
  return { handleLine, serve, tracked: () => [...tracked] };
}

export function parseServeArgs(argv: string[]): { ok: true; checkout: string } | { ok: false; message: string } {
  if (argv[0] !== 'serve') return { ok: false, message: 'Usage: workflow.mjs serve --checkout <absolute-checkout>' };
  if (argv.length !== 3 || argv[1] !== '--checkout' || !path.isAbsolute(argv[2])) return { ok: false, message: 'Usage: workflow.mjs serve --checkout <absolute-checkout>' };
  return { ok: true, checkout: argv[2] };
}
