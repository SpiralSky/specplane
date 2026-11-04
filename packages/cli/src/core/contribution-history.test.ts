import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inspectCommittedContributions } from './contribution-history.js';
import type { ContributionTrailer } from './contributions.js';
import { prepareContributionMetadata, setFinalizedAssistAuthor } from './contribution-metadata.js';
import { sha256 } from './workflow-preparation.js';
import type { ContributionEvent } from './contracts.js';

function fixture(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'contribution-history-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('config','user.name','Test');git('config','user.email','test@example.com');
 const commit=(events:unknown[])=>{
  const message=`docs: attribution\n\n${events.map(event=>`Specplane-Contribution: ${typeof event==='string'?event:JSON.stringify(event)}`).join('\n')}\n`;
  execFileSync('git',['commit','--allow-empty','-F','-'],{cwd,input:message,stdio:['pipe','pipe','pipe']});return git('rev-parse','HEAD');
 };
 return {cwd,git,commit,cleanup:()=>fs.rmSync(cwd,{recursive:true,force:true})};
}
const legacy:ContributionTrailer={spec:'base:architecture/test',contributor:'unknown-action',role:'review',source:'declared'};
function event():ContributionTrailer{return {...legacy,event_id:randomUUID(),request_id:'request',action:{kind:'review',evidencePath:'private.md',evidenceDigest:'a'.repeat(64)},revision:{reviewedDigest:'b'.repeat(64)}};}
const source='---\nid: architecture/test\ntitle: Historical test\nstatus: draft\nauthor: user\nimplements: [base:feature/test]\n# Retain this exact comment and whitespace.\n---\n# Body\nOriginal body.\n';
function historical(){
 const f=fixture();
 const put=(file:string,text:string)=>{fs.mkdirSync(path.dirname(path.join(f.cwd,file)),{recursive:true});fs.writeFileSync(path.join(f.cwd,file),text);};
 const configure=(root='specs')=>put('.specplane/config.yaml',`spec_roots:\n  - name: base\n    path: ${root}\n`);
 const save=(events:unknown[])=>{f.git('add','.');return f.commit(events);};
 configure();put('specs/architecture/test.md',source);const initial=save([]);
 const record=(text:string,events:ContributionEvent[],root='specs')=>{
  const metadata=prepareContributionMetadata(text,events);put(`${root}/architecture/test.md`,metadata.text);
  const trailers=metadata.trailers.map(value=>JSON.parse(value) as ContributionTrailer),commit=save(trailers);
  return {commit,trailers,text:metadata.text};
 };
 return {...f,put,configure,save,record,initial};
}
function action(before:string,after?:string,known=false):ContributionEvent{
 return {eventId:randomUUID(),requestId:'historical-request',spec:'base:architecture/test',role:after===undefined?'review':'revise',source:'declared',
  actor:{kind:'model',...(known?{provider:'host',model_id:'A'}:{})},action:{kind:after===undefined?'review':'edit',evidencePath:'private/review.md',evidenceDigest:sha256('private evidence')},
  revision:after===undefined?{reviewedDigest:sha256(before)}:{beforeDigest:sha256(before),afterDigest:sha256(after)}};
}

test('committed readers preserve repeated trailer order ordinals and legacy unknown identities',()=>{
 const f=fixture();try{
  const one=f.commit([legacy,{...legacy,contributor:'separate-action'}]);
  const two=f.commit([{...legacy,spec:'other:feature/test',request_id:'another-request'}]);
  const result=inspectCommittedContributions(f.cwd);
  assert.deepEqual(result.events.map(({commit,ordinal})=>[commit,ordinal]),[[one,0],[one,1],[two,0]]);
  assert.equal(result.events[0].event.model_id,undefined);
  assert.equal(inspectCommittedContributions(f.cwd,{spec:legacy.spec}).events.length,2);
  assert.equal(inspectCommittedContributions(f.cwd,{requestId:'another-request'}).events[0].commit,two);
  assert.ok(result.limitations.some(text=>text.includes('not independently verified')));
  assert.equal(f.git('status','--porcelain'),'');
 }finally{f.cleanup();}
});

test('retried event IDs collapse to the first identical committed event while origins survive',()=>{
 const f=fixture();try{
  const original=event(),first=f.commit([original]);
  f.commit([{...original,origin:{commit:first,ordinal:0}}]);
  const distinct={...event(),origin:{commit:'f'.repeat(40),ordinal:0}};f.commit([distinct]);
  const result=inspectCommittedContributions(f.cwd);
  assert.equal(result.events.length,2);assert.equal(result.events[0].commit,first);
  assert.deepEqual(result.events[1].event.origin,{commit:'f'.repeat(40),ordinal:0});
 }finally{f.cleanup();}
});

