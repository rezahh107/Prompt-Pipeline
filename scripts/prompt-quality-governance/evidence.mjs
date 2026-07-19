import crypto from 'node:crypto';
import {existsSync} from 'node:fs';
import {ES,REPO,PID,cp,eq,hash,d,schema,fp,txt,sh} from './core.mjs';

const VERIFIED_INDEX=Symbol('verified-evidence-index');
const rawDigest=x=>hash(x).slice('sha256:'.length);
const RECONCILIATION_SCOPE_ID='prompt-quality-scope.program-activation-post-merge-reconciliation.v1';
const RECONCILIATION_SCOPE_PATH='planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION-POST-MERGE-RECONCILIATION.scope.json';
const OWNER_PAYLOAD_URL='https://api.github.com/repos/rezahh107/Prompt-Pipeline/pulls/29';
export const EVIDENCE_POLICY=Object.freeze({
  repository:Object.freeze({id:1280529737,full_name:REPO}),
  workflow:Object.freeze({id:302284939,name:'CI',path:'.github/workflows/ci.yml',event:'pull_request'}),
  job:Object.freeze({name:'PEaC canonical exact-head CI'}),
  artifact:Object.freeze({name:'exact-head-ci-identity'}),
  owner:Object.freeze({login:'rezahh107',id:84147076,type:'User'}),
  default_branch:'main'
});
export function receiptHash(r){const x=cp(r);delete x.receipt_hash;return hash(x)}
export const byteSha256=value=>crypto.createHash('sha256').update(value).digest('hex');

async function apiGet(apiPath){
  const headers={'accept':'application/vnd.github+json','user-agent':'Prompt-Pipeline-governance-validator'};
  if(process.env.GH_TOKEN)headers.authorization=`Bearer ${process.env.GH_TOKEN}`;
  const response=await fetch(`https://api.github.com${apiPath}`,{headers});
  if(!response.ok)throw new Error(`GitHub API ${response.status} for ${apiPath}`);
  return response.json();
}

const inWindow=(value,start,end)=>{const v=Date.parse(value),a=Date.parse(start),b=Date.parse(end);return![v,a,b].some(Number.isNaN)&&a<=v&&v<=b};
const legacyOwnerProjection=pr=>({repository_id:pr.base?.repo?.id,repository:pr.base?.repo?.full_name,pull_request:pr.number,merged:pr.merged===true,merge_commit_sha:pr.merge_commit_sha,base_sha:pr.base?.sha,base_ref:pr.base?.ref,pr_head_sha:pr.head?.sha,head_repository:pr.head?.repo?.full_name,merged_by:{login:pr.merged_by?.login,id:pr.merged_by?.id,type:pr.merged_by?.type}});
export const ownerProjection=pr=>({repository_id:pr.base?.repo?.id,repository_full_name:pr.base?.repo?.full_name,pull_request_number:pr.number,merged:pr.merged===true,merged_at:pr.merged_at,base_ref:pr.base?.ref,base_sha:pr.base?.sha,head_ref:pr.head?.ref,head_sha:pr.head?.sha,head_repository:pr.head?.repo?.full_name,merge_commit_sha:pr.merge_commit_sha,merged_by:{login:pr.merged_by?.login,id:pr.merged_by?.id,type:pr.merged_by?.type}});
const contentJson=payload=>{if(payload?.encoding!=='base64'||typeof payload.content!=='string')throw new Error('GitHub content payload is not base64');return JSON.parse(Buffer.from(payload.content.replace(/\n/g,''),'base64').toString('utf8'))};
const receiptFilesFor=(context,taskId)=>(context.receipts||[]).filter(x=>x.value?.task_id===taskId).map(x=>x.file).sort();
const ledgerFor=(context,taskId)=>(context.ledgers||[]).find(x=>x.value?.task_id===taskId)||null;
const scopeFor=(context,taskId,scopeRevision)=>(context.scopes||[]).find(x=>x.value?.task_id===taskId&&x.value?.scope_revision===scopeRevision)||null;

