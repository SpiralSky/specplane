/**
 * Verification policy (architecture/reference-cli § Verification policy): the tier of a result is computed from
 * its actual edit set, and the minimum checks follow from the tier. Policy is read from committed configuration only.
 */
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { configAt } from '../plan/prepare-start.js';
import type { Config } from '../types.js';

export type Tier = 'text' | 'standard' | 'risk';
export type VerificationSettings = Config['verification'];
/** A check beyond the session's own work. `separate` comes from a validated `verify-review` artifact; `human` from a confirmed human-check. */
export type CheckKind = 'separate' | 'human';
export interface VerificationPolicy {
  /** Read from the configuration committed at the plan's start base (prepared HEAD when there is no plan). */
  verification: VerificationSettings;
  /** The block at the prepared HEAD differs from the start base, so the step needs a `human` check. */
  humanRequired: boolean;
}
export const TIER_RANK: Record<Tier, number> = { text: 0, standard: 1, risk: 2 };

/** Policy for a prepared request. Only committed bytes count, so uncommitted edits cannot alter it. */
export function loadVerificationPolicy(cwd: string, head: string, startBase: string | null | undefined): VerificationPolicy {
  const atHead = configAt(cwd, head).verification;
  if (!startBase) return { verification: atHead, humanRequired: false };
  const atStart = configAt(cwd, startBase).verification;
  return { verification: atStart, humanRequired: !isDeepStrictEqual(atStart, atHead) };
}

function braceAlternatives(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  let depth = 0, close = -1;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === '{') depth++;
    else if (pattern[i] === '}' && --depth === 0) { close = i; break; }
  }
  if (close === -1) return [pattern];
  const parts: string[] = [];
  let level = 0, from = open + 1;
  for (let i = open + 1; i < close; i++) {
    if (pattern[i] === '{') level++;
    else if (pattern[i] === '}') level--;
    else if (pattern[i] === ',' && level === 0) { parts.push(pattern.slice(from, i)); from = i + 1; }
  }
  parts.push(pattern.slice(from, close));
  return parts.flatMap(part => braceAlternatives(pattern.slice(0, open) + part + pattern.slice(close + 1)));
}
function globSource(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        const slashAfter = pattern[i + 2] === '/', atStart = i === 0 || pattern[i - 1] === '/';
        if (atStart && slashAfter) { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) out += '\\[';
      else {
        let cls = pattern.slice(i + 1, end);
        if (cls[0] === '!') cls = `^${cls.slice(1)}`;
        out += `[${cls.replace(/\\/g, '\\\\')}]`; i = end;
      }
    } else out += c.replace(/[.+^${}()|\]\\/]/g, '\\$&');
  }
  return out;
}
/** Match a repository-relative POSIX path: `*` and `?` stay within a segment, `**` crosses segments, dotfiles match. */
export function globMatch(pattern: string, file: string): boolean {
  const target = path.posix.normalize(file.replace(/^\.\//, ''));
  return braceAlternatives(pattern.replace(/^\.\//, '')).some(p => new RegExp(`^${globSource(p)}$`).test(target));
}
const inside = (file: string, folder: string): boolean => {
  const root = path.posix.normalize(folder.replace(/\\/g, '/')).replace(/\/+$/, '');
  return root === '.' || file === root || file.startsWith(`${root}/`);
};

/** `risk` beats `text`: a path matching `risk_paths`, or inside a configured spec root, makes the whole result risky. */
export function computeTier(changed: readonly string[], settings: VerificationSettings, specRoots: readonly { path: string }[]): Tier {
  const files = changed.map(file => path.posix.normalize(file.replace(/^\.\//, '')));
  if (files.some(file => settings.risk_paths.some(p => globMatch(p, file)) || specRoots.some(root => inside(file, root.path)))) return 'risk';
  if (files.every(file => settings.text_paths.some(p => globMatch(p, file)))) return 'text';
  return 'standard';
}

export interface Requirement {
  /** Suites that need a passing step-level receipt for the recorded state. */
  suites: string[];
  /** The review check a `done` result still needs, if any. */
  review: null | 'separate or human' | 'human';
}
export function requirementFor(policy: VerificationPolicy, tier: Tier): Requirement {
  const settings = policy.verification;
  const suites = settings.mode === 'auto' && tier !== 'text' ? Object.keys(settings.suites).sort() : [];
  const review = policy.humanRequired ? 'human' : settings.mode === 'auto' && tier === 'risk' ? 'separate or human' : null;
  return { suites, review };
}

/**
 * Checks recorded by core for a request, bound to the checkout state they cover. Core fills this only after it has
 * validated a `verify-review` artifact (core/verify-review.ts) or the user's confirmation (core/workflow-recording.ts);
 * nothing from a result can reach it. The state is process-local, like the validated proposals it serves: it
 * survives retries of validate and record within one server process, and a restarted server starts with no checks,
 * which refuses (never accepts) a risky `done` until the check is made again.
 */
const checks = new Map<string, Map<CheckKind, string>>();
export function recordVerificationCheck(requestId: string, kind: CheckKind, stateDigest: string): void {
  const entries = checks.get(requestId) ?? new Map<CheckKind, string>();
  checks.set(requestId, entries);
  entries.set(kind, stateDigest);
}
export function clearVerificationCheck(requestId: string, kind: CheckKind): void {
  checks.get(requestId)?.delete(kind);
}
/** A minimum the user lowered through a confirmed `lower-minimum` request, bound to the state it was confirmed for. */
const lowerings = new Map<string, { stateDigest: string; tier: Tier }>();
export function recordLowering(requestId: string, tier: Tier, stateDigest: string): void {
  lowerings.set(requestId, { stateDigest, tier });
}
export function confirmedLowering(requestId: string, stateDigest: string): Tier | null {
  const entry = lowerings.get(requestId);
  return entry && entry.stateDigest === stateDigest ? entry.tier : null;
}
export function satisfiedChecks(requestId: string, stateDigest: string): Set<CheckKind> {
  return new Set([...(checks.get(requestId) ?? [])].filter(([, state]) => state === stateDigest).map(([kind]) => kind));
}
export function reviewSatisfied(review: Requirement['review'], satisfied: ReadonlySet<CheckKind>): boolean {
  if (review === null) return true;
  return review === 'human' ? satisfied.has('human') : satisfied.has('separate') || satisfied.has('human');
}