test('event ID conflicts require reconciliation even when a filter excludes their spec',()=>{
 const f=fixture();try{
  const original=event();f.commit([original]);f.commit([{...original,contributor:'different'}]);
  assert.throws(()=>inspectCommittedContributions(f.cwd,{spec:'unrelated:feature/test'}),{code:'RECOVERY_REQUIRED'});
 }finally{f.cleanup();}
});

test('corrections retain originals and resolve carried origins without inventing unavailable history',()=>{
 const f=fixture();try{
  const original=f.commit([legacy]);
  const corrected={...legacy,contributor:'corrected',corrects:{commit:original,ordinal:0}};f.commit([corrected]);
  const absent='1'.repeat(40),carried={...legacy,origin:{commit:absent,ordinal:2}};f.commit([carried]);
  f.commit([{...legacy,contributor:'carried-correction',corrects:{commit:absent,ordinal:2}}]);
  const missing={...legacy,contributor:'incomplete',corrects:{commit:'2'.repeat(40),ordinal:0}};f.commit([missing]);
  const result=inspectCommittedContributions(f.cwd);
  assert.equal(result.events.length,5);assert.deepEqual(result.events[1].event,corrected);
  assert.equal(result.limitations.filter(text=>text.startsWith('Incomplete')).length,1);
  assert.ok(result.limitations.some(text=>text.includes('2'.repeat(40))));
  assert.deepEqual(result.events[4].event,missing);
 }finally{f.cleanup();}
});

test('malformed trailers and invalid correction references refuse rather than hiding history',()=>{
 for(const invalid of ['not-json',{...legacy,corrects:{commit:'wrong',ordinal:0}},{...event(),role:'revise'}]){
  const f=fixture();try{f.commit([invalid]);assert.throws(()=>inspectCommittedContributions(f.cwd),{code:'RECOVERY_REQUIRED'});}finally{f.cleanup();}
 }
});

test('historical configuration resolves moved roots without reading current working files',()=>{
 const f=historical();try{
  const first=f.record(source,[action(source)]);
  f.git('mv','specs','moved');f.configure('moved');f.save([]);
  const second=f.record(first.text,[action(first.text)],'moved');
  f.configure('nonexistent-current-root');
  const result=inspectCommittedContributions(f.cwd);
  assert.deepEqual(result.events.map(item=>item.verification?.specPath),['specs/architecture/test.md','moved/architecture/test.md']);
  assert.deepEqual(result.events.map(item=>item.verification?.contextCommit),[first.commit,second.commit]);
  assert.ok(result.events.every(item=>item.verification?.summary==='matched'&&item.verification.revision.reviewedDigest==='matched'));
  assert.ok(fs.readFileSync(path.join(f.cwd,'.specplane/config.yaml'),'utf8').includes('nonexistent-current-root'));
 }finally{f.cleanup();}
});

test('exact lossless forward metadata proof binds edit endpoint bytes without normalizing YAML',()=>{
 for(const assist of [false,true]){
  const f=historical();try{
   let after=source.replace('Original body.','Changed body.');if(assist)after=setFinalizedAssistAuthor(after);
   const captured=action(source,after,true),recorded=f.record(after,[captured]);
   assert.notEqual(sha256(recorded.text),(captured.revision as {afterDigest:string}).afterDigest);
   const result=inspectCommittedContributions(f.cwd),verified=result.events[0].verification!;
   assert.equal(verified.summary,'matched');assert.equal(verified.revision.beforeDigest,'matched');assert.equal(verified.revision.afterDigest,'matched');
   assert.equal(verified.limitations.length,0);assert.ok(recorded.text.includes('# Retain this exact comment and whitespace.'));
  }finally{f.cleanup();}
 }
});

test('sequential intermediate digests remain unavailable while exact chain endpoints match',()=>{
 const f=historical();try{
  const middle=source.replace('Original body.','Intermediate body.'),after=source.replace('Original body.','Final body.');
  const one=action(source,middle),two=action(middle,after);f.record(after,[one,two]);
  const result=inspectCommittedContributions(f.cwd),first=result.events.find(item=>item.event.event_id===one.eventId)!.verification!,second=result.events.find(item=>item.event.event_id===two.eventId)!.verification!;
  assert.deepEqual(first.revision,{beforeDigest:'matched',afterDigest:'unavailable'});
  assert.deepEqual(second.revision,{beforeDigest:'unavailable',afterDigest:'matched'});
  assert.ok(first.limitations.some(text=>text.includes('intermediate action snapshots')));
 }finally{f.cleanup();}
});