function payloadIdentityErrors(pr){
  const errors=[],policy=EVIDENCE_POLICY,mergedBy=pr?.merged_by;
  if(pr?.url!==OWNER_PAYLOAD_URL)errors.push('url');
  if(pr?.number!==29)errors.push('number');
  if(pr?.state!=='closed')errors.push('state');
  if(pr?.merged!==true)errors.push('merged');
  if(pr?.merged_at!=='2026-07-18T21:12:18Z')errors.push('merged_at');
  if(pr?.merge_commit_sha!=='e3f98e007bba01ba02310b01377f617c94ca8b09')errors.push('merge_commit_sha');
  if(pr?.head?.ref!=='agent/activate-prompt-quality-program')errors.push('head.ref');
  if(pr?.head?.sha!=='c028f7009909fa57ef55ff0a922477f0c32ef484')errors.push('head.sha');
  if(pr?.head?.repo?.id!==policy.repository.id)errors.push('head.repo.id');
  if(pr?.head?.repo?.full_name!==policy.repository.full_name)errors.push('head.repo.full_name');
  if(pr?.base?.ref!==policy.default_branch)errors.push('base.ref');
  if(pr?.base?.sha!=='25bd3af631c17fbfda76a3cabcaa612dfdc11143')errors.push('base.sha');
  if(pr?.base?.repo?.id!==policy.repository.id)errors.push('base.repo.id');
  if(pr?.base?.repo?.full_name!==policy.repository.full_name)errors.push('base.repo.full_name');
  if(!Object.prototype.hasOwnProperty.call(pr||{},'merged_by')||!mergedBy)errors.push('merged_by');
  if(mergedBy?.login!==policy.owner.login)errors.push('merged_by.login');
  if(mergedBy?.id!==policy.owner.id)errors.push('merged_by.id');
  if(mergedBy?.type!==policy.owner.type)errors.push('merged_by.type');
  if(mergedBy&&(mergedBy===pr.user||mergedBy===pr.head?.user||mergedBy===pr.base?.user||mergedBy===pr.head?.repo?.owner||mergedBy===pr.base?.repo?.owner))errors.push('merged_by.distinct_path');
  return errors;
}

export function validateOwnerPayloadBytes(raw){
  const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(String(raw),'utf8'),payload_sha256=byteSha256(bytes);
  try{
    const payload=JSON.parse(bytes.toString('utf8')),errors=payloadIdentityErrors(payload),projection=ownerProjection(payload);
    return{ok:errors.length===0,payload_sha256,projection,projection_digest:rawDigest(projection),errors,payload};
  }catch(error){return{ok:false,payload_sha256,projection:null,projection_digest:null,errors:[`invalid_json:${error?.message||error}`],payload:null}}
}

function isReconciliationScope(item){const s=item?.value;return item?.file===RECONCILIATION_SCOPE_PATH&&s?.scope_id===RECONCILIATION_SCOPE_ID&&s?.task_id==='PROMPT-QUALITY-PROGRAM-ACTIVATION'&&s?.change_class==='maintenance'&&s?.risk_tier==='high'&&s?.scope_mode==='exact_files'&&s?.base_branch==='main'&&Array.isArray(s?.committed_paths)&&!(s?.allowed_generated_paths||[]).length}
const forbiddenCarrierPath=file=>/^(domains|policies|templates|pipeline)\//.test(file)||/(^|\/)PPQR-[0-9]{3}([^0-9]|$)/.test(file)||file.startsWith('.github/workflows/');
export function validateReconciliationComparison(scope,comparison,expectedBase){
  const errors=[],files=comparison?.files||[],declared=[...(scope?.committed_paths||[])].sort(),actual=files.map(x=>x.filename).sort();
  if(!['ahead','identical'].includes(comparison?.status))errors.push('status');
  if((comparison?.behind_by??0)!==0)errors.push('behind');
  if(comparison?.merge_base_commit?.sha!==expectedBase)errors.push('merge_base');
  if(comparison?.status==='ahead'&&files.length===0)errors.push('empty_ahead');
  if(files.some(x=>['removed','renamed'].includes(x.status)))errors.push('deleted_or_renamed');
  if(files.some(x=>forbiddenCarrierPath(x.filename)))errors.push('forbidden_path');
  if(!eq(actual,declared))errors.push('path_set');
  return{ok:errors.length===0,errors,changed_paths:actual};
}

