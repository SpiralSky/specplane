import { CLAUDE_WORKFLOWS, hostRows } from './conformance-matrix.js';

/** Release readiness derived from the conformance matrix. It records limits and blockers; it never freezes hashes and never claims live-host evidence. */
export interface ReleaseEvidence {
  hosts: { host: 'claude' | 'codex'; delivered: string[]; pending: string[]; blocker?: string }[];
  /** Pin and skill-comment refresh follows implementation review, which is the user's decision. */
  pinReview: { state: 'awaiting-user-review'; refreshedBy: 'none'; note: string };
  /** Current spec dependency pins say nothing about installed skills; skill conformance is a separate, reviewed claim. */
  skillConformance: 'not-claimed';
  humanOnly: ('finish' | 'merge' | 'publication')[];
}

export function releaseEvidence(): ReleaseEvidence {
  const split = (host: 'claude' | 'codex') => {
    const rows = hostRows(host);
    return { delivered: rows.filter(r => r.deterministic === 'tested').map(r => r.workflow), pending: rows.filter(r => r.deterministic !== 'tested').map(r => r.workflow) };
  };
  const claude = split('claude');
  return {
    hosts: [
      { host: 'claude', ...claude, blocker: claude.pending.length ? 'claude-delivery 01 is blocked on native host API evidence' : undefined },
      { host: 'codex', ...split('codex') },
    ],
    pinReview: { state: 'awaiting-user-review', refreshedBy: 'none', note: 'Skill pins and contract comments are refreshed only after the user reviews the implementation.' },
    skillConformance: 'not-claimed',
    humanOnly: ['finish', 'merge', 'publication'],
  };
}

/** Blockers are derived from workflow rows and review state, so no generic "unavailable" flag can stand in for or clear them. */
export function releaseBlockers(e: ReleaseEvidence = releaseEvidence()): string[] {
  const out: string[] = [];
  for (const h of e.hosts) if (h.pending.length) out.push(`${h.host}: ${h.pending.length} workflow(s) not delivered (${h.blocker ?? 'no reason recorded'})`);
  if (e.pinReview.state === 'awaiting-user-review') out.push('pins and skill comments: awaiting user implementation review');
  return out;
}

export const EXPECTED_CLAUDE_PENDING = CLAUDE_WORKFLOWS.length;
