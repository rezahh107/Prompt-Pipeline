import {ES,REPO,PID,cp,hash,d,schema} from './core.mjs';

const VERIFIED_INDEX=Symbol('verified-evidence-index');
const rawDigest=x=>hash(x).slice('sha256:'.length);
export const EVIDENCE_POLICY=Object.freeze({
  repository:Object.freeze({id:1280529737,full_name:REPO}),
  workflow:Object.freeze({id:302284939,name:'CI',path:'.github/workflows/ci.yml',event:'pull_request'}),
  job:Object.freeze({name:'PEaC canonical exact-head CI'}),
  artifact:Object.freeze({name:'exact-head-ci-identity'}),
  owner:Object.freeze({login:'rezahh107',id:84147076,type:'User'})
});
export function receiptHash(r){const x=cp(r);delete x.receipt_hash;return hash(x)}

async function apiGet(apiPath){
  const headers={'accept':'application/vnd.github+json','user-agent':'Prompt-Pipeline-governance-validator'};
  if(process.env.GH_TOKEN)headers.authorization=`Bearer ${process.env.GH_TOKEN}`;
  const response=await fetch(`https://api.github.com${apiPath}`,{headers});
  if(!response.ok)throw new Error(`GitHub API ${response.status} for ${apiPath}`);
  return response.json();
}

const inWindow=(value,start,end)=>{const v=Date.parse(value),a=Date.parse(start),b=Date.parse(end);return![v,a,b].some(Number.isNaN)&&a<=v&&v<=b};
const ownerProjection=pr=>({repository_id:pr.base?.repo?.id,repository:pr.base?.repo?.full_name,pull_request:pr.number,merged:pr.merged===true,merge_commit_sha:pr.merge_commit_sha,base_sha:pr.base?.sha,pr_head_sha:pr.head?.sha,head_repository:pr.head?.repo?.full_name,merged_by:{login:pr.merged_by?.login,id:pr.merged_by?.id,type:pr.merged_by?.type}});

async function verifyExternalSource(r){
  const prefix=`/repos/${r.repository}`,policy=EVIDENCE_POLICY;
  if(r.event_type==='exact_head_validated'){
    if(r.source.kind!=='github_actions_artifact')return{ok:false};
    const run=await apiGet(`${prefix}/actions/runs/${r.source.run_id}`),jobs=await apiGet(`${prefix}/actions/runs/${r.source.run_id}/jobs?per_page=100`),artifact=await apiGet(`${prefix}/actions/artifacts/${r.source.artifact_id}`),job=(jobs.jobs||[]).find(x=>x.id===r.source.job_id),prBound=(run.pull_requests||[]).some(x=>x.number===r.pull_request&&x.head?.sha===r.subject_sha&&x.base?.sha===r.base_sha);
    const ok=run.id===r.source.run_id&&run.workflow_id===policy.workflow.id&&run.name===policy.workflow.name&&run.path===policy.workflow.path&&run.event===policy.workflow.event&&Number.isInteger(run.run_attempt)&&run.run_attempt>=1&&run.head_sha===r.subject_sha&&run.status==='completed'&&run.conclusion==='success'&&run.repository?.id===policy.repository.id&&run.repository?.full_name===policy.repository.full_name&&run.head_repository?.id===policy.repository.id&&run.head_repository?.full_name===policy.repository.full_name&&prBound&&job?.id===r.source.job_id&&job.run_id===run.id&&job.run_attempt===run.run_attempt&&job.name===policy.job.name&&job.workflow_name===policy.workflow.name&&job.head_sha===r.subject_sha&&job.status==='completed'&&job.conclusion==='success'&&artifact.id===r.source.artifact_id&&artifact.name===policy.artifact.name&&artifact.expired===false&&artifact.workflow_run?.id===run.id&&artifact.workflow_run?.repository_id===policy.repository.id&&artifact.workflow_run?.head_repository_id===policy.repository.id&&artifact.workflow_run?.head_sha===r.subject_sha&&artifact.digest===`sha256:${r.evidence_digest}`&&inWindow(artifact.created_at,job.started_at,job.completed_at);
    return{ok,facts:ok?{workflow_id:run.workflow_id,workflow_path:run.path,run_id:run.id,run_attempt:run.run_attempt,job_id:job.id,job_name:job.name,artifact_id:artifact.id,artifact_name:artifact.name}:null};
  }
  if(r.event_type==='owner_merge'){
    if(r.source.kind!=='github_pull_request_merge')return{ok:false};
    const pr=await apiGet(`${prefix}/pulls/${r.pull_request}`),projection=ownerProjection(pr),owner=policy.owner;
    const ok=projection.repository_id===policy.repository.id&&projection.repository===policy.repository.full_name&&projection.pull_request===r.pull_request&&projection.merged&&projection.merge_commit_sha===r.subject_sha&&projection.base_sha===r.base_sha&&projection.head_repository===policy.repository.full_name&&projection.merged_by.login===owner.login&&projection.merged_by.id===owner.id&&projection.merged_by.type===owner.type&&rawDigest(projection)===r.evidence_digest;
    return{ok,facts:ok?{pr_head_sha:projection.pr_head_sha,merge_commit_sha:projection.merge_commit_sha,merged_by:projection.merged_by}:null};
  }
  if(r.event_type==='exact_main_verified'){
    if(r.source.kind!=='github_default_branch_head'||r.source.branch!=='main')return{ok:false};
    const ref=await apiGet(`${prefix}/git/ref/heads/main`),projection={branch:'main',head_sha:ref.object?.sha};
    const ok=projection.head_sha===r.subject_sha&&rawDigest(projection)===r.evidence_digest;
    return{ok,facts:ok?projection:null};
  }
  return{ok:false};
}

