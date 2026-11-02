import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireWriterLease } from '../core/writer-leases.js';
import { capturePlanSnapshot, recheckPlanSnapshot, type SnapshotSource } from '../generate/snapshot.js';
import { generatePlansMd, snapshotRecords, type LiveContext } from '../generate/plans-md.js';
import { checkoutRoot } from '../git/repo.js';
import { branchExists, remoteBranchExists } from '../git/branch.js';
import { hasOpenPR } from '../git/forge.js';
import { localPlanIds, remotePlanIds, planReport, targetPlanRecord, selectedPlanBranch } from '../plan/activity.js';
import { getEffectiveStatus, type IndexStatus } from '../plan/status.js';
import type { PlanFrontmatter } from '../types.js';

export function generateCommand(opts: { print?: boolean; live?: boolean; source?: string }): void {
  try {
    const source = opts.source ?? 'head';
    if (!['head', 'staged', 'working'].includes(source)) throw new Error(`Unknown snapshot source: ${source}; choose head, staged or working.`);
    if (opts.live && !opts.print) throw new Error('--live requires --print.');
    const root = checkoutRoot();
    const lease = opts.print ? null : acquireWriterLease({repository: true, checkouts: [root], requestId: `index-${randomUUID()}`});
    try {
      const snapshot = capturePlanSnapshot(root, source as SnapshotSource);
      process.stderr.write(`notice: plan index source: ${source}\n`);
      for (const warning of snapshot.warnings) process.stderr.write(`notice: ${warning.message}\n`);
      if (snapshot.excluded.length) process.stderr.write(`notice: excluded pending inputs: ${snapshot.excluded.join(', ')}\n`);
      if (!opts.print && source === 'head' && snapshot.outputUnmerged) throw new Error('PLANS.md is conflicted; resolve and stage plan/config inputs, then run specplane plan index --source staged.');
      let liveContext: LiveContext | undefined;
      if (opts.live) {
        process.stderr.write('notice: live context uses local and previously fetched refs; no fetch performed.\n');
        const targets = new Map<string, string>(), statuses = new Map<string, IndexStatus>();
        const records = snapshotRecords(snapshot);
        const known = new Set(records.map(r => r.id));
        const additionalRecords: typeof records = [];
        for (const id of [...new Set([...localPlanIds(root), ...remotePlanIds(root)])].sort()) {
          if (known.has(id)) continue;
          const branch = selectedPlanBranch(id, snapshot.config, root);
          if (!branch) throw new Error(`Plan branch record unavailable for ${id}.`);
          additionalRecords.push({id, archived: false, fm: branch.data as unknown as PlanFrontmatter});
        }
        records.push(...additionalRecords);
        for (const record of records) {
          const report = planReport(record.id, snapshot.config, root, record.fm as unknown as Record<string, unknown>, 'local', true);
          const target = targetPlanRecord(record.id, snapshot.config, root, report);
          const branch = selectedPlanBranch(record.id, snapshot.config, root);
          if (!target || !report.target_branch || ((report.ref_freshness.plan_local || report.ref_freshness.plan_remote) && !branch)) throw new Error(`Authoritative live context unavailable for ${record.id}: ${report.integration_reasons.join('; ')}`);
          const authoritative = target.data as unknown as PlanFrontmatter;
          const selected = (branch?.data ?? target.data) as unknown as PlanFrontmatter;
          const status = ['shelved', 'abandoned', 'done'].includes(authoritative.status) ? authoritative.status : selected.status;
          const fm = {...selected, status, depends_on: authoritative.depends_on};
          const dependencies = new Map<string, PlanFrontmatter>();
          for (const id of fm.depends_on ?? []) {
            const dep = targetPlanRecord(id, snapshot.config, root, report);
            if (dep) dependencies.set(id, dep.data as unknown as PlanFrontmatter);
          }
          const base = report.target_branch;
          targets.set(record.id, base);
          statuses.set(record.id, getEffectiveStatus(fm, dependencies, target.config, {
            branchExists: id => branchExists(`plan/${id}`, root) || remoteBranchExists(`plan/${id}`, root),
            hasOpenPr: id => hasOpenPR(`plan/${id}`, {cwd: root, forge: target.config.plans.forge, base}),
          }));
        }
        liveContext = {targets, statuses, additionalRecords};
      }
      const content = generatePlansMd(snapshot, {live: opts.live, liveContext});
      if (opts.print) { process.stdout.write(content); return; }
      const file = path.join(root, snapshot.outputPath);
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) { lease!.assertOwned(); recheckPlanSnapshot(root, snapshot); process.stderr.write(`Unchanged ${snapshot.outputPath}\n`); return; }
      fs.mkdirSync(path.dirname(file), {recursive: true});
      const temp = path.join(path.dirname(file), `.specplane-index-${randomUUID()}.tmp`);
      const scratch = path.relative(root, temp).split(path.sep).join('/');
      try {
        fs.writeFileSync(temp, content, {flag: 'wx'});
        lease!.assertOwned(); recheckPlanSnapshot(root, snapshot, scratch);
        fs.renameSync(temp, file);
      } finally { try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
      process.stderr.write(`Wrote ${snapshot.outputPath}\n`);
    } finally { lease?.release(); }
  } catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exitCode = 1; }
}