test('changed final body cannot be presented as a matched historical action revision',()=>{
 const f=historical();try{
  const after=source.replace('Original body.','Reviewed changed body.'),captured=action(source,after),generated=prepareContributionMetadata(after,[captured]);
  f.put('specs/architecture/test.md',generated.text.replace('Reviewed changed body.','Different committed body.'));f.save(generated.trailers.map(value=>JSON.parse(value)));
  const verified=inspectCommittedContributions(f.cwd).events[0].verification!;
  assert.equal(verified.summary,'matched');assert.equal(verified.revision.beforeDigest,'matched');assert.equal(verified.revision.afterDigest,'unavailable');
  assert.ok(verified.limitations.some(text=>text.includes('final action revision is unavailable')));
 }finally{f.cleanup();}
});

test('a review digest from the parent cannot verify an unreviewed changed containing body',()=>{
 const f=historical();try{
  const captured=action(source),generated=prepareContributionMetadata(source,[captured]);
  f.put('specs/architecture/test.md',generated.text.replace('Original body.','Unreviewed committed body.'));f.save(generated.trailers.map(value=>JSON.parse(value)));
  const verified=inspectCommittedContributions(f.cwd).events[0].verification!;
  assert.equal(verified.summary,'matched');assert.equal(verified.revision.reviewedDigest,'unavailable');
  assert.ok(verified.limitations.some(text=>text.includes('reviewedDigest is unavailable')));
 }finally{f.cleanup();}
});

test('available historical contributor role or identity contradictions require reconciliation',()=>{
 for(const kind of ['role','model','id'] as const){
  const f=historical();try{
   const captured=action(source,undefined,true),generated=prepareContributionMetadata(source,[captured]);
   const text=kind==='role'?generated.text.replace('roles: [review]','roles: [revise]'):kind==='model'?generated.text.replace('model_id: A','model_id: B'):generated.text.replace('id: architecture/test','id: architecture/other');
   assert.notEqual(text,generated.text);f.put('specs/architecture/test.md',text);f.save(generated.trailers.map(value=>JSON.parse(value)));
   assert.throws(()=>inspectCommittedContributions(f.cwd),{code:'RECOVERY_REQUIRED'});
  }finally{f.cleanup();}
 }
});

test('carried events verify the original context and report unavailable origin objects explicitly',()=>{
 const f=historical();try{
  const recorded=f.record(source,[action(source)]),carried={...recorded.trailers[0],origin:{commit:recorded.commit,ordinal:0}};
  f.git('switch','--orphan','squashed');f.configure('final');f.put('final/architecture/test.md',recorded.text.replace('Original body.','Squashed final body.'));f.save([carried]);
  const result=inspectCommittedContributions(f.cwd),verified=result.events[0].verification!;
  assert.equal(verified.contextCommit,recorded.commit);assert.equal(verified.specPath,'specs/architecture/test.md');assert.equal(verified.revision.reviewedDigest,'matched');
  const other=fixture();try{
   fs.mkdirSync(path.join(other.cwd,'.specplane'));fs.writeFileSync(path.join(other.cwd,'.specplane/config.yaml'),'spec_roots:\n  - name: base\n    path: specs\n');
   fs.mkdirSync(path.join(other.cwd,'specs/architecture'),{recursive:true});fs.writeFileSync(path.join(other.cwd,'specs/architecture/test.md'),recorded.text);
   other.git('add','.');other.commit([carried]);
   const missing=inspectCommittedContributions(other.cwd).events[0].verification!;
   assert.equal(missing.summary,'unavailable');assert.equal(missing.revision.reviewedDigest,'unavailable');assert.ok(missing.limitations.some(text=>text.includes('Original contribution context is unavailable')));
  }finally{other.cleanup();}
 }finally{f.cleanup();}
});

