import {L,REPO,PID,LS,cp,hash,rehash,d,schema} from './core.mjs';
import {receiptFor,EVIDENCE_POLICY} from './evidence.mjs';
export function eventHash(e){const x=cp(e);delete x.event_hash;return hash(x)}
export function ledgerHash(l){const x=cp(l);delete x.ledger_hash;return hash(x)}
export const reEvent=e=>rehash(e,'event_hash');
export function reLedger(l){for(const e of l.events||[])reEvent(e);return rehash(l,'ledger_hash')}
function order(events){let phase=0;for(const e of events){if(phase===0&&e.event_type==='start_preflight')phase=1;else if(phase===1&&e.event_type==='scope_committed')phase=2;else if(phase===2&&e.event_type==='scope_amended'){}else if(phase===2&&e.event_type==='scope_disclosed')phase=3;else if(phase===3&&e.event_type==='implementation_complete')phase=4;else if(phase===4&&e.event_type==='exact_head_validated')phase=5;else if(phase===5&&e.event_type==='owner_merge')phase=6;else if(phase===6&&e.event_type==='exact_main_verified')phase=7;else return false}return true}
export async function validateLifecycle(l,s,c={}){
  const source=c.source||L;let z=await schema(LS,l,source);
  if(l.repository!==REPO||l.program_id!==PID||l.task_id!==s.task_id)z.push(d('PQG_LIFECYCLE_IDENTITY_MISMATCH','ledger identity',source));if(l.scope_revision!==s.scope_revision)z.push(d('PQG_LIFECYCLE_SCOPE_STALE','ledger scope',source));
  if(l.ledger_hash!==ledgerHash(l))z.push(d('PQG_LIFECYCLE_LEDGER_HASH_MISMATCH','hash',source));
  if(!order(l.events||[]))z.push(d('PQG_LIFECYCLE_SEQUENCE_INVALID','order',source));
  const seen=new Set(),ev=new Set();
  for(let n=0;n<(l.events||[]).length;n++){
    const e=l.events[n];
    if(seen.has(e.event_id))z.push(d('PQG_LIFECYCLE_EVENT_REPLAY',e.event_id,source));seen.add(e.event_id);
    if(e.event_hash!==eventHash(e))z.push(d('PQG_LIFECYCLE_EVENT_HASH_MISMATCH',e.event_id,source));
    if(e.predecessor_event_id!==(n?l.events[n-1].event_id:null))z.push(d('PQG_LIFECYCLE_PREDECESSOR_MISMATCH',e.event_id,source));
    const currentTime=Date.parse(e.occurred_at),previousTime=n?Date.parse(l.events[n-1].occurred_at):null;if(Number.isNaN(currentTime)||(n&&(Number.isNaN(previousTime)||currentTime<previousTime)))z.push(d('PQG_LIFECYCLE_TIME_INVALID',e.event_id,source));
    if(e.repository!==l.repository||e.program_id!==l.program_id||e.task_id!==l.task_id||e.base_sha!==l.base_sha)z.push(d('PQG_LIFECYCLE_IDENTITY_MISMATCH',e.event_id,source));
    const eventScope=c.scopeByIdentity?.get(`${l.task_id}:${e.scope_revision}`)||(e.scope_revision===s.scope_revision?{value:s}:null);if(!eventScope)z.push(d('PQG_LIFECYCLE_SCOPE_STALE',e.event_id,source));
    for(const x of e.evidence||[]){if(ev.has(x.sha256))z.push(d('PQG_LIFECYCLE_EVIDENCE_REPLAY',x.sha256,source));ev.add(x.sha256)}
    if(e.event_type==='exact_head_validated'){
      const receipt=receiptFor(c.evidenceIndex,l,e);if(e.pull_request==null||e.pull_request!==l.pull_request)z.push(d('PQG_LIFECYCLE_IDENTITY_MISMATCH','exact-head PR',source));
      if(e.evidence?.[0]?.kind!=='authoritative_exact_head_ci'||!receipt)z.push(d('PQG_EXACT_HEAD_EVIDENCE_MISSING','verified canonical producer receipt missing or mismatched',source));else if(c.head&&receipt.facts?.current_head!==c.head)z.push(d('PQG_LIFECYCLE_HEAD_STALE','validated SHA is not bound to the checked-out repository Head',source));
    }
    if(e.event_type==='owner_merge'){
      const receipt=receiptFor(c.evidenceIndex,l,e),validated=l.events[n-1];if(e.pull_request==null||e.pull_request!==l.pull_request)z.push(d('PQG_LIFECYCLE_IDENTITY_MISMATCH','owner-merge PR',source));
      if(e.evidence?.[0]?.kind!=='authoritative_owner_merge'||!receipt)z.push(d('PQG_OWNER_MERGE_EVIDENCE_MISSING','verified owner receipt missing or mismatched',source));else if(validated?.event_type!=='exact_head_validated'||receipt.facts?.pr_head_sha!==validated.head_sha||receipt.facts?.base_ref!==EVIDENCE_POLICY.default_branch||receipt.facts?.merged_by?.login!==EVIDENCE_POLICY.owner.login||receipt.facts?.merged_by?.id!==EVIDENCE_POLICY.owner.id||receipt.facts?.merged_by?.type!==EVIDENCE_POLICY.owner.type)z.push(d('PQG_OWNER_MERGE_EVIDENCE_MISSING','target branch, merged PR Head or owner does not match lifecycle policy',source));
    }
    if(e.event_type==='exact_main_verified'){
      const receipt=receiptFor(c.evidenceIndex,l,e),owner=l.events[n-1],ownerOrdered=owner?.event_type==='owner_merge',facts=receipt?.facts||{},verifiedSubject=facts.verified_subject_sha??facts.head_sha,subjectContains=facts.subject_contains_owner_merge??facts.contains_owner_merge,currentContainsSubject=facts.current_main_contains_verified_subject??(facts.head_sha===e.head_sha),currentContainsOwner=facts.current_main_contains_owner_merge??facts.contains_owner_merge;if(e.pull_request==null||e.pull_request!==l.pull_request)z.push(d('PQG_LIFECYCLE_IDENTITY_MISMATCH','exact-main PR',source));if(!ownerOrdered)z.push(d('PQG_EXACT_MAIN_ORDER_INVALID','order',source));
      if(c.main&&c.main!==e.head_sha)z.push(d('PQG_EXACT_MAIN_STALE','live main differs from verified subject',source));
      if(ownerOrdered&&(e.evidence?.[0]?.kind!=='authoritative_exact_main'||!receipt))z.push(d('PQG_EXACT_MAIN_EVIDENCE_MISSING','verified receipt missing or mismatched',source));else if(ownerOrdered&&(facts.owner_merge_commit_sha!==owner.head_sha||subjectContains!==true||facts.branch!==EVIDENCE_POLICY.default_branch||verifiedSubject!==e.head_sha||currentContainsSubject!==true||currentContainsOwner!==true))z.push(d('PQG_EXACT_MAIN_EVIDENCE_MISSING','current main does not contain the immutable verified subject and recorded owner-merge commit',source));
    }
  }
  if(l.completion_claim&&(l.branch_kind!=='default'||l.events.at(-1)?.event_type!=='exact_main_verified'))z.push(d('PQG_FEATURE_BRANCH_COMPLETION_FORBIDDEN','feature',source));
  return z;
}
export function lifecycleState(l,diagnostics){if(diagnostics.length)return{implemented:false,complete:false};const types=new Set((l.events||[]).map(e=>e.event_type));return{implemented:types.has('implementation_complete')&&types.has('exact_head_validated'),complete:l.completion_claim&&l.branch_kind==='default'&&types.has('owner_merge')&&types.has('exact_main_verified')}}
export function completeLedger(base,s){const l=cp(base),h=['a'.repeat(40),'b'.repeat(40),'c'.repeat(40)],g=['1'.repeat(64),'2'.repeat(64),'3'.repeat(64)],k=['authoritative_exact_head_ci','authoritative_owner_merge','authoritative_exact_main'];let prev=l.events.at(-1).event_id,num=Number(prev.match(/(\d+)$/)?.[1]||0)+1;const receipts=[];for(const [n,t] of ['exact_head_validated','owner_merge','exact_main_verified'].entries()){const e={event_id:`PROMPT-QUALITY-EVENT-${String(num+n).padStart(4,'0')}`,event_version:1,event_type:t,predecessor_event_id:prev,occurred_at:`2026-07-18T12:25:${20+n}Z`,repository:REPO,program_id:PID,task_id:l.task_id,pull_request:29,base_sha:l.base_sha,head_sha:h[n],scope_revision:s.scope_revision,evidence:[{kind:k[n],reference:t,sha256:g[n]}],event_hash:''};reEvent(e);l.events.push(e);const descriptor={task_id:l.task_id,event_type:t,pull_request:29,base_sha:l.base_sha,subject_sha:h[n],scope_revision:s.scope_revision,evidence_digest:g[n]};if(t==='exact_head_validated')descriptor.facts={validated_sha:h[0],current_head:h[0],carrier_mode:'exact',changed_paths:[]};if(t==='owner_merge')descriptor.facts={pr_head_sha:h[0],merge_commit_sha:h[1],base_ref:EVIDENCE_POLICY.default_branch,merged_by:cp(EVIDENCE_POLICY.owner)};if(t==='exact_main_verified')descriptor.facts={branch:EVIDENCE_POLICY.default_branch,verified_subject_sha:h[2],owner_merge_commit_sha:h[1],subject_contains_owner_merge:true,current_main_contains_verified_subject:true,current_main_contains_owner_merge:true};receipts.push(descriptor);prev=e.event_id}l.pull_request=29;l.scope_revision=s.scope_revision;l.branch_kind='default';l.completion_claim=true;l.next_required_event=null;reLedger(l);return{l,h,g,receipts}}
