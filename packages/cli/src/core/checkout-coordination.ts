/** Manual stateful commands run under the same repository/checkout writer lease as trusted adapters. */
import { randomUUID } from 'node:crypto';
import { acquireWriterLease, inspectWriterLease } from './writer-leases.js';

function request(root: string, name: string) {
  return { repository: true, checkouts: [root], requestId: `${name}-${randomUUID()}` };
}

/** Dry runs only inspect for a conflicting writer; they never take ownership. */
export function withCheckoutLease<T>(root: string, name: string, dryRun: boolean, fn: () => T): T {
  const req = request(root, name);
  if (dryRun) { inspectWriterLease(req); return fn(); }
  const lease = acquireWriterLease(req);
  try { return fn(); } finally { lease.release(); }
}

export async function withCheckoutLeaseAsync<T>(root: string, name: string, dryRun: boolean, fn: () => Promise<T>): Promise<T> {
  const req = request(root, name);
  if (dryRun) { inspectWriterLease(req); return fn(); }
  const lease = acquireWriterLease(req);
  try { return await fn(); } finally { lease.release(); }
}