function authorizationOrderValid(scopeItem,currentHead){
  if(!isReconciliationScope(scopeItem)||!currentHead)return false;
  const scope=scopeItem.value,commits=sh(['rev-list','--reverse',`${scope.base_sha}..${currentHead}`]).split('\n').filter(Boolean);
  if(!commits.length)return false;
  const firstTouch=file=>commits.findIndex(commit=>sh(['diff-tree','--no-commit-id','--name-status','-r','--no-renames',commit,'--',file]).split('\n').filter(Boolean).length>0);
  const scopeIndex=firstTouch(scopeItem.file);
  if(scopeIndex<0)return false;
  for(const file of scope.committed_paths||[]){if(file===scopeItem.file)continue;const index=firstTouch(file);if(index<0||index<=scopeIndex)return false}
  return true;
}

export function carrierLedgerValid(base,current,receipts){
  const before=base?.events||[],after=current?.events||[];
  if(after.length!==before.length+3||!eq(after.slice(0,before.length),before))return false;
  const appended=after.slice(before.length),order=['exact_head_validated','owner_merge','exact_main_verified'];
  if(!appended.every((event,index)=>event.event_type===order[index]))return false;
  for(const event of appended){
    const receipt=(receipts||[]).find(item=>item.value?.task_id===current.task_id&&item.value?.event_type===event.event_type)?.value;
    if(!receipt||event.head_sha!==receipt.subject_sha||event.pull_request!==receipt.pull_request||event.scope_revision!==receipt.scope_revision||event.evidence?.length!==1||event.evidence[0]?.sha256!==receipt.evidence_digest)return false;
  }
  const stable=value=>{const out=cp(value);for(const key of ['events','ledger_hash','pull_request','next_required_event','branch_kind','completion_claim','scope_revision'])delete out[key];return out};
  return eq(stable(base),stable(current))&&current.pull_request===29&&current.branch_kind==='default'&&current.completion_claim===true&&current.next_required_event===null;
}

async function verifyReconciliationCarrier(r,context,source){
  const currentHead=context.currentHead,scopeItem=scopeFor(context,r.task_id,r.scope_revision),ledger=ledgerFor(context,r.task_id);
  if(!currentHead||!scopeItem||!ledger||!isReconciliationScope(scopeItem)||!existsSync(fp(source)))return{ok:false};
  const prefix=`/repos/${r.repository}`,comparison=await apiGet(`${prefix}/compare/${r.subject_sha}...${currentHead}`),topology=validateReconciliationComparison(scopeItem.value,comparison,r.subject_sha);
  if(!topology.ok||!authorizationOrderValid(scopeItem,currentHead))return{ok:false};
  const receiptFiles=receiptFilesFor(context,r.task_id),expectedReceipts=['exact_head_validated','owner_merge','exact_main_verified'];
  if(receiptFiles.length!==3||!receiptFiles.includes(source)||!expectedReceipts.every(type=>(context.receipts||[]).some(x=>x.value?.task_id===r.task_id&&x.value?.event_type===type)))return{ok:false};
  const basePayload=await apiGet(`${prefix}/contents/${ledger.file}?ref=${encodeURIComponent(scopeItem.value.base_sha)}`),baseLedger=contentJson(basePayload);
  if(!carrierLedgerValid(baseLedger,ledger.value,context.receipts))return{ok:false};
  return{ok:true,facts:{validated_sha:r.subject_sha,current_head:currentHead,carrier_mode:'scope_authorized_reconciliation_descendant',carrier_scope_revision:r.scope_revision,changed_paths:topology.changed_paths}};
}

