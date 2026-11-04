/** Read committed attribution without turning published declarations into host proof. */
import * as path from 'node:path';
import { run } from '../git/exec.js';
import { CONFIG_PATH, parseConfigText } from '../config.js';
import { SpecNotFoundError, UnknownRootError } from '../errors.js';
import { resolveSpecId } from '../spec/resolve.js';
import { parseSpecContent } from '../spec/parse.js';
import { prepareContributionMetadata, setFinalizedAssistAuthor } from './contribution-metadata.js';
import type { ContributionEvent } from './contracts.js';
import { readTrailerEntries } from '../git/commit.js';
import { carryContributions, type ContributionTrailer, type EventReference, type ContributorSummary } from './contributions.js';
import { canonical, sha256 } from './workflow-preparation.js';

export interface CommittedContribution { commit:string;ordinal:number;event:ContributionTrailer;verification?:HistoricalContributionVerification }
export interface CommittedContributionInspection { head:string;events:CommittedContribution[];limitations:string[] }
function fail(message:string):never{throw Object.assign(new Error(message),{code:'RECOVERY_REQUIRED'});}
function reference(value:unknown):value is EventReference{
 const v=value as EventReference|undefined;
 return !!v&&/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(v.commit)&&Number.isSafeInteger(v.ordinal)&&v.ordinal>=0;
}
const key=(ref:EventReference)=>`${ref.commit}:${ref.ordinal}`;

/** Conflicts are checked across the complete reachable history before filtering.
 * Correction references outside reachable events/carried origins stay explicit
 * incomplete history, including shallow clones and pruned rewrite originals.
 */
export function inspectCommittedContributions(checkout:string,query:{spec?:string;requestId?:string}={}):CommittedContributionInspection{
 if(!checkout||[query.spec,query.requestId].some(v=>v!==undefined&&(typeof v!=='string'||!v.trim())))fail('Invalid committed contribution query.');
 const events:CommittedContribution[]=[],refs=new Map<string,EventReference>();
 const head=run('git',['rev-parse','HEAD'],{cwd:checkout}).trim();
 const commits=run('git',['rev-list','--reverse','--topo-order',head],{cwd:checkout}).trim().split('\n').filter(Boolean);
 for(const commit of commits){
  const values=readTrailerEntries(commit,checkout).filter(([name])=>name.toLowerCase()==='specplane-contribution').map(([,value])=>value);
  for(const [ordinal,value] of values.entries()){
   let event:ContributionTrailer;
   try{
    event=JSON.parse(value) as ContributionTrailer;
    // Reuse the shared transport validator. Correction availability is checked
    // against this complete history below, preserving the actual trailer bytes.
    const candidate={...event};delete candidate.corrects;
    candidate.origin??={commit,ordinal};
    carryContributions([{commit,values:[JSON.stringify(candidate)]}]);
    if(event.corrects!==undefined&&!reference(event.corrects))throw new Error('Invalid correction reference');
   }catch(e){fail(`Malformed contribution at ${commit}:${ordinal}: ${e instanceof Error?e.message:String(e)}`);}
   const current={commit,ordinal},origin=event.origin??current;
   for(const ref of [current,origin]){
    const previous=refs.get(key(ref));
    if(previous&&key(previous)!==key(origin))fail(`Conflicting contribution reference ${key(ref)}.`);
    refs.set(key(ref),origin);
   }
   events.push({commit,ordinal,event});
  }
 }
 const limitations=[
  'Committed attribution is recorded history; private action evidence and runtime identities are not independently verified.',
  'Historical checks bind published config/spec blobs and exact available revision bytes; private host execution and identity evidence remain unavailable.',
 ];
 const missing=new Set<string>(),seen=new Map<string,string>(),unique:CommittedContribution[]=[];
 for(const item of events){
  const {origin:_origin,...payload}=item.event;
  if(payload.corrects){
   const target=refs.get(key(payload.corrects));
   if(target)payload.corrects=target;
   else missing.add(key(payload.corrects));
  }
  const bytes=canonical(payload),id=item.event.event_id;
  if(id){
   const previous=seen.get(id);
   if(previous!==undefined){if(previous!==bytes)fail(`Conflicting contribution event ${id}; reconcile committed history.`);continue;}
   seen.set(id,bytes);
  }
  unique.push(item);
 }
 for(const target of [...missing].sort())limitations.push(`Incomplete contribution correction history: target ${target} is absent from reachable HEAD events and carried origins.`);
 const verifier=historyVerifier(checkout,refs);
 // A collapsed retry still has to preserve a truthful origin reference.
 for(const item of events)if(item.event.origin)verifier.validateOrigin(item);
 for(const item of unique){item.verification=verifier.verify(item);for(const limitation of item.verification.limitations)limitations.push(`${item.commit}:${item.ordinal}: ${limitation}`);}
 return {head,events:unique.filter(({event})=>(!query.spec||event.spec===query.spec)&&(!query.requestId||event.request_id===query.requestId)).map(item=>structuredClone(item)),limitations};
}

