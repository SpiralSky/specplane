import * as path from 'node:path';
import * as fs from 'node:fs';
import { listPlans } from '../plan/resolve.js';
import { parseFrontmatter } from '../frontmatter.js';
import { FrontmatterError } from '../errors.js';
import { PLAN_SCHEMA, validator, describeErrors } from '../schemas.js';
import { buildGraph } from '../plan/graph.js';
import { getIndexStatus, type IndexStatus } from '../plan/status.js';
import type { Config, PlanFrontmatter } from '../types.js';
import type { PlanSnapshot } from './snapshot.js';
import { toMermaid } from './mermaid.js';

export interface LiveContext { statuses: ReadonlyMap<string, IndexStatus>; targets: ReadonlyMap<string, string> }
export function snapshotRecords(snapshot: PlanSnapshot): { id: string; archived: boolean; fm: PlanFrontmatter }[] {
  return snapshot.plans.map(file => {
    const parts = file.path.split('/'); const id = parts[parts.length - 2];
    const { data } = parseFrontmatter(file.bytes.toString('utf8'), file.path);
    const valid = validator(PLAN_SCHEMA);
    if (!valid(data)) throw new FrontmatterError(file.path, describeErrors(valid.errors));
    if (data.id !== id) throw new FrontmatterError(file.path, `\`id\` \`${data.id}\` does not match the folder name \`${id}\``);
    return { id, archived: file.path.slice(snapshot.outputPath.slice(0, -'PLANS.md'.length).length).startsWith('archive/'), fm: data as unknown as PlanFrontmatter };
  });
}
const cell = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const linkPart = (s: string) => encodeURIComponent(s);
/** Render only captured bytes and supplied read-side context. */
export function generatePlansMd(snapshot: PlanSnapshot, opts: { live?: boolean; liveContext?: LiveContext } = {}): string {
  if (opts.live && !opts.liveContext) throw new Error('Live rendering requires live context.');
  if (!opts.live && opts.liveContext) throw new Error('Live context requires live rendering.');
  const records = snapshotRecords(snapshot), config = snapshot.config;
  const byId = new Map(records.map(r => [r.id, r.fm]));
  const link = (id: string) => {
    const rec = records.find(r => r.id === id);
    return `[${cell(id)}](${rec?.archived ? 'archive/' : ''}${linkPart(id)}/PLAN.md)`;
  };
  const statuses = new Map(records.map(r => [r.id, opts.live ? (opts.liveContext!.statuses.get(r.id) ?? getIndexStatus(r.fm, byId, config)) : getIndexStatus(r.fm, byId, config)]));
  const target = (r: typeof records[number]) => cell(opts.live ? (opts.liveContext!.targets.get(r.id) ?? 'unavailable') : (r.fm.target_branch ?? config.plans.target_branch ?? 'repository default'));
  const active = records.filter(r => !r.archived), archived = records.filter(r => r.archived);
  const activeSection = active.length ? ['| ID | Title | Status | Target | Dependencies | Specs |', '|----|-------|--------|--------|--------------|-------|', ...active.map(r => `| ${link(r.id)} | ${cell(r.fm.title)} | ${statuses.get(r.id)} | ${target(r)} | ${r.fm.depends_on?.length ? [...r.fm.depends_on].sort().map(link).join(', ') : '—'} | ${r.fm.specs.map(cell).join(', ')} |`)].join('\n') : '_None._';
  const archivedSection = archived.length ? ['| ID | Title | Status | Target | Specs |', '|----|-------|--------|--------|-------|', ...archived.map(r => `| ${link(r.id)} | ${cell(r.fm.title)} | ${statuses.get(r.id)} | ${target(r)} | ${r.fm.specs.map(cell).join(', ')} |`)].join('\n') : '_None._';
  return ['<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane plan index -->', '', '# Plans', '', '## Active plans', '', activeSection, '', '## Archived plans', '', archivedSection, '', '## Dependency graph', '', '```mermaid', toMermaid(buildGraph(records.map(r => ({ id: r.id, depends_on: r.fm.depends_on }))), statuses), '```', ''].join('\n');
}
export function plansMdPath(config: Config, root: string): string { return path.join(root, config.plans.dir, 'PLANS.md'); }
/** Temporary lifecycle adapter; step 3 replaces this with prospective snapshots. */
export function generateWorkingPlansMd(config: Config, root: string): string {
  const plans = listPlans(config, root).map(r => ({path: path.relative(root, path.join(r.dir, 'PLAN.md')).split(path.sep).join('/'), bytes: fs.readFileSync(path.join(r.dir, 'PLAN.md'))}));
  return generatePlansMd({source: 'working', identity: '', digest: '', configBytes: null, config, warnings: [], plans, outputPath: path.posix.join(config.plans.dir.replaceAll('\\', '/'), 'PLANS.md'), outputUnmerged: false, excluded: [], preimage: ''});
}