async function verifyCurrentHeadBinding(r,context,source){
  const currentHead=context.currentHead;
  if(!currentHead)return{ok:false};
  if(r.subject_sha===currentHead)return{ok:true,facts:{validated_sha:r.subject_sha,current_head:currentHead,carrier_mode:'exact',changed_paths:[]}};
  const scopeItem=scopeFor(context,r.task_id,r.scope_revision);
  if(isReconciliationScope(scopeItem))return verifyReconciliationCarrier(r,context,source);
  const ledger=ledgerFor(context,r.task_id),receiptFiles=receiptFilesFor(context,r.task_id);
  if(!ledger||!receiptFiles.includes(source))return{ok:false};
  const prefix=`/repos/${r.repository}`,comparison=await apiGet(`${prefix}/compare/${r.subject_sha}...${currentHead}`),files=comparison.files||[],allowed=new Set([ledger.file,...receiptFiles]),ledgerChange=files.find(x=>x.filename===ledger.file),receiptChange=files.find(x=>x.filename===source);
  const topologyOk=comparison.status==='ahead'&&comparison.behind_by===0&&comparison.merge_base_commit?.sha===r.subject_sha&&files.length>0&&files.every(x=>allowed.has(x.filename)&&!['removed','renamed'].includes(x.status))&&ledgerChange?.status==='modified'&&receiptChange?.status==='added'&&receiptFiles.every(file=>files.some(x=>x.filename===file&&x.status==='added'));
  if(!topologyOk)return{ok:false};
  const basePayload=await apiGet(`${prefix}/contents/${ledger.file}?ref=${encodeURIComponent(r.subject_sha)}`),baseLedger=contentJson(basePayload);
  if(!carrierLedgerValid(baseLedger,ledger.value,context.receipts))return{ok:false};
  return{ok:true,facts:{validated_sha:r.subject_sha,current_head:currentHead,carrier_mode:'evidence_only_descendant',changed_paths:files.map(x=>x.filename).sort()}};
}

function lifecycleMergeCommit(context,r){
  const ledger=ledgerFor(context,r.task_id),events=ledger?.value?.events||[],index=events.findIndex(e=>e.event_type==='exact_main_verified'&&e.head_sha===r.subject_sha&&e.evidence?.[0]?.sha256===r.evidence_digest),owner=index>0?events[index-1]:null;
  return owner?.event_type==='owner_merge'?owner.head_sha:null;
}

export function stableMainProjection(subject,mergeCommit,comparison){
  const contains=mergeCommit===subject||comparison?.status==='ahead'&&comparison?.behind_by===0&&comparison?.merge_base_commit?.sha===mergeCommit;
  return{branch:'main',verified_subject_sha:subject,owner_merge_commit_sha:mergeCommit,subject_contains_owner_merge:contains,subject_compare_status:mergeCommit===subject?'identical':comparison?.status,subject_merge_base_sha:mergeCommit===subject?mergeCommit:comparison?.merge_base_commit?.sha,evidence_source_identity:'github_default_branch_ref_and_compare.v1'};
}

