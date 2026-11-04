import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireWriterLease, checkoutIdentity, recoverHostLease, verifyCompletedHostLease, inspectHostLeaseRecovery, type HostLeaseBinding } from './writer-leases.js';

function fixture() {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'host-recovery-')));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
 git('init');git('-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','initial');
 const runtime=path.join(checkoutIdentity(root).commonDir,'specplane-runtime');
 return {root,runtime,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function abandoned(root:string,evidence=true):HostLeaseBinding {
 const script=`import { acquireWriterLease } from ${JSON.stringify(new URL('./writer-leases.js',import.meta.url).href)};
 const lease=acquireWriterLease({checkouts:[process.argv[1]],repository:true,plans:['plan'],requestId:'abandoned'});
 lease.retainHostWorker();if(process.argv[2]==='true')lease.bindRecoveryEvidence('a'.repeat(64));
 process.stdout.write(JSON.stringify(lease.recoveryBinding()));`;
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script,root,String(evidence)],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:''}}));
}
function snapshot(dir:string) {
 return fs.readdirSync(dir).sort().map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]);
}
const refusal={code:'RECOVERY_REQUIRED'};

test('dead host owner can be adopted only through inspection while retained protections remain',()=>{
 const f=fixture();try{
  const binding=abandoned(f.root);fs.writeFileSync(path.join(f.root,'partial'),'preserve');
  assert.throws(()=>acquireWriterLease({checkouts:[f.root],requestId:'ordinary'}),refusal);
  let inspections=0;
  const recovered=recoverHostLease(binding,()=>{inspections++;assert.equal(fs.readFileSync(path.join(f.root,'partial'),'utf8'),'preserve');});
  assert.equal(inspections,1);assert.equal(recovered.reclaimed,true);recovered.assertOwned();
  assert.deepEqual(recovered.recoveryBinding(),binding);
  assert.throws(()=>recovered.release(),/Host worker stop is unproved/);
  assert.throws(()=>recovered.delegate({checkout:f.root,step:1,pid:process.pid}),{code:'LOCKED'});
  assert.throws(()=>acquireWriterLease({checkouts:[f.root],requestId:'racer'}),{code:'LOCKED'});
  recovered.releaseStoppedHost();verifyCompletedHostLease(binding);assert.equal(fs.readdirSync(f.runtime).length,1);
  const next=acquireWriterLease({checkouts:[f.root],requestId:'next'});next.release();
  assert.equal(fs.readFileSync(path.join(f.root,'partial'),'utf8'),'preserve');
 }finally{f.cleanup();}
});

test('live owner and unretained leases cannot supply a recoverable host binding',()=>{
 const f=fixture();try{
  const lease=acquireWriterLease({checkouts:[f.root],requestId:'live'});
  assert.throws(()=>lease.recoveryBinding(),refusal);assert.throws(()=>lease.bindRecoveryEvidence('a'.repeat(64)),refusal);
  lease.retainHostWorker();const binding=lease.recoveryBinding(),before=snapshot(f.runtime);
  assert.throws(()=>recoverHostLease(binding,()=>assert.fail('live owner must refuse before inspection')),refusal);
  assert.deepEqual(snapshot(f.runtime),before);lease.releaseStoppedHost();
 }finally{f.cleanup();}
});

test('host evidence digest binds once and binding copies cannot change the owner',()=>{
 const f=fixture();try{
  const lease=acquireWriterLease({checkouts:[f.root],requestId:'binding'});lease.retainHostWorker();
  assert.throws(()=>lease.bindRecoveryEvidence('invalid'),refusal);
  lease.bindRecoveryEvidence('a'.repeat(64));const before=snapshot(f.runtime);
  lease.bindRecoveryEvidence('a'.repeat(64));assert.deepEqual(snapshot(f.runtime),before);
  assert.throws(()=>lease.bindRecoveryEvidence('b'.repeat(64)),refusal);
  const copy=lease.recoveryBinding();copy.token='changed';copy.evidenceDigest='b'.repeat(64);
  (copy.keys as unknown as {identity:string}[])[0].identity='changed';
  assert.equal(lease.recoveryBinding().evidenceDigest,'a'.repeat(64));lease.assertOwned();lease.releaseStoppedHost();
 }finally{f.cleanup();}
});

