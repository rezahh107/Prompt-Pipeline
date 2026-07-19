#!/usr/bin/env node
import {P,D,F,C,fp,json,setCodes,d,requiredOutputs,diagnosticRegistry,ciWiring,gitContext} from './prompt-quality-governance/core.mjs';
import {existsSync} from 'node:fs';
import {validateProgram,validateMemory} from './prompt-quality-governance/program.mjs';
import {validateScope,validateImpact,validateImpactHistory} from './prompt-quality-governance/scope-progress.mjs';
import {validateLifecycle,lifecycleState} from './prompt-quality-governance/lifecycle.mjs';
import {validateFixtures} from './prompt-quality-governance/fixtures.mjs';
import {discoverRepositoryState,discoveryDiagnostics,matchingScope} from './prompt-quality-governance/discovery.mjs';
import {buildVerifiedEvidenceIndex} from './prompt-quality-governance/evidence.mjs';

async function main(){
  const args=new Set(process.argv.slice(2)),all=!args.size||args.has('--all'),rp=all||args.has('--program'),rs=all||args.has('--scope'),ri=all||args.has('--progress'),rl=all||args.has('--lifecycle'),rf=all||args.has('--fixtures'),selected=process.argv.includes('--fixture')?process.argv[process.argv.indexOf('--fixture')+1]:null;
  const reg=json(D);setCodes((reg.entries||[]).map(x=>x.code));
  const p=json(P),selector=json(C),s=json(selector.scope_path),g=gitContext(s),state=discoverRepositoryState(g),z=[...g.errors,...discoveryDiagnostics(state)];
  if(selector.scope_revision!==s.scope_revision)z.push(d('PQG_CURRENT_SCOPE_INVALID','selector',C));
  const scopeByIdentity=new Map(state.scopes.map(item=>[`${item.value?.task_id}:${item.value?.scope_revision}`,item]));
  const evidence=await buildVerifiedEvidenceIndex(state.receipts,{currentHead:g.head,ledgers:state.ledgers,scopes:state.scopes,currentScopeRevision:selector.scope_revision,currentScopePath:selector.scope_path});z.push(...evidence.diagnostics);
  const implementationTaskIds=new Set(),completionTaskIds=new Set(),lifecycleDiagnostics=[];let activationComplete=false;
  for(const item of state.ledgers){
    const scopeItem=matchingScope(state,item.value.task_id,item.value.scope_revision);if(!scopeItem)continue;
    const found=await validateLifecycle(item.value,scopeItem.value,{source:item.file,head:g.head,evidenceIndex:evidence.index,scopeByIdentity});lifecycleDiagnostics.push(...found);
    const derived=lifecycleState(item.value,found);if(item.value.task_id==='PROMPT-QUALITY-PROGRAM-ACTIVATION')activationComplete=derived.complete;
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
  const activationImpact=state.impacts.find(x=>x.value.work_type==='program_activation')?.value,activationLedger=state.ledgers.find(x=>x.value.task_id==='PROMPT-QUALITY-PROGRAM-ACTIVATION')?.value;
  const historicalScope=state.scopes.find(x=>x.file==='planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION.scope.json')?.value||s;
  const fixtureLedger=activationLedger?structuredClone(activationLedger):activationLedger;
  if(fixtureLedger){const end=fixtureLedger.events.findIndex(x=>x.event_type==='implementation_complete');fixtureLedger.events=fixtureLedger.events.slice(0,end+1);fixtureLedger.pull_request=null;fixtureLedger.scope_revision=historicalScope.scope_revision;fixtureLedger.branch_kind='feature';fixtureLedger.completion_claim=false;fixtureLedger.next_required_event='exact_head_validated';}
  const fx=rf?await validateFixtures({p,s:historicalScope,i:activationImpact,l:fixtureLedger},selected):{docs:['valid.json','invalid.json','adversarial.json'].map(x=>json(`${F}/${x}`)),z:[],results:[]};delete process.env.PQG_FIXTURE_CONTEXT;
  z.push(...fx.z,...diagnosticRegistry(reg,fx.docs),...validateMemory(p),...ciWiring(),...requiredOutputs(p,s));
  const out=[...new Map(z.map(x=>[`${x.code}:${x.source}:${x.message}`,x])).values()];
  if(out.length){console.error(`Prompt Quality governance validation failed with ${out.length} diagnostic(s).`);for(const x of out)console.error(`${x.code} | ${x.source} | ${x.message}`);for(const x of fx.results.filter(x=>!x.ok))console.error(`fixture ${x.fixture_id} expected=${JSON.stringify(x.expected)} observed=${JSON.stringify(x.observed)}`);process.exit(1)}
  console.log(`Prompt Quality governance validation passed. tasks=${p.tasks.length} fixtures=${rf?fx.results.length:0} scopes=${state.scopes.length} impacts=${state.impacts.length} ledgers=${state.ledgers.length} receipts=${state.receipts.length} scope_reconciled=${g.reconcile} schema_validation=${process.env.PQG_SKIP_SCHEMA_VALIDATION==='1'?'skipped':'enforced'} head=${g.head||'not-bound-locally'}`)
}
await main();
