import { loadConfig } from '../config.js';
import { checkoutRoot } from '../git/repo.js';
import { runPlans, type RunResult } from '../plan/run.js';
import type { ConductorRequest, CoreContext, Result, SessionAdapter } from './contracts.js';

const ADAPTER_METHODS = ['probe', 'launch', 'observe', 'resume', 'recovery', 'cancel'] as const;
const fail = (code: string, message: string): Result<never> => ({ protocol: 1, ok: false, error: { code, message, retryable: false, details: null }, notices: [] });

/**
 * Invoke the shared conductor with an explicit extension-owned adapter. The core never selects, discovers or
 * substitutes an adapter, and never approves, finishes, merges or pushes. Per-plan exit semantics stay in each result's `code`.
 */
export async function runConductorImpl(request: ConductorRequest, context: CoreContext & { adapter: SessionAdapter }): Promise<Result<RunResult[]>> {
  const adapter = context.adapter;
  if (!adapter || typeof adapter.name !== 'string' || ADAPTER_METHODS.some(key => typeof (adapter as unknown as Record<string, unknown>)[key] !== 'function'))
    return fail('INVALID_EVIDENCE', 'runConductor requires an extension-supplied SessionAdapter; no default or discovery exists.');
  try {
    const root = checkoutRoot(context.checkout ?? process.cwd());
    const { config } = loadConfig(root);
    const notices: string[] = [];
    const results = await runPlans(request.plans, config, root, { ...request, signal: context.signal }, adapter, () => ({ log: line => notices.push(line) }));
    return { protocol: 1, ok: true, value: results, notices: notices.map(message => ({ code: 'CONDUCTOR_LOG', message })) };
  } catch (error) {
    return fail(context.signal?.aborted ? 'CANCELLED' : 'OPERATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