test('mismatched identity evidence and incomplete lease sets refuse without adopting records',()=>{
 const f=fixture();try{
  const binding=abandoned(f.root),before=snapshot(f.runtime);
  const variants=[{...binding,token:'wrong'},{...binding,generation:'wrong'},{...binding,requestId:'wrong'},
   {...binding,evidenceDigest:'b'.repeat(64)},{...binding,evidenceDigest:undefined},
   {...binding,keys:binding.keys.slice(1)},{...binding,keys:[...binding.keys,binding.keys[0]]}];
  for(const bad of variants){
   assert.throws(()=>recoverHostLease(bad,()=>assert.fail('mismatch must refuse before inspection')),refusal);
   assert.deepEqual(snapshot(f.runtime),before);
  }
  const lease=recoverHostLease(binding,()=>{});lease.releaseStoppedHost();
 }finally{f.cleanup();}
});

test('inspection refusal preserves all retained records and allows an explicitly rechecked retry',()=>{
 const f=fixture();try{
  const binding=abandoned(f.root),before=snapshot(f.runtime);
  assert.throws(()=>recoverHostLease(binding,()=>{throw new Error('journal needs reconciliation');}),/journal needs reconciliation/);
  assert.deepEqual(snapshot(f.runtime),before);
  assert.throws(()=>acquireWriterLease({checkouts:[f.root],requestId:'racer'}),refusal);
  const lease=recoverHostLease(binding,()=>{});lease.releaseStoppedHost();
 }finally{f.cleanup();}
});

test('changed coordination during inspection refuses adoption and retains the host marker',()=>{
 const f=fixture();try{
  const binding=abandoned(f.root);
  const file=path.join(f.runtime,fs.readdirSync(f.runtime).find(name=>name.startsWith('checkout-'))!);
  assert.throws(()=>recoverHostLease(binding,()=>{
   const record=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify({...record,token:'changed'}));
  }),refusal);
  assert.equal(fs.readdirSync(f.runtime).filter(name=>name.startsWith('host-')).length,1);
  assert.throws(()=>acquireWriterLease({checkouts:[f.root],requestId:'racer'}),refusal);
 }finally{f.cleanup();}
});

test('hardlinked lease records refuse preflight and adoption without writing through the alias',()=>{
 const f=fixture();try{
  const binding=abandoned(f.root),file=path.join(f.runtime,fs.readdirSync(f.runtime).find(name=>name.startsWith('checkout-'))!);
  const alias=path.join(f.root,'lease-alias');fs.linkSync(file,alias);
  const before=fs.readFileSync(alias,'utf8');
  assert.throws(()=>inspectHostLeaseRecovery(binding),refusal);
  assert.throws(()=>recoverHostLease(binding,()=>assert.fail('hardlink must refuse before inspection')),refusal);
  assert.equal(fs.readFileSync(alias,'utf8'),before);assert.equal(fs.readFileSync(file,'utf8'),before);
  fs.unlinkSync(alias);const recovered=recoverHostLease(binding,()=>{});recovered.releaseStoppedHost();
 }finally{f.cleanup();}
});

test('legacy or tampered host markers and delegated state cannot be adopted as host work',()=>{
 for(const kind of ['legacy','tampered','delegated'] as const){
  const f=fixture();try{
   const binding=abandoned(f.root),marker=path.join(f.runtime,fs.readdirSync(f.runtime).find(name=>name.startsWith('host-'))!);
   if(kind==='legacy')fs.writeFileSync(marker,'');
   else if(kind==='tampered'){const record=JSON.parse(fs.readFileSync(marker,'utf8'));fs.writeFileSync(marker,JSON.stringify({...record,evidenceDigest:'b'.repeat(64)}));}
   else{
    const file=path.join(f.runtime,fs.readdirSync(f.runtime).find(name=>name.startsWith('checkout-'))!);
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    fs.writeFileSync(file,JSON.stringify({...record,worker:{pid:process.pid,token:'worker',checkout:binding.keys.find(k=>k.kind==='checkout')!.identity,step:1,keysDigest:'unknown',state:'active'}}));
   }
   const before=snapshot(f.runtime);
   assert.throws(()=>recoverHostLease(binding,()=>assert.fail('untrusted state must refuse before inspection')),refusal);
   assert.deepEqual(snapshot(f.runtime),before);
   assert.throws(()=>acquireWriterLease({checkouts:[f.root],requestId:'racer'}),refusal);
  }finally{f.cleanup();}
 }
});
