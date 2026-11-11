import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkoutRoot } from '../git/repo.js';
import { recordImplementation } from '../spec/implementation.js';
import { acquireWriterLease } from './writer-leases.js';
import type { AssessmentReason } from './completion.js';

/**
 * Implementation status is an `implementation` record in the notes store, not frontmatter
 * (`architecture/file-formats` §11.3, §13). Only `complete` can be written: unimplemented is the absence of a record,
 * and records are never removed.
 */
export interface CompletionReceipt {
  id: string; implementation_status: 'incomplete' | 'partial' | 'complete';
  assessment_status: 'current' | 'unrecorded'; assessment_reasons: AssessmentReason[];
  fingerprint: string | null; changed_file: string; changed: boolean; dry_run: boolean;
}

export function writeImplementation(input: { id: string; root?: string; status: 'incomplete' | 'partial' | 'complete'; dryRun?: boolean }, cwd: string, options: { signal?: AbortSignal } = {}): CompletionReceipt {
  if (!['incomplete', 'partial', 'complete'].includes(input.status)) throw new Error('Invalid implementation status');
  if (input.status !== 'complete') throw new Error('Only `complete` can be recorded: an unimplemented spec has no record, and records are never removed.');
  if (options.signal?.aborted) throw new Error('Operation aborted');
  const checkout = fs.realpathSync(checkoutRoot(cwd));
  const lease = input.dryRun ? undefined : acquireWriterLease({ checkouts: [checkout], repository: true, requestId: randomUUID() });
  try {
    const r = recordImplementation(checkout, input.id, { dryRun: input.dryRun });
    return { id: r.id, implementation_status: 'complete', assessment_status: 'current', assessment_reasons: [], fingerprint: r.fingerprint, changed_file: path.normalize(r.file), changed: r.changed, dry_run: !!input.dryRun };
  } finally { lease?.release(); }
}
