import { randomUUID } from 'node:crypto';
import { lazyValidator } from '../lazy-validator.js';
import type { ContributionEvent } from './contracts.js';
import { contributionEventSchema } from './schemas.js';

const shape = lazyValidator(contributionEventSchema);
const trailerSchema = {
  type: 'object',
  properties: {
    spec: { type: 'string', minLength: 1 }, contributor: { type: 'string', minLength: 1 },
    role: { enum: ['create', 'revise', 'review'] }, source: { enum: ['runtime', 'declared'] },
    event_id: { type: 'string', pattern: '^[0-9a-fA-F-]+$' },
    ...Object.fromEntries(['request_id', 'harness', 'session_id', 'parent_session_id', 'provider', 'model_id'].map(k => [k, { type: 'string', minLength: 1 }])),
    action: contributionEventSchema.properties.action, revision: contributionEventSchema.properties.revision,
  },
  required: ['spec', 'contributor', 'role', 'source'],
};
const trailerShape = lazyValidator(trailerSchema);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Must verify resolved spec, policy, action evidence, workflow membership and trusted runtime observation. */
export type ContributionVerifier = (event: ContributionEvent) => boolean;

export function validateContribution(event: unknown, verify: ContributionVerifier): asserts event is ContributionEvent {
  if (!shape(event)) throw new Error('Invalid contribution event');
  const e = event as ContributionEvent;
  if (!uuid.test(e.eventId) || ({ create: 'create', revise: 'edit', review: 'review' } as const)[e.role] !== e.action.kind) throw new Error('Invalid event ID or role/action');
  if (e.role === 'review' ? !('reviewedDigest' in e.revision) : !('beforeDigest' in e.revision) || e.revision.beforeDigest === e.revision.afterDigest) throw new Error('Invalid contribution revision');
  if (!verify(e)) throw new Error('Contribution evidence could not be verified');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function deduplicateContributions(events: readonly ContributionEvent[], verify: ContributionVerifier): ContributionEvent[] {
  const seen = new Map<string, { bytes: string; event: ContributionEvent }>();
  for (const event of events) {
    validateContribution(event, verify);
    const bytes = canonical(event), previous = seen.get(event.eventId);
    if (previous && previous.bytes !== bytes) throw new Error(`Conflicting contribution event ${event.eventId}`);
    if (!previous) seen.set(event.eventId, { bytes, event: structuredClone(event) });
  }
  return [...seen.values()].map(x => x.event).sort((a, b) => a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);
}
export type ContributorSummary = { id: string; kind: 'human' | 'model'; provider?: string; model_id?: string; display_name?: string; roles: ContributionEvent['role'][] };
export type EventReference = { commit: string; ordinal: number };
export type ContributionTrailer = { spec: string; contributor: string; role: ContributionEvent['role']; source: ContributionEvent['source']; event_id?: string; request_id?: string; harness?: string; session_id?: string; parent_session_id?: string; provider?: string; model_id?: string; action?: ContributionEvent['action']; revision?: ContributionEvent['revision']; corrects?: EventReference; origin?: EventReference };
/** Summaries belong to one spec; unknown actors never merge based on display names. */
export function contributionTrailer(event: ContributionEvent, summaries: ContributorSummary[], verify: ContributionVerifier): ContributionTrailer {
  validateContribution(event, verify);
  const a = event.actor;
  let summary = a.kind === 'model' && a.provider && a.model_id ? summaries.find(s => s.kind === 'model' && s.provider === a.provider && s.model_id === a.model_id) : summaries.find(s => s.id === event.eventId);
  if (!summary) {
    summary = { id: a.kind === 'model' && a.provider && a.model_id ? randomUUID() : event.eventId, kind: a.kind, ...(a.provider && { provider: a.provider }), ...(a.model_id && { model_id: a.model_id }), ...(a.display_name && { display_name: a.display_name }), roles: [] };
    summaries.push(summary);
  }
  if (!summary.roles.includes(event.role)) summary.roles.push(event.role);
  return { spec: event.spec, contributor: summary.id, role: event.role, source: event.source, event_id: event.eventId, request_id: event.requestId, ...(a.harness && { harness: a.harness }), ...(a.session_id && { session_id: a.session_id }), ...(a.parentSessionId && { parent_session_id: a.parentSessionId }), ...(a.provider && { provider: a.provider }), ...(a.model_id && { model_id: a.model_id }), action: structuredClone(event.action), revision: structuredClone(event.revision) };
}
/** Keep original references and reject corrections whose targets are unavailable. */
export function carryContributions(commits: readonly { commit: string; values: readonly string[] }[]): string[] {
  const events: ContributionTrailer[] = [], refs = new Map<string, EventReference>();
  const key = (r: EventReference) => `${r.commit}:${r.ordinal}`;
  const valid = (r: EventReference | undefined): r is EventReference => !!r && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(r.commit) && Number.isSafeInteger(r.ordinal) && r.ordinal >= 0;
  for (const { commit, values } of commits) for (const [ordinal, value] of values.entries()) {
    let event: ContributionTrailer;
    try { event = JSON.parse(value) as ContributionTrailer; } catch { throw new Error('Malformed contribution trailer'); }
    if (!trailerShape(event)) throw new Error('Invalid contribution trailer');
    if (event.event_id !== undefined || event.action !== undefined || event.revision !== undefined) {
      if (!event.event_id || !uuid.test(event.event_id) || !event.action || !event.revision ||
          ({ create: 'create', revise: 'edit', review: 'review' } as const)[event.role] !== event.action.kind ||
          (event.role === 'review' ? !('reviewedDigest' in event.revision) : !('beforeDigest' in event.revision) || event.revision.beforeDigest === event.revision.afterDigest)) throw new Error('Invalid contribution trailer evidence');
    }
    const current = { commit, ordinal };
    if (!valid(current) || (event.origin !== undefined && !valid(event.origin)) || (event.corrects !== undefined && !valid(event.corrects))) throw new Error('Invalid contribution reference');
    const origin = event.origin ?? current;
    for (const ref of [current, origin]) {
      const existing = refs.get(key(ref));
      if (existing && key(existing) !== key(origin)) throw new Error('Conflicting contribution references');
      refs.set(key(ref), origin);
    }
    events.push({ ...event, origin });
  }
  for (const event of events) if (event.corrects) {
    const target = refs.get(key(event.corrects));
    if (!target) throw new Error('Incomplete contribution correction history');
    event.corrects = target;
  }
  const seen = new Map<string, string>(), result: string[] = [];
  for (const event of events) {
    if (event.event_id) {
      const { origin: _origin, ...payload } = event, bytes = canonical(payload), previous = seen.get(event.event_id);
      if (previous !== undefined) { if (previous !== bytes) throw new Error(`Conflicting contribution event ${event.event_id}`); if (events.some(e => e.corrects)) throw new Error('Duplicate events with corrections require reconciliation'); continue; }
      seen.set(event.event_id, bytes);
    }
    result.push(JSON.stringify(event));
  }
  return result;
}
