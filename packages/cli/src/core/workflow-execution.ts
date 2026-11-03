/** Core-owned execution evidence. No caller-authored receipt establishes execution. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lazyValidator } from '../lazy-validator.js';
import { run } from '../git/exec.js';
import { checkoutIdentity, LeaseRefused } from './writer-leases.js';
import { assertPrepared, canonical, sha256, withPreparedActivity } from './workflow-preparation.js';
import { parseTestReport } from './test-reporters.js';
import { testReceiptSchema, workflowTestRequestSchema } from './schemas.js';
import type { Artifact, CoreContext, Result, TestExecutionResult, TestReceipt, WorkflowTestRequest } from './contracts.js';
const validRequest=lazyValidator(workflowTestRequestSchema),validReceipt=lazyValidator(testReceiptSchema);
class EvidenceError extends Error { constructor(readonly code:string,message:string){super(message);} }
function fail(code:string,message:string):never {throw new EvidenceError(code,message);}
interface Entry { receipt:TestReceipt; artifact:Artifact; criterionIds:string[]; format:WorkflowTestRequest['reportFormat']; ledgerDigest:string }
const ledger=new Map<string,Map<string,Entry>>();
/** All tracked and nonignored untracked bytes/modes; .git evidence never affects this digest. */
export function workflowStateDigest(checkout:string):string {
  const names=run('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:checkout,binary:true}).toString().split('\0').filter(Boolean);
  const files=[...new Set(names)].sort().map(name=>{
    if(path.isAbsolute(name)||name.split('/').includes('..'))fail('INVALID_EVIDENCE','Uncontained checkout path');
    let current=checkout;
    const parts=name.split('/');
    for(const part of parts.slice(0,-1)){current=path.join(current,part);try{const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())fail('INVALID_EVIDENCE','Nonregular checkout ancestor');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [name,'missing'];throw e;}}
    const file=path.join(checkout,name);let st:fs.Stats;try{st=fs.lstatSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [name,'missing'];throw e;}
    if(st.isSymbolicLink())return [name,'link',sha256(fs.readlinkSync(file))];
    if(!st.isFile())fail('INVALID_EVIDENCE','Unsupported nonregular checkout entry');
    return [name,st.mode & 0o777,sha256(fs.readFileSync(file))];
  });
  return sha256(canonical({head:run('git',['rev-parse','HEAD'],{cwd:checkout}).trim(),files,index:sha256(run('git',['ls-files','--stage','-z'],{cwd:checkout,binary:true}))}));
}
function contained(root:string,relative:string,create=false):string {
  if(!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'))fail('INVALID_EVIDENCE','Invalid evidence path');
  let current=root;
  for(const part of relative.split('/').slice(0,-1)){
    current=path.join(current,part);
    if(create)try{fs.mkdirSync(current,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())fail('INVALID_EVIDENCE','Nonregular evidence directory');
  }
  return path.join(root,relative);
}
function read(root:string,relative:string):Buffer {
  const f=contained(root,relative);const fd=fs.openSync(f,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{if(!fs.fstatSync(fd).isFile())fail('INVALID_EVIDENCE','Nonregular evidence file');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function write(root:string,relative:string,bytes:Uint8Array|string):void {
  const f=contained(root,relative,true),fd=fs.openSync(f,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
const prefix=(id:string)=>`specplane-runtime/workflows/${id}`;
function errorResult(error:unknown):Result<never>{const code=error instanceof EvidenceError||error instanceof LeaseRefused?error.code:typeof (error as any)?.code==='string'?(error as any).code:'OPERATION_FAILED';return {protocol:1,ok:false,error:{code,message:error instanceof Error?error.message:String(error),retryable:code==='LOCKED',details:null},notices:[]};}
export async function executeWorkflowTest(input:WorkflowTestRequest,context:CoreContext):Promise<Result<TestExecutionResult>> {
  if(!validRequest(input))return errorResult(new EvidenceError('INVALID_EVIDENCE','Invalid executeWorkflowTest input'));
  const request=structuredClone(input);
  context={...context};
  try{return await withPreparedActivity(request.requestId,'execution',async()=>{
    const state=await assertPrepared(request.requestId,context),cwd=state.request.checkout;
    const port=state.context.execution;
    if(!port)fail('UNSUPPORTED_CAPABILITY','Prepared host execution port is unavailable.');
    for(const id of request.criterionIds){const c=state.request.criteria.find(c=>c.id===id);if(!c)fail('INVALID_EVIDENCE','Unknown criterion');if(c.testRequirements.some(r=>r.format!==request.reportFormat))fail('INVALID_EVIDENCE','Report format does not match prepared requirements');}
    if((!path.isAbsolute(request.executable)&&/[\\/]/.test(request.executable))||request.executable.includes('\0')||request.args.some(s=>s.includes('\0')))fail('INVALID_EVIDENCE','NUL in command');
    const executionId=randomUUID(),root=checkoutIdentity(cwd).commonDir,stateDigest=workflowStateDigest(cwd);
    const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined&&e[0]!=='NODE_TEST_CONTEXT'));
    const signals=[state.context.signal,context.signal].filter((s):s is AbortSignal=>!!s);const signal=signals.length?AbortSignal.any(signals):undefined;
    let output;
    try{output=await port!.execute({executable:request.executable,args:[...request.args],checkout:cwd,env,signal});}catch(error){if(signal?.aborted)fail('CANCELLED','Execution cancelled; host must acknowledge stopped workers before lease release.');throw error;}
    if(!path.isAbsolute(output.executable)||!((Number.isInteger(output.exitCode)&&output.signal===null)||(output.exitCode===null&&typeof output.signal==='string'&&output.signal.length>0))||!(output.stdout instanceof Uint8Array)||!(output.stderr instanceof Uint8Array))fail('INVALID_EVIDENCE','Invalid host execution result');
    const base=executionId;
    const evidencePath=(p:string)=>`${prefix(request.requestId)}/evidence/${p}`;
    const stdout={path:`${base}.stdout`,digest:sha256(Buffer.from(output.stdout))},stderr={path:`${base}.stderr`,digest:sha256(Buffer.from(output.stderr))};
    write(root,evidencePath(stdout.path),output.stdout);write(root,evidencePath(stderr.path),output.stderr);
    const assertions=parseTestReport(output.stdout,request.reportFormat).map(s=>({...s,parentExecutionId:null,evidence:{...stdout,format:request.reportFormat}}));
    const receipt:TestReceipt={protocol:1,requestId:request.requestId,executionId,stateDigest,executable:output.executable,args:request.args,checkout:cwd,exitCode:output.exitCode,signal:output.signal,stdout,stderr,assertions};
    if(!validReceipt(receipt))fail('INVALID_EVIDENCE','Host execution cannot form a valid receipt');
    const bytes=canonical(receipt),artifact={path:`${base}.json`,digest:sha256(bytes),kind:'test' as const};
    write(root,evidencePath(artifact.path),bytes);
    const record=canonical({receiptDigest:artifact.digest,artifact,criterionIds:request.criterionIds,format:request.reportFormat,requestId:request.requestId,executionId,stateDigest});
    write(root,`${prefix(request.requestId)}/${executionId}.ledger.json`,record);
    await assertPrepared(request.requestId,context);
    if(workflowStateDigest(cwd)!==stateDigest)fail('STALE_STATE','Checkout changed during execution; rerun checks.');
    const entries=ledger.get(request.requestId)??new Map<string,Entry>();ledger.set(request.requestId,entries);entries.set(executionId,{receipt,artifact,criterionIds:request.criterionIds,format:request.reportFormat,ledgerDigest:sha256(record)});
    return {protocol:1,ok:true,value:{artifact:structuredClone(artifact),executionId,exitCode:receipt.exitCode,signal:receipt.signal,assertions:structuredClone(assertions)},notices:assertions.length?[]:[{code:'UNCERTAIN_TEST_REPORT',message:'No supported complete report was parsed; output is diagnostic only.'}]} as Result<TestExecutionResult>;
  });}catch(error){return errorResult(error);}
}
/** Called under the validation/recording activity reservation; never accepts public totals. */
export async function validateExecutionArtifact(requestId:string,criterionId:string,artifact:Artifact,context:CoreContext,requirePassing=true):Promise<TestReceipt>{
  const state=await assertPrepared(requestId,context),criterion=state.request.criteria.find(c=>c.id===criterionId);
  if(!criterion||(requirePassing&&!criterion.testRequirements.length))fail('INVALID_EVIDENCE','No prepared test requirements for criterion');
  const entry=[...(ledger.get(requestId)?.values()??[])].find(e=>e.artifact.path===artifact.path);
  if(!entry||artifact.kind!=='test'||canonical(artifact)!==canonical(entry.artifact)||!entry.criterionIds.includes(criterionId))fail('INVALID_EVIDENCE','Receipt is not in this request execution ledger');
  const root=checkoutIdentity(state.request.checkout).commonDir,r=entry.receipt;
  const evidencePath=(p:string)=>`${prefix(requestId)}/evidence/${p}`;
  if(sha256(read(root,`${prefix(requestId)}/${r.executionId}.ledger.json`))!==entry.ledgerDigest)fail('INVALID_EVIDENCE','Execution ledger changed');
  if(sha256(read(root,evidencePath(artifact.path)))!==artifact.digest)fail('INVALID_EVIDENCE','Execution receipt changed');
  for(const output of [r.stdout,r.stderr])if(sha256(read(root,evidencePath(output.path)))!==output.digest)fail('INVALID_EVIDENCE','Execution output changed');
  if(r.stateDigest!==workflowStateDigest(state.request.checkout))fail('STALE_STATE','Tested checkout state changed');
  if(requirePassing&&(r.exitCode!==0||r.signal!==null||r.assertions.some(s=>s.failed>0)))fail('INVALID_EVIDENCE','Test execution did not exit successfully');
  const parsed=parseTestReport(read(root,evidencePath(r.stdout.path)),entry.format);
  const expected=parsed.map(s=>({...s,parentExecutionId:null,evidence:{...r.stdout,format:entry.format}}));
  if(canonical(expected)!==canonical(r.assertions))fail('INVALID_EVIDENCE','Reporter assertions changed');
  for(const requirement of requirePassing?criterion.testRequirements:[]){const suite=r.assertions.find(s=>s.suiteId===requirement.suiteId&&s.evidence.format===requirement.format);if(!suite||suite.executed===0||suite.failed!==0)fail('INVALID_EVIDENCE',`Missing, skipped or failed expected suite: ${requirement.suiteId}`);}
  return structuredClone(r);
}