type RevisionField='reviewedDigest'|'beforeDigest'|'afterDigest';
export interface HistoricalContributionVerification {
 contextCommit:string;specPath:string|null;blob:string|null;summary:'matched'|'unavailable';
 revision:Partial<Record<RevisionField,'matched'|'unavailable'>>;limitations:string[];
}
interface HistoricalBlob {path:string;blob:string;bytes:Buffer}
function historyVerifier(checkout:string,refs:Map<string,EventReference>){
 const trees=new Map<string,HistoricalBlob|null>(),configs=new Map<string,ReturnType<typeof parseConfigText>['config']|null>();
 const groups=new Map<string,{blob:HistoricalBlob;events:ContributionTrailer[];candidates:Set<string>;endpoints:Set<string>;limitations:string[]}>();
 const payload=(event:ContributionTrailer)=>{const {origin:_origin,...rest}=event;if(rest.corrects)rest.corrects=refs.get(key(rest.corrects))??rest.corrects;return canonical(rest);};
 function blob(commit:string,file:string):HistoricalBlob|null{
  const cache=`${commit}:${file}`;if(trees.has(cache))return trees.get(cache)!;
  const line=run('git',['--literal-pathspecs','ls-tree','-z',commit,'--',file],{cwd:checkout});
  if(!line){trees.set(cache,null);return null;}
  const match=/^(100644|100755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t([^\0]+)\0$/.exec(line);
  if(!match||match[3]!==file)fail(`Nonregular historical contribution input ${commit}:${file}.`);
  let bytes:Buffer;try{bytes=run('git',['cat-file','blob',match[2]],{cwd:checkout,binary:true});}catch{return null;}
  const result={path:file,blob:match[2],bytes};trees.set(cache,result);return result;
 }
 function config(commit:string){
  if(configs.has(commit))return configs.get(commit)!;
  const file=blob(commit,CONFIG_PATH);if(!file){configs.set(commit,null);return null;}
  let parsed:ReturnType<typeof parseConfigText>['config'];
  try{parsed=parseConfigText(file.bytes.toString(),checkout,{checkSpecRoots:false,snapshot:true}).config;}
  catch(e){fail(`Invalid historical contribution configuration at ${commit}: ${e instanceof Error?e.message:String(e)}`);}
  configs.set(commit,parsed);return parsed;
 }
 function spec(commit:string,id:string,prior=false):HistoricalBlob|null{
  const selected=config(commit);if(!selected)return null;
  let found:ReturnType<typeof resolveSpecId>;
  try{found=resolveSpecId(id,selected,undefined,checkout,file=>{
   const relative=path.relative(checkout,file).split(path.sep).join('/');
   if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative)||relative.split('/').includes('.git'))fail('Historical spec root escapes the repository.');
   return blob(commit,relative)!==null;
  });}catch(e){if(e instanceof SpecNotFoundError||(prior&&e instanceof UnknownRootError))return null;fail(`Historical contribution spec resolution failed at ${commit}: ${e instanceof Error?e.message:String(e)}`);}
  if(id!==`${found.root}:${found.id}`)fail(`Contribution spec is not exactly root-qualified: ${id}.`);
  return blob(commit,path.relative(checkout,found.path).split(path.sep).join('/'));
 }
 function validateSummary(event:ContributionTrailer,file:HistoricalBlob){
  let metadata:ReturnType<typeof parseSpecContent>['frontmatter'];
  try{metadata=parseSpecContent(file.bytes.toString(),file.path).frontmatter;prepareContributionMetadata(file.bytes.toString(),[]);}
  catch(e){fail(`Invalid historical spec ${file.path}: ${e instanceof Error?e.message:String(e)}`);}
  if(metadata.id!==event.spec.slice(event.spec.indexOf(':')+1))fail(`Historical contribution spec ID differs from ${event.spec}.`);
  const summaries=(metadata as unknown as {contributors?:ContributorSummary[]}).contributors??[];
  const summary=summaries.find(s=>s.id===event.contributor);
  if(!summary||!summary.roles.includes(event.role)||summary.provider!==event.provider||summary.model_id!==event.model_id||((event.provider||event.model_id)&&summary.kind!=='model'))fail(`Historical contributor summary differs from event ${event.event_id}.`);
  return summary;
 }
 const correctionOrigins=new Map<string,EventReference|null>();
 function correctionOrigin(ref:EventReference,visiting=new Set<string>()):EventReference|null{
  const location=key(ref),known=refs.get(location);if(known)return known;
  if(correctionOrigins.has(location))return correctionOrigins.get(location)!;
  if(visiting.has(location))fail(`Cyclic historical correction origin ${location}.`);visiting.add(location);
  try{run('git',['cat-file','-e',`${ref.commit}^{commit}`],{cwd:checkout});}catch{correctionOrigins.set(location,null);return null;}
  const value=readTrailerEntries(ref.commit,checkout).filter(([name])=>name.toLowerCase()==='specplane-contribution')[ref.ordinal]?.[1];
  if(value===undefined){correctionOrigins.set(location,null);return null;}
  let target:ContributionTrailer;try{target=JSON.parse(value);carryContributions([{commit:ref.commit,values:[JSON.stringify({...target,corrects:undefined})]}]);}catch(e){fail(`Malformed historical correction target ${location}: ${e instanceof Error?e.message:String(e)}`);}
  const original=target.origin?correctionOrigin(target.origin,visiting):ref;correctionOrigins.set(location,original);return original;
 }
 function original(item:CommittedContribution):{commit:string;event:ContributionTrailer}|null{
  let current={commit:item.commit,ordinal:item.ordinal,event:item.event};const visited=new Set<string>();
  while(current.event.origin){
   const origin=current.event.origin,location=key(origin);
   if(visited.has(location))fail(`Cyclic contribution origin ${location}.`);visited.add(location);
   try{run('git',['cat-file','-e',`${origin.commit}^{commit}`],{cwd:checkout});}catch{return null;}
   const values=readTrailerEntries(origin.commit,checkout).filter(([name])=>name.toLowerCase()==='specplane-contribution');
   const value=values[origin.ordinal]?.[1];if(value===undefined)fail(`Contribution origin ordinal is absent: ${location}.`);
   let event:ContributionTrailer;try{event=JSON.parse(value);carryContributions([{commit:origin.commit,values:[JSON.stringify({...event,corrects:undefined})]}]);}catch(e){fail(`Malformed contribution origin ${location}: ${e instanceof Error?e.message:String(e)}`);}
   const {origin:_oldOrigin,corrects:oldCorrection,...oldPayload}=event;
   const {origin:_newOrigin,corrects:newCorrection,...newPayload}=current.event;
   if(canonical(oldPayload)!==canonical(newPayload)||!!oldCorrection!==!!newCorrection)fail(`Contribution origin payload conflicts at ${location}.`);
   if(oldCorrection&&newCorrection&&key(oldCorrection)!==key(newCorrection)){
    const oldTarget=correctionOrigin(oldCorrection),newTarget=correctionOrigin(newCorrection);
    if(!oldTarget||!newTarget)return null;
    if(key(oldTarget)!==key(newTarget))fail(`Contribution origin correction conflicts at ${location}.`);
   }
   current={...origin,event};
  }
  return {commit:current.commit,event:current.event};
 }
 function group(commit:string,event:ContributionTrailer,file:HistoricalBlob){
  const id=`${commit}:${event.spec}`,cached=groups.get(id);if(cached)return cached;
  const all=readTrailerEntries(commit,checkout).filter(([name])=>name.toLowerCase()==='specplane-contribution').map(([,value])=>JSON.parse(value) as ContributionTrailer).filter(e=>e.spec===event.spec);
  const byId=new Map<string,ContributionTrailer>();
  for(const value of all){
   try{carryContributions([{commit,values:[JSON.stringify({...value,corrects:undefined})]}]);}catch(e){fail(`Malformed original contribution group at ${commit}: ${e instanceof Error?e.message:String(e)}`);}
   if(value.event_id){const previous=byId.get(value.event_id);if(previous&&payload(previous)!==payload(value))fail(`Conflicting original contribution event ${value.event_id}.`);if(!previous)byId.set(value.event_id,value);}
  }
  const modern=[...byId.values()],candidates=new Set([sha256(file.bytes)]),endpoints=new Set([sha256(file.bytes)]),limitations:string[]=[];
  const parents=run('git',['rev-list','--parents','-n','1',commit],{cwd:checkout}).trim().split(' ').slice(1);
  const parent=parents.length===1?spec(parents[0],event.spec,true):null;
  // Missing bytes and an observed absence are distinct historical facts.
  const parentConfig=parents.length===1?config(parents[0]):null;
  const absentParent=parentConfig!==null&&parentConfig.spec_roots.some(root=>root.name===event.spec.split(':')[0])&&parent===null;
  if(parent)candidates.add(sha256(parent.bytes));
  else if(absentParent)candidates.add('missing');
  for(const modernEvent of modern)validateSummary(modernEvent,file);
  const valid=modern.every(e=>!!e.request_id&&!e.corrects&&!e.origin)&&all.every(e=>!!e.event_id);
  let observations:ContributionEvent[]=[];
  if(valid)observations=modern.map(e=>{
   const s=validateSummary(e,file);
   return {eventId:e.event_id!,requestId:e.request_id!,spec:e.spec,role:e.role,source:e.source,action:structuredClone(e.action!),revision:structuredClone(e.revision!),actor:{kind:s.kind,...(e.provider?{provider:e.provider}:{}),...(e.model_id?{model_id:e.model_id}:{}),...(s.display_name!==undefined?{display_name:s.display_name}:{}),...(e.harness?{harness:e.harness}:{}),...(e.session_id?{session_id:e.session_id}:{}),...(e.parent_session_id?{parentSessionId:e.parent_session_id}:{})}};
  });
  if(valid&&Buffer.from(file.bytes.toString()).equals(file.bytes)){
   const current=file.bytes.toString(),variants=new Set<string>();
   if(parent&&Buffer.from(parent.bytes.toString()).equals(parent.bytes)){
    const old=parent.bytes.toString(),oldEnd=headerEnd(old),currentEnd=headerEnd(current);
    if(oldEnd!==null&&currentEnd!==null){
     const candidate=old.slice(0,oldEnd)+current.slice(currentEnd);variants.add(candidate);
     try{variants.add(setFinalizedAssistAuthor(candidate));}catch{/* An unsafe author patch supplies no candidate. */}
    }
   }else if(absentParent&&modern.some(e=>e.role==='create')){
    // Dedicated creations start without contributors. The core's insertion is
    // one flow-style field; remove only its exact source line, never reserialize
    // YAML. Forward byte/trailer reproduction below must still prove the guess.
    const end=headerEnd(current);
    if(end!==null){
     const header=current.slice(0,end),matches=[...header.matchAll(/^contributors:[^\r\n]*(?:\r\n|\n|\r)/gm)];
     if(matches.length===1){const match=matches[0];variants.add(current.slice(0,match.index)+current.slice(match.index!+match[0].length));}
    }
   }
   for(const variant of variants)try{
    const forward=prepareContributionMetadata(variant,observations);
    const emitted=forward.trailers.map(value=>payload(JSON.parse(value))).sort(),recorded=modern.map(payload).sort();
    if(Buffer.from(forward.text).equals(file.bytes)&&canonical(emitted)===canonical(recorded)){candidates.add(sha256(variant));endpoints.add(sha256(variant));}
   }catch{/* Lossless forward proof is unavailable; never normalize or guess bytes. */}
  }
  const edits=modern.filter(e=>e.role!=='review');
  if(edits.length){
   const before=new Map<string,ContributionTrailer>();
   for(const edit of edits){if(!edit.revision||!('beforeDigest' in edit.revision))fail('Invalid historical edit revision.');if(before.has(edit.revision.beforeDigest))fail(`Ambiguous historical contribution revision chain at ${commit}.`);before.set(edit.revision.beforeDigest,edit);}
   const ends=new Set(edits.map(edit=>(edit.revision as {afterDigest:string}).afterDigest));
   const starts=[...before.keys()].filter(digest=>!ends.has(digest));
   if(starts.length!==1)fail(`${starts.length?'Disconnected':'Cyclic'} historical contribution revision chain at ${commit}.`);
   const parentDigest=parent?sha256(parent.bytes):absentParent?'missing':undefined;
   let revision=parentDigest&&before.has(parentDigest)?parentDigest:starts[0];
   if(!parentDigest||!before.has(parentDigest))limitations.push('The initial contribution revision cannot be bound to an available single-parent spec blob or observed absence; the initial endpoint remains incomplete.');
   if(revision){
    const remaining=new Set(edits);
    while(remaining.size){const next=before.get(revision!);if(!next||!remaining.has(next))fail(`Disconnected historical contribution revision chain at ${commit}.`);remaining.delete(next);revision=(next.revision as {afterDigest:string}).afterDigest;}
    if(!endpoints.has(revision!))limitations.push('The final action revision is unavailable as an exact historical action binding; available parent bytes do not establish the committed endpoint.');
    for(const review of modern.filter(e=>e.role==='review'))if(review.revision&&'reviewedDigest' in review.revision&&review.revision.reviewedDigest!==revision)fail(`Historical review differs from the final contribution revision at ${commit}.`);
   }else limitations.push('Contribution revision-chain endpoints are unavailable without an exact initial public revision.');
  }
  const result={blob:file,events:modern,candidates,endpoints,limitations};groups.set(id,result);return result;
 }
 function verify(item:CommittedContribution):HistoricalContributionVerification{
  const context=original(item),fields=item.event.revision?Object.keys(item.event.revision) as RevisionField[]:[];
  const verification:HistoricalContributionVerification={contextCommit:context?.commit??item.event.origin?.commit??item.commit,specPath:null,blob:null,summary:'unavailable',revision:Object.fromEntries(fields.map(field=>[field,'unavailable'])),limitations:[]};
  if(!item.event.event_id){verification.limitations.push('Legacy contribution has no modern action/revision evidence.');return verification;}
  if(!context){verification.limitations.push('Original contribution context is unavailable (commit or correction-reference objects); the squashed final blob does not substitute for its revision context.');return verification;}
  const file=spec(context.commit,item.event.spec);
  if(!file){verification.limitations.push('Historical configuration or the referenced spec blob is unavailable in the original contribution context.');return verification;}
  verification.specPath=file.path;verification.blob=file.blob;validateSummary(context.event,file);verification.summary='matched';
  const checked=group(context.commit,context.event,file);verification.limitations.push(...checked.limitations);
  for(const field of fields){
   const digest=(item.event.revision as unknown as Record<string,string>)[field];
   if((field==='beforeDigest'?checked.candidates:checked.endpoints).has(digest))verification.revision[field]='matched';
   else verification.limitations.push(`${field} is unavailable as an exact historical action binding; available public bytes do not establish this action endpoint, and intermediate action snapshots are not reconstructed from YAML normalization.`);
  }
  return verification;
 }
 return {verify,validateOrigin:original};
}
function headerEnd(text:string):number|null{
 const start=/^\uFEFF?---[ \t]*(?:\r\n|\n|\r)/.exec(text);if(!start)return null;
 const close=/^---[^\r\n]*(?:\r\n|\n|\r|$)/m.exec(text.slice(start[0].length));
 return close?start[0].length+close.index+close[0].length:null;
}
