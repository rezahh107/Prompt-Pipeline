import {readFileSync} from 'node:fs';
import {ES,REPO,PID,cp,hash,d,schema} from './core.mjs';

const VERIFIED_INDEX=Symbol('verified-evidence-index');
const rawDigest=x=>hash(x).slice('sha256:'.length);
export function receiptHash(r){const x=cp(r);delete x.receipt_hash;return hash(x)}

async function apiGet(apiPath){
  const fixture=process.env.PQG_EVIDENCE_API_FIXTURE;
  if(fixture&&process.env.PQG_PRODUCTION_SELF_TEST==='1'){
    const map=JSON.parse(readFileSync(fixture,'utf8'));
    if(!(apiPath in map))throw new Error(`fixture response missing: ${apiPath}`);
    return cp(map[apiPath]);
  }
  const base=(process.env.PQG_GITHUB_API_URL||'https://api.github.com').replace(/\/$/,'');
  const headers={'accept':'application/vnd.github+json','user-agent':'Prompt-Pipeline-governance-validator'};
  if(process.env.GH_TOKEN)headers.authorization=`Bearer ${process.env.GH_TOKEN}`;
  const response=await fetch(`${base}${apiPath}`,{headers});
  if(!response.ok)throw new Error(`GitHub API ${response.status} for ${apiPath}`);
  return response.json();
}

async function verifyExternalSource(r){
  const prefix=`/repos/${r.repository}`;
  if(r.event_type==='exact_head_validated'){
    if(r.source.kind!=='github_actions_artifact')return false;
    const run=await apiGet(`${prefix}/actions/runs/${r.source.run_id}`);
    const jobs=await apiGet(`${prefix}/actions/runs/${r.source.run_id}/jobs?per_page=100`);
    const artifact=await apiGet(`${prefix}/actions/artifacts/${r.source.artifact_id}`);
    const job=(jobs.jobs||[]).find(x=>x.id===r.source.job_id);
    return run.id===r.source.run_id&&run.head_sha===r.subject_sha&&run.conclusion==='success'&&job?.conclusion==='success'&&artifact.id===r.source.artifact_id&&artifact.workflow_run?.head_sha===r.subject_sha&&artifact.digest===`sha256:${r.evidence_digest}`;
  }
  if(r.event_type==='owner_merge'){
    if(r.source.kind!=='github_pull_request_merge')return false;
    const pr=await apiGet(`${prefix}/pulls/${r.pull_request}`);
    const projection={pull_request:pr.number,merged:pr.merged===true,merge_commit_sha:pr.merge_commit_sha,base_sha:pr.base?.sha};
    return projection.pull_request===r.pull_request&&projection.merged&&projection.merge_commit_sha===r.subject_sha&&projection.base_sha===r.base_sha&&rawDigest(projection)===r.evidence_digest;
  }
  if(r.event_type==='exact_main_verified'){
    if(r.source.kind!=='github_default_branch_head'||r.source.branch!=='main')return false;
    const ref=await apiGet(`${prefix}/git/ref/heads/main`);
    const projection={branch:'main',head_sha:ref.object?.sha};
    return projection.head_sha===r.subject_sha&&rawDigest(projection)===r.evidence_digest;
  }
  return false;
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
      if(await verifyExternalSource(r))verified.push(r);
      else z.push(d(r.event_type==='exact_head_validated'?'PQG_EXACT_HEAD_EVIDENCE_MISSING':r.event_type==='owner_merge'?'PQG_OWNER_MERGE_EVIDENCE_MISSING':'PQG_EXACT_MAIN_EVIDENCE_MISSING','external source does not match receipt',source));
    }catch(error){z.push(d('PQG_GIT_EVIDENCE_UNAVAILABLE',error?.message||String(error),source))}
  }
  return {index:{[VERIFIED_INDEX]:true,receipts:verified},diagnostics:z};
}

export function receiptFor(index,ledger,event){
  if(!index?.[VERIFIED_INDEX])return null;
  const evidence=event.evidence?.[0];
  return index.receipts.find(r=>r.task_id===ledger.task_id&&r.event_type===event.event_type&&r.pull_request===ledger.pull_request&&r.base_sha===ledger.base_sha&&r.subject_sha===event.head_sha&&r.scope_revision===ledger.scope_revision&&r.evidence_digest===evidence?.sha256)||null;
}

export const evidenceProjectionDigest=rawDigest;

export function fixtureEvidenceIndex(receipts){
  if(process.env.PQG_FIXTURE_CONTEXT!=='1')throw new Error('synthetic evidence index is fixture-only');
  return {[VERIFIED_INDEX]:true,receipts:cp(receipts)};
}
