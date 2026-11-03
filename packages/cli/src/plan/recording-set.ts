/** Shared exact-set boundary for manual and prepared recording. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { lazyValidator } from '../lazy-validator.js';
import { run } from '../git/exec.js';
import { PlanStateError } from '../errors.js';

export interface RecordingSet { protocol: 1; head: string; branch: string; changes: { path: string; beforeDigest: string; afterDigest: string; purpose: string }[] }
const digest = { type: 'string', pattern: '^(missing|[a-f0-9]{64})$' };
const recordingSetSchema = { type: 'object', additionalProperties: false, required: ['protocol','head','branch','changes'], properties: {
  protocol: { const: 1 }, head: { type: 'string', pattern: '^([a-f0-9]{40}|[a-f0-9]{64})$' }, branch: { type: 'string', minLength: 1 },
  changes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path','beforeDigest','afterDigest','purpose'], properties: { path: { type:'string', minLength:1 }, beforeDigest: digest, afterDigest: digest, purpose: {type:'string',minLength:1} } } }
} };
const valid = lazyValidator(recordingSetSchema);
function fail(s: string): never { throw new PlanStateError(`Recording set: ${s}`); }
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const git = (root: string, ...args: string[]) => run('git', args, {cwd:root}).trim();
function relative(p: string) { if (path.isAbsolute(p) || p.includes('\\') || p.includes('\0') || p.split('/').some(c=>!c || c==='.' || c==='..') || p.split('/')[0]==='.git') fail(`invalid contained regular-file path ${p}`); }
function working(root: string, p: string): {digest: string; mode: string | null} {
  relative(p); let current=root;
  for (const [i, part] of p.split('/').entries()) {
    current=path.join(current,part); let st: fs.Stats;
    try { st=fs.lstatSync(current); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return {digest:'missing',mode:null}; throw e; }
    if(st.isSymbolicLink() || (i===p.split('/').length-1 ? !st.isFile() || st.nlink !== 1 : !st.isDirectory())) fail(`links and nonregular paths are unsupported: ${p}`);
  }
  const st=fs.statSync(current); return {digest:hash(fs.readFileSync(current)),mode:st.mode&0o111?'100755':'100644'};
}
function tree(root: string, args: string[]): Map<string,{mode:string;oid:string}> {
  const entries=new Map<string,{mode:string;oid:string}>();
  for(const row of run('git',args,{cwd:root}).split('\0').filter(Boolean)) {
    const tab=row.indexOf('\t'), fields=row.slice(0,tab).split(' '), p=row.slice(tab+1);
    if(args[0]==='ls-files' && fields[2]!=='0') fail(`unmerged entry ${p}; resolve conflicts first`);
    const mode=fields[0],oid=fields[1]==='blob'||fields[1]==='commit'?fields[2]:fields[1];
    entries.set(p,{mode,oid});
  } return entries;
}
/** Core progress paths must be safe even when unchanged and absent from the manifest. */
export function assertRecordingPaths(root: string, paths: string[]): void {
  for (const file of paths) working(root, file);
}
export function readRecordingSet(file: string | undefined, root: string): RecordingSet {
  if(!file) return fail('pass --recording-set <file> with the reviewed digest-bound edit manifest outside the checkout; staging is not consent.');
  const actual=fs.realpathSync(file), base=fs.realpathSync(root), rel=path.relative(base,actual);
  if(!rel || (!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel))) fail('manifest must be outside the checkout.');
  if(!fs.lstatSync(file).isFile()) fail('manifest must be a regular file.');
  let data: unknown; try {data=JSON.parse(fs.readFileSync(file,'utf8'));} catch {return fail('invalid JSON manifest.');}
  if(!valid(data)) fail('expected closed {protocol:1,head,branch,changes} manifest.');
  return data as RecordingSet;
}
export function validateRecordingSet(set: RecordingSet, root: string, planId: string, generated: string[], changed: string[], outcome: string): string[] {
  if(!valid(set)) fail('invalid manifest.');
  if(set.head!==git(root,'rev-parse','HEAD') || set.branch!==git(root,'branch','--show-current') || set.branch!==`plan/${planId}`) fail('HEAD/branch changed or checkout is not the designated plan branch; regenerate the reviewed manifest there.');
  const head=tree(root,['ls-tree','-rz','HEAD']), index=tree(root,['ls-files','--stage','-z']);
  for (const entry of run('git', ['ls-files', '-v', '-z'], {cwd:root}).split('\0').filter(Boolean)) {
    if (entry[0] === 'S' || entry[0] !== entry[0].toUpperCase()) fail(`assume-unchanged/skip-worktree entries are unsupported: ${entry.slice(2)}; clear the flag before recording.`);
  }
  for (const p of generated) {
    working(root, p);
    if ([head.get(p)?.mode, index.get(p)?.mode].some(mode => mode !== undefined && !['100644','100755'].includes(mode))) fail(`links/submodules unsupported: ${p}`);
  }
  const listed=run('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root}).split('\0').filter(Boolean);
  const diffPaths = (args: string[]) => run('git',args,{cwd:root}).split('\0').filter(Boolean);
  const paths=new Set([...diffPaths(['diff','--name-only','--no-renames','-z','HEAD']), ...diffPaths(['diff','--cached','--name-only','--no-renames','-z','HEAD']),...listed]);
  const edits=new Map(set.changes.map(c=>[c.path,c]));
  if(edits.size!==set.changes.length) fail('duplicate paths.');
  const reasons=new Map<string,string>();
  for(const entry of changed) { const colon=entry.indexOf(':'); const p=entry.slice(0,colon).trim(),reason=entry.slice(colon+1).trim(); if(colon<1||reasons.has(p)) fail('invalid or duplicate --changed entry.'); reasons.set(p,reason); }
  if(outcome==='skipped' && edits.size) fail('skipped outcomes require an empty edit manifest.');
  if(reasons.size!==edits.size) fail('every edit requires an exact matching --changed path:purpose.');
  for(const [p,e] of edits) { relative(p); if(generated.includes(p)) fail(`core-owned progress file changed: ${p}`); if(reasons.get(p)!==e.purpose) fail(`--changed purpose does not match manifest: ${p}`); }
  const observed=new Set<string>();
  for(const p of paths) {
    const h=head.get(p), i=index.get(p);
    if((h&&!['100644','100755'].includes(h.mode))||(i&&!['100644','100755'].includes(i.mode))) fail(`links/submodules unsupported: ${p}`);
    const w=working(root,p);
    const before=h?hash(run('git',['cat-file','blob',h.oid],{cwd:root,binary:true})):'missing';
    const indexDigest=i?hash(run('git',['cat-file','blob',i.oid],{cwd:root,binary:true})):'missing';
    const differs=before!==w.digest || h?.mode!==(w.mode??undefined) || indexDigest!==before || i?.mode!==h?.mode;
    if(!differs) continue;
    if((h&&!['100644','100755'].includes(h.mode))||(i&&!['100644','100755'].includes(i.mode))) fail(`links/submodules unsupported: ${p}`);
    if(generated.includes(p)) fail(`pre-existing core progress edit: ${p}`);
    const e=edits.get(p); if(!e) fail(`unreviewed change ${p}; include it explicitly or reconcile it before recording.`);
    if(before===w.digest) fail(`mode-only or index-only change unsupported: ${p}`);
    if(h&&w.mode&&h.mode!==w.mode) fail(`mode changes unsupported: ${p}`);
    if(e.beforeDigest!==before||e.afterDigest!==w.digest) fail(`stale before/after digest: ${p}`);
    const indexMatchesHead=indexDigest===before && i?.mode===h?.mode;
    const indexMatchesAfter=indexDigest===w.digest && i?.mode===(w.mode??undefined);
    if(!indexMatchesHead&&!indexMatchesAfter) fail(`partial staging: ${p}; index must match HEAD or the complete reviewed after-state.`);
    observed.add(p);
  }
  for(const p of edits.keys()) if(!observed.has(p)) fail(`manifest path has no actual change: ${p}`);
  return [...observed].sort();
}