test('origin payload conflicts and disconnected revision chains refuse historical verification',()=>{
 const original=historical();try{
  const recorded=original.record(source,[action(source)]);
  original.save([{...recorded.trailers[0],event_id:randomUUID(),origin:{commit:recorded.commit,ordinal:0}}]);
  assert.throws(()=>inspectCommittedContributions(original.cwd),{code:'RECOVERY_REQUIRED'});
 }finally{original.cleanup();}
 for(const branch of [false,true]){
  const f=historical();try{
   const middle=source.replace('Original body.','Middle.'),after=source.replace('Original body.','Final.');
   const one=action(source,middle),two=action(branch?source:source.replace('Original body.','Unrelated.'),after);
   f.record(after,[one,two]);assert.throws(()=>inspectCommittedContributions(f.cwd),{code:'RECOVERY_REQUIRED'});
  }finally{f.cleanup();}
 }
});

test('carried corrections resolve an unreachable intermediate rewrite through actual origin trailers',()=>{
 const f=historical();try{
  const first=f.record(source,[action(source)]),rewrite=f.save([{...first.trailers[0],origin:{commit:first.commit,ordinal:0}}]);
  const correctedAction=action(first.text),generated=prepareContributionMetadata(first.text,[correctedAction]);
  const correction={...JSON.parse(generated.trailers[0]),corrects:{commit:rewrite,ordinal:0}};
  f.put('specs/architecture/test.md',generated.text);const corrected=f.save([correction]);
  f.git('switch','--orphan','rewritten-history');f.configure();f.put('specs/architecture/test.md',generated.text);
  f.save([{...first.trailers[0],origin:{commit:first.commit,ordinal:0}},{...correction,corrects:{commit:first.commit,ordinal:0},origin:{commit:corrected,ordinal:0}}]);
  const result=inspectCommittedContributions(f.cwd),item=result.events.find(entry=>entry.event.event_id===correctedAction.eventId)!;
  assert.equal(item.verification?.contextCommit,corrected);assert.equal(item.verification?.summary,'matched');
  assert.deepEqual(item.event.corrects,{commit:first.commit,ordinal:0});
  assert.equal(result.limitations.some(text=>text.includes('Original contribution context is unavailable')),false);
 }finally{f.cleanup();}
});


test('collapsed retry cannot hide a conflicting origin payload',()=>{
 const f=historical();try{
  const first=f.record(source,[action(source)]),other=f.record(first.text,[action(first.text)]);
  f.save([{...first.trailers[0],origin:{commit:other.commit,ordinal:0}}]);
  assert.throws(()=>inspectCommittedContributions(f.cwd),{code:'RECOVERY_REQUIRED'});
 }finally{f.cleanup();}
});

test('cyclic contribution revision chains refuse even when the parent is a cycle endpoint',()=>{
 const f=historical();try{
  const middle=source.replace('Original body.','Intermediate body.');
  f.record(source,[action(source,middle),action(middle,source)]);
  assert.throws(()=>inspectCommittedContributions(f.cwd),{code:'RECOVERY_REQUIRED'});
 }finally{f.cleanup();}
});

test('creation binds an observed absent parent and exact lossless pre-metadata endpoint',()=>{
 for(const author of ['llm','mixed']){
  const f=historical();try{
   f.git('rm','specs/architecture/test.md');f.save([]);
   const created=source.replace('author: user',`author: ${author}`),captured:ContributionEvent={
    ...action(created,created+'unused'),role:'create',action:{kind:'create',evidencePath:'private/create.md',evidenceDigest:sha256('creation evidence')},
    revision:{beforeDigest:'missing',afterDigest:sha256(created)},
   };
   f.record(created,[captured]);
   const verified=inspectCommittedContributions(f.cwd).events[0].verification!;
   assert.equal(verified.summary,'matched');assert.deepEqual(verified.revision,{beforeDigest:'matched',afterDigest:'matched'});
   assert.deepEqual(verified.limitations,[]);
  }finally{f.cleanup();}
 }
});

test('creation cannot infer an absent preimage from unavailable historical root configuration',()=>{
 const f=historical();try{
  f.configure('unused');f.put('.specplane/config.yaml','spec_roots:\n  - name: other\n    path: unused\n');f.save([]);
  f.configure();
  const created=source.replace('author: user','author: llm'),captured:ContributionEvent={
   ...action(created,created+'unused'),role:'create',action:{kind:'create',evidencePath:'private/create.md',evidenceDigest:sha256('creation evidence')},
   revision:{beforeDigest:'missing',afterDigest:sha256(created)},
  };
  f.record(created,[captured]);
  const verified=inspectCommittedContributions(f.cwd).events[0].verification!;
  assert.equal(verified.revision.beforeDigest,'unavailable');
  assert.ok(verified.limitations.some(text=>text.includes('exact historical action binding')));
 }finally{f.cleanup();}
});