async function verifyExternalSource(r,context,source){
  const prefix=`/repos/${r.repository}`,policy=EVIDENCE_POLICY;
  if(r.event_type==='exact_head_validated'){
    if(r.source.kind!=='github_actions_artifact')return{ok:false};
    const run=await apiGet(`${prefix}/actions/runs/${r.source.run_id}`),jobs=await apiGet(`${prefix}/actions/runs/${r.source.run_id}/jobs?per_page=100`),artifact=await apiGet(`${prefix}/actions/artifacts/${r.source.artifact_id}`),job=(jobs.jobs||[]).find(x=>x.id===r.source.job_id),prBound=(run.pull_requests||[]).some(x=>x.number===r.pull_request&&x.head?.sha===r.subject_sha&&x.base?.sha===r.base_sha);
    const producerOk=run.id===r.source.run_id&&run.workflow_id===policy.workflow.id&&run.name===policy.workflow.name&&run.path===policy.workflow.path&&run.event===policy.workflow.event&&Number.isInteger(run.run_attempt)&&run.run_attempt>=1&&run.head_sha===r.subject_sha&&run.status==='completed'&&run.conclusion==='success'&&run.repository?.id===policy.repository.id&&run.repository?.full_name===policy.repository.full_name&&run.head_repository?.id===policy.repository.id&&run.head_repository?.full_name===policy.repository.full_name&&prBound&&job?.id===r.source.job_id&&job.run_id===run.id&&job.run_attempt===run.run_attempt&&job.name===policy.job.name&&job.workflow_name===policy.workflow.name&&job.head_sha===r.subject_sha&&job.status==='completed'&&job.conclusion==='success'&&artifact.id===r.source.artifact_id&&artifact.name===policy.artifact.name&&artifact.expired===false&&artifact.workflow_run?.id===run.id&&artifact.workflow_run?.repository_id===policy.repository.id&&artifact.workflow_run?.head_repository_id===policy.repository.id&&artifact.workflow_run?.head_sha===r.subject_sha&&artifact.digest===`sha256:${r.evidence_digest}`&&inWindow(artifact.created_at,job.started_at,job.completed_at);
    if(!producerOk)return{ok:false};
    const binding=await verifyCurrentHeadBinding(r,context,source);
    return{ok:binding.ok,facts:binding.ok?{workflow_id:run.workflow_id,workflow_path:run.path,run_id:run.id,run_attempt:run.run_attempt,job_id:job.id,job_name:job.name,artifact_id:artifact.id,artifact_name:artifact.name,...binding.facts}:null};
  }
  if(r.event_type==='owner_merge'){
    const live=await apiGet(`${prefix}/pulls/${r.pull_request}`),owner=policy.owner;
    if(r.source.kind==='github_pull_request_merge_payload'){
      if(!existsSync(fp(r.source.payload_path)))return{ok:false};
      const raw=Buffer.from(txt(r.source.payload_path),'utf8'),validated=validateOwnerPayloadBytes(raw),liveProjection=ownerProjection(live),projection=validated.projection;
      const ok=validated.ok&&validated.payload_sha256===r.source.payload_sha256&&eq(projection,liveProjection)&&projection.repository_id===policy.repository.id&&projection.repository_full_name===policy.repository.full_name&&projection.pull_request_number===r.pull_request&&projection.merged&&projection.merge_commit_sha===r.subject_sha&&projection.base_sha===r.base_sha&&projection.base_ref===policy.default_branch&&projection.head_repository===policy.repository.full_name&&projection.merged_by.login===owner.login&&projection.merged_by.id===owner.id&&projection.merged_by.type===owner.type&&validated.projection_digest===r.evidence_digest;
      return{ok,facts:ok?{pr_head_sha:projection.head_sha,merge_commit_sha:projection.merge_commit_sha,base_ref:projection.base_ref,merged_at:projection.merged_at,merged_by:projection.merged_by,raw_payload_sha256:validated.payload_sha256}:null};
    }
    if(r.source.kind!=='github_pull_request_merge')return{ok:false};
    const projection=legacyOwnerProjection(live),ok=projection.repository_id===policy.repository.id&&projection.repository===policy.repository.full_name&&projection.pull_request===r.pull_request&&projection.merged&&projection.merge_commit_sha===r.subject_sha&&projection.base_sha===r.base_sha&&projection.base_ref===policy.default_branch&&projection.head_repository===policy.repository.full_name&&projection.merged_by.login===owner.login&&projection.merged_by.id===owner.id&&projection.merged_by.type===owner.type&&rawDigest(projection)===r.evidence_digest;
    return{ok,facts:ok?{pr_head_sha:projection.pr_head_sha,merge_commit_sha:projection.merge_commit_sha,base_ref:projection.base_ref,merged_by:projection.merged_by}:null};
  }
  if(r.event_type==='exact_main_verified'){
    const mergeCommit=lifecycleMergeCommit(context,r);if(!mergeCommit)return{ok:false};
    if(r.source.kind==='github_default_branch_head'){
      if(r.source.branch!==policy.default_branch)return{ok:false};
      const ref=await apiGet(`${prefix}/git/ref/heads/${policy.default_branch}`),mainHead=ref.object?.sha;if(mainHead!==r.subject_sha)return{ok:false};
      let compareStatus='identical',mergeBaseSha=mergeCommit,contains=mergeCommit===mainHead;if(!contains){const comparison=await apiGet(`${prefix}/compare/${mergeCommit}...${mainHead}`);compareStatus=comparison.status;mergeBaseSha=comparison.merge_base_commit?.sha;contains=comparison.status==='ahead'&&comparison.behind_by===0&&comparison.merge_base_commit?.sha===mergeCommit}
      const projection={branch:policy.default_branch,head_sha:mainHead,owner_merge_commit_sha:mergeCommit,contains_owner_merge:contains,compare_status:compareStatus,merge_base_sha:mergeBaseSha},ok=contains&&rawDigest(projection)===r.evidence_digest;
      return{ok,facts:ok?projection:null};
    }
    if(r.source.kind!=='github_default_branch_ancestry'||r.source.branch!==policy.default_branch||r.source.evidence_source_identity!=='github_default_branch_ref_and_compare.v1')return{ok:false};
    let ownerComparison=null;if(mergeCommit!==r.subject_sha)ownerComparison=await apiGet(`${prefix}/compare/${mergeCommit}...${r.subject_sha}`);
    const stable=stableMainProjection(r.subject_sha,mergeCommit,ownerComparison),subjectContains=stable.subject_contains_owner_merge===true;
    const ref=await apiGet(`${prefix}/git/ref/heads/${policy.default_branch}`),mainHead=ref.object?.sha;let currentComparison=null,currentContains=mainHead===r.subject_sha;if(!currentContains){currentComparison=await apiGet(`${prefix}/compare/${r.subject_sha}...${mainHead}`);currentContains=currentComparison.status==='ahead'&&currentComparison.behind_by===0&&currentComparison.merge_base_commit?.sha===r.subject_sha}
    if(!subjectContains||!currentContains||rawDigest(stable)!==r.evidence_digest)return{ok:false};
    let carrier={ok:true,facts:{}};if(context.currentScopeRevision===r.scope_revision)carrier=await verifyReconciliationCarrier(r,context,source);if(!carrier.ok)return{ok:false};
    return{ok:true,facts:{...stable,current_main_head:mainHead,current_main_contains_verified_subject:true,current_main_contains_owner_merge:true,current_main_compare_status:mainHead===r.subject_sha?'identical':currentComparison.status,...carrier.facts}};
  }
  return{ok:false};
}