export async function buildVerifiedEvidenceIndex(items){
  const z=[],verified=[],keys=new Set();
  for(const item of items){
    const r=item.value,source=item.file;
    z.push(...await schema(ES,r,source));
    if(r.receipt_hash!==receiptHash(r))z.push(d('PQG_SCHEMA_INVALID','receipt hash mismatch',source));
    if(r.repository!==REPO||r.program_id!==PID)z.push(d('PQG_SCHEMA_INVALID','receipt identity mismatch',source));
    const key=[r.task_id,r.event_type,r.pull_request,r.base_sha,r.subject_sha,r.scope_revision,r.evidence_digest].join(':');
    if(keys.has(key))z.push(d('PQG_SCHEMA_INVALID','duplicate receipt binding',source));
    keys.add(key);
    if(z.some(x=>x.source===source))continue;
    try{
      const result=await verifyExternalSource(r);
      if(result.ok)verified.push({receipt:r,facts:result.facts||{}});
      else z.push(d(r.event_type==='exact_head_validated'?'PQG_EXACT_HEAD_EVIDENCE_MISSING':r.event_type==='owner_merge'?'PQG_OWNER_MERGE_EVIDENCE_MISSING':'PQG_EXACT_MAIN_EVIDENCE_MISSING','external source does not match immutable evidence policy',source));
    }catch(error){z.push(d('PQG_GIT_EVIDENCE_UNAVAILABLE',error?.message||String(error),source))}
  }
  return{index:{[VERIFIED_INDEX]:true,receipts:verified},diagnostics:z};
}

export function receiptFor(index,ledger,event){
  if(!index?.[VERIFIED_INDEX])return null;
  const evidence=event.evidence?.[0];
  return index.receipts.find(entry=>{const r=entry.receipt||entry;return r.task_id===ledger.task_id&&r.event_type===event.event_type&&r.pull_request===ledger.pull_request&&r.base_sha===ledger.base_sha&&r.subject_sha===event.head_sha&&r.scope_revision===ledger.scope_revision&&r.evidence_digest===evidence?.sha256})||null;
}

export const evidenceProjectionDigest=rawDigest;

export function fixtureEvidenceIndex(receipts){
  if(process.env.PQG_FIXTURE_CONTEXT!=='1')throw new Error('synthetic evidence index is fixture-only');
  return{[VERIFIED_INDEX]:true,receipts:cp(receipts).map(x=>x.receipt?x:{receipt:x,facts:x.facts||{}})};
}
