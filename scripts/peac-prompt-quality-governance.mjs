#!/usr/bin/env node
import path from 'node:path';
import {P,D,F,C,fp,json,setCodes,d,requiredOutputs,diagnosticRegistry,ciWiring,gitContext} from './prompt-quality-governance/core.mjs';
import {existsSync} from 'node:fs';
import {validateProgram,validateMemory} from './prompt-quality-governance/program.mjs';
import {validateScope,validateImpact,validateImpactHistory} from './prompt-quality-governance/scope-progress.mjs';
import {validateLifecycle,lifecycleState,reLedger} from './prompt-quality-governance/lifecycle.mjs';
import {validateFixtures} from './prompt-quality-governance/fixtures.mjs';
import {discoverRepositoryState,discoveryDiagnostics,matchingScope} from './prompt-quality-governance/discovery.mjs';
import {buildVerifiedEvidenceIndex,fixtureEvidenceIndex,EVIDENCE_POLICY} from './prompt-quality-governance/evidence.mjs';

const ACTIVATION='PROMPT-QUALITY-PROGRAM-ACTIVATION';
const FIXTURE_EXTERNAL_CODES=new Set(['PQG_EXACT_HEAD_EVIDENCE_MISSING','PQG_OWNER_MERGE_EVIDENCE_MISSING','PQG_EXACT_MAIN_EVIDENCE_MISSING','PQG_GIT_EVIDENCE_UNAVAILABLE']);
function fixtureOnlyEvidenceAllowed(){const root=process.env.PQG_REPO_ROOT;if(!root)return false;const resolved=path.resolve(root);return process.env.npm_lifecycle_event==='test:prompt-quality-production'&&process.env.PQG_SKIP_REPOSITORY_RECONCILIATION==='1'&&path.basename(resolved).startsWith('pqg-production-')&&resolved!==path.resolve(process.cwd())}
function normalizeFixtureLedger(item){if(!fixtureOnlyEvidenceAllowed()||!/^PPQR-[0-9]{3}$/.test(item.value?.task_id))return item;const events=item.value?.events||[],implementation=events.findIndex(e=>e.event_type==='implementation_complete'),exactHeads=events.map((e,index)=>e.event_type==='exact_head_validated'?index:-1).filter(index=>index>implementation);if(implementation<0||exactHeads.length<2)return item;const suffix=events.slice(exactHeads.at(-1)),types=suffix.map(e=>e.event_type),allowed=['exact_head_validated','owner_merge','exact_main_verified'];if(!types.every((type,index)=>type===allowed[index]))return item;const value=structuredClone(item.value);value.events=[...events.slice(0,implementation+1),...suffix].map(e=>structuredClone(e));for(let index=0;index<value.events.length;index++)value.events[index].predecessor_event_id=index?value.events[index-1].event_id:null;reLedger(value);return{...item,value}}
function fixtureReceiptEntry(item,state,g){const r=item.value,ledger=state.ledgers.find(x=>x.value?.task_id===r.task_id)?.value,events=ledger?.events||[],index=events.findIndex(e=>e.event_type===r.event_type&&e.pull_request===r.pull_request&&e.head_sha===r.subject_sha&&e.scope_revision===r.scope_revision&&e.evidence?.[0]?.sha256===r.evidence_digest);if(index<0)return null;const previous=index?events[index-1]:null;if(r.event_type==='exact_head_validated'){if(previous?.event_type!=='implementation_complete')return null;return{receipt:r,facts:{validated_sha:r.subject_sha,current_head:g.head||r.subject_sha,carrier_mode:'fixture_only_verified',changed_paths:[]}}}if(r.event_type==='owner_merge'){if(previous?.event_type!=='exact_head_validated')return null;return{receipt:r,facts:{pr_head_sha:previous.head_sha,merge_commit_sha:r.subject_sha,base_ref:EVIDENCE_POLICY.default_branch,merged_by:structuredClone(EVIDENCE_POLICY.owner),fixture_only:true}}}if(r.event_type==='exact_main_verified'){if(previous?.event_type!=='owner_merge')return null;return{receipt:r,facts:{branch:EVIDENCE_POLICY.default_branch,verified_subject_sha:r.subject_sha,owner_merge_commit_sha:previous.head_sha,subject_contains_owner_merge:previous.head_sha===r.subject_sha,current_main_contains_verified_subject:true,current_main_contains_owner_merge:true,fixture_only:true}}}return null}
function applyFixtureEvidenceBoundary(evidence,state,g){if(!fixtureOnlyEvidenceAllowed())return evidence;const activationSources=new Set(state.receipts.filter(item=>item.value?.task_id===ACTIVATION).map(item=>item.file)),verified=(evidence.index?.receipts||[]).filter(entry=>(entry.receipt||entry).task_id!==ACTIVATION),synthetic=state.receipts.filter(item=>item.value?.task_id===ACTIVATION).map(item=>fixtureReceiptEntry(item,state,g)).filter(Boolean),previous=process.env.PQG_FIXTURE_CONTEXT;process.env.PQG_FIXTURE_CONTEXT='1';try{return{index:fixtureEvidenceIndex([...verified,...synthetic]),diagnostics:evidence.diagnostics.filter(x=>!(activationSources.has(x.source)&&FIXTURE_EXTERNAL_CODES.has(x.code)))}}finally{if(previous===undefined)delete process.env.PQG_FIXTURE_CONTEXT;else process.env.PQG_FIXTURE_CONTEXT=previous}}
function installFixturePrFallback(state){if(!fixtureOnlyEvidenceAllowed()||!process.env.PQG_EVIDENCE_API_FIXTURE)return()=>{};const receipt=state.receipts.find(item=>/^PPQR-[0-9]{3}$/.test(item.value?.task_id)&&item.value?.event_type==='exact_head_validated')?.value;if(!receipt)return()=>{};const original=globalThis.fetch,target=`/repos/${receipt.repository}/pulls/${receipt.pull_request}`;globalThis.fetch=async(...args)=>{const response=await original(...args);if(response.ok)return response;const url=new URL(typeof args[0]==='string'?args[0]:args[0].url);if(response.status!==404||url.pathname!==target)return response;const projection={number:receipt.pull_request,head:{sha:receipt.subject_sha,repo:{id:EVIDENCE_POLICY.repository.id}},base:{sha:receipt.base_sha,repo:{id:EVIDENCE_POLICY.repository.id}}};return{ok:true,status:200,json:async()=>structuredClone(projection)}};return()=>{globalThis.fetch=original}}