export async function buildVerifiedEvidenceIndex(items,context={}){
  const z=[],verified=[],keys=new Set(),fullContext={...context,receipts:items};
  for(const item of items){
    const r=item.value,source=item.file;z.push(...await schema(ES,r,source));
    if(r.receipt_hash!==receiptHash(r))z.push(d('PQG_SCHEMA_INVALID','receipt hash mismatch',source));
    if(r.repository!==REPO||r.program_id!==PID)z.push(d('PQG_SCHEMA_INVALID','receipt identity mismatch',source));
    const key=[r.task_id,r.event_type,r.pull_request,r.base_sha,r.subject_sha,r.scope_revision,r.evidence_digest].join(':');if(keys.has(key))z.push(d('PQG_SCHEMA_INVALID','duplicate receipt binding',source));keys.add(key);
    if(z.some(x=>x.source===source))continue;
    try{const result=await verifyExternalSource(r,fullContext,source);if(result.ok)verified.push({receipt:r,facts:result.facts||{}});else z.push(d(r.event_type==='exact_head_validated'?'PQG_EXACT_HEAD_EVIDENCE_MISSING':r.event_type==='owner_merge'?'PQG_OWNER_MERGE_EVIDENCE_MISSING':'PQG_EXACT_MAIN_EVIDENCE_MISSING','external source or repository-state binding does not match immutable evidence policy',source))}catch(error){z.push(d('PQG_GIT_EVIDENCE_UNAVAILABLE',error?.message||String(error),source))}
  }
  return{index:{[VERIFIED_INDEX]:true,receipts:verified},diagnostics:z};
}

export function receiptFor(index,ledger,event){
  if(!index?.[VERIFIED_INDEX])return null;const evidence=event.evidence?.[0];
  return index.receipts.find(entry=>{const r=entry.receipt||entry;return r.task_id===ledger.task_id&&r.event_type===event.event_type&&r.pull_request===ledger.pull_request&&r.base_sha===ledger.base_sha&&r.subject_sha===event.head_sha&&r.scope_revision===event.scope_revision&&r.evidence_digest===evidence?.sha256})||null;
}
export const evidenceProjectionDigest=rawDigest;
export function fixtureEvidenceIndex(receipts){if(process.env.PQG_FIXTURE_CONTEXT!=='1')throw new Error('synthetic evidence index is fixture-only');return{[VERIFIED_INDEX]:true,receipts:cp(receipts).map(x=>x.receipt?x:{receipt:x,facts:x.facts||{}})}};