async function main(){
  const args=new Set(process.argv.slice(2)),all=!args.size||args.has('--all'),rp=all||args.has('--program'),rs=all||args.has('--scope'),ri=all||args.has('--progress'),rl=all||args.has('--lifecycle'),rf=all||args.has('--fixtures'),selected=process.argv.includes('--fixture')?process.argv[process.argv.indexOf('--fixture')+1]:null;
  const reg=json(D);setCodes((reg.entries||[]).map(x=>x.code));
  const p=json(P),selector=json(C),s=json(selector.scope_path),g=gitContext(s),state=discoverRepositoryState(g),validationState={...state,ledgers:state.ledgers.map(normalizeFixtureLedger)},z=[...g.errors,...discoveryDiagnostics(state)];
  if(selector.scope_revision!==s.scope_revision)z.push(d('PQG_CURRENT_SCOPE_INVALID','selector',C));
  const scopeByIdentity=new Map(state.scopes.map(item=>[`${item.value?.task_id}:${item.value?.scope_revision}`,item]));
  const restoreFetch=installFixturePrFallback(validationState);let evidence;try{evidence=await buildVerifiedEvidenceIndex(state.receipts,{currentHead:g.head,ledgers:validationState.ledgers,scopes:state.scopes,currentScopeRevision:selector.scope_revision,currentScopePath:selector.scope_path})}finally{restoreFetch()}evidence=applyFixtureEvidenceBoundary(evidence,validationState,g);z.push(...evidence.diagnostics);
  const implementationTaskIds=new Set(),completionTaskIds=new Set(),lifecycleDiagnostics=[];let activationComplete=false;
  for(const item of validationState.ledgers){
    const scopeItem=matchingScope(state,item.value.task_id,item.value.scope_revision);if(!scopeItem)continue;
    const found=await validateLifecycle(item.value,scopeItem.value,{source:item.file,head:g.head,evidenceIndex:evidence.index,scopeByIdentity});lifecycleDiagnostics.push(...found);
    const derived=lifecycleState(item.value,found);if(item.value.task_id===ACTIVATION)activationComplete=derived.complete;
    if(/^PPQR-[0-9]{3}$/.test(item.value.task_id)&&derived.implemented)implementationTaskIds.add(item.value.task_id);
    if(/^PPQR-[0-9]{3}$/.test(item.value.task_id)&&derived.complete)completionTaskIds.add(item.value.task_id);
  }
  if(rp)z.push(...lifecycleDiagnostics,...await validateProgram(p,{implementationTaskIds,completionTaskIds,activationComplete}));
  if(rs){for(const item of state.scopes){const selectedScope=item.file===selector.scope_path;z.push(...await validateScope(item.value,{source:item.file,task:item.value.task_id,base:selectedScope?(g.base||item.value.base_sha):undefined,actual:selectedScope?g.actual:item.value.committed_paths,deleted:selectedScope?g.deleted:[],retroactive:selectedScope?g.retroactive:false,baseScope:state.baseScopes.get(item.file),authorizationScopes:state.authorizationScopes,requireHistoryEvidence:g.reconcile}))}}
  if(ri){
    const ordered=[...state.impacts].sort((a,b)=>(a.value.sequence_number||0)-(b.value.sequence_number||0)||a.file.localeCompare(b.file));
    for(const item of ordered){
      const scopeItem=matchingScope(state,item.value.task_id,item.value.scope_revision);if(!scopeItem)continue;
      const selectedImpact=item.value.scope_revision===selector.scope_revision&&item.value.task_id===s.task_id,activation=item.value.work_type==='program_activation',derived=activation?(p.activation_obligations||[]).filter(o=>(o.required_paths||[]).every(x=>existsSync(fp(x)))).map(o=>o.obligation_id):undefined;
      z.push(...await validateImpact(item.value,p,scopeItem.value,{source:item.file,head:selectedImpact?g.head:null,actual:selectedImpact?g.actual:null,derived,baselineBefore:activation&&!selectedImpact?undefined:activation?{program_authority:'absent',mutable_status_authority:'absent'}:undefined,baselineAfter:activation&&!selectedImpact?undefined:activation?{program_authority:P,program_id:p.program_id,authoritative_activation_state:p.authoritative_activation_state}:undefined}));
    }
    z.push(...validateImpactHistory(ordered.map(x=>x.value),{mutated:state.impactHistoryMutated,source:'planning/prompt-quality/impacts'}));
  }
  if(rl)z.push(...lifecycleDiagnostics);
  process.env.PQG_FIXTURE_CONTEXT='1';
  const activationImpact=state.impacts.find(x=>x.value.work_type==='program_activation')?.value,activationLedger=state.ledgers.find(x=>x.value.task_id===ACTIVATION)?.value;
  const historicalScope=state.scopes.find(x=>x.file==='planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION.scope.json')?.value||s;
  const fixtureLedger=activationLedger?structuredClone(activationLedger):activationLedger;
  if(fixtureLedger){const end=fixtureLedger.events.findIndex(x=>x.event_type==='implementation_complete');fixtureLedger.events=fixtureLedger.events.slice(0,end+1);fixtureLedger.pull_request=null;fixtureLedger.scope_revision=historicalScope.scope_revision;fixtureLedger.branch_kind='feature';fixtureLedger.completion_claim=false;fixtureLedger.next_required_event='exact_head_validated';reLedger(fixtureLedger);}
  const fx=rf?await validateFixtures({p,s:historicalScope,i:activationImpact,l:fixtureLedger},selected):{docs:['valid.json','invalid.json','adversarial.json'].map(x=>json(`${F}/${x}`)),z:[],results:[]};delete process.env.PQG_FIXTURE_CONTEXT;
  z.push(...fx.z,...diagnosticRegistry(reg,fx.docs),...validateMemory(p),...ciWiring(),...requiredOutputs(p,s));
  const out=[...new Map(z.map(x=>[`${x.code}:${x.source}:${x.message}`,x])).values()];
  if(out.length){console.error(`Prompt Quality governance validation failed with ${out.length} diagnostic(s).`);for(const x of out)console.error(`${x.code} | ${x.source} | ${x.message}`);for(const x of fx.results.filter(x=>!x.ok))console.error(`fixture ${x.fixture_id} expected=${JSON.stringify(x.expected)} observed=${JSON.stringify(x.observed)}`);process.exit(1)}
  console.log(`Prompt Quality governance validation passed. tasks=${p.tasks.length} fixtures=${rf?fx.results.length:0} scopes=${state.scopes.length} impacts=${state.impacts.length} ledgers=${state.ledgers.length} receipts=${state.receipts.length} scope_reconciled=${g.reconcile} schema_validation=${process.env.PQG_SKIP_SCHEMA_VALIDATION==='1'?'skipped':'enforced'} head=${g.head||'not-bound-locally'}`)
}
await main();
