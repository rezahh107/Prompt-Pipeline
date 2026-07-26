#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {load as loadYaml} from 'js-yaml';
import {N,P,REPO,json,txt} from './prompt-quality-program/core.mjs';
import {CANONICAL_WORKFLOW,COMPLETION_PROFILE,deriveCompletionClosure,evaluateCanonicalProfile,loadTrustedCompletionEvidence} from './prompt-quality-program/evidence.mjs';
import {DEPS,completionDiagnostics,eligibility,taskMap,validateProgram,validateStatus} from './prompt-quality-program/program.mjs';

const base=json(P),next=txt(N),canonicalPackage=JSON.parse(readFileSync('package.json','utf8'));
const canonicalWorkflowText=readFileSync('.github/workflows/ci.yml','utf8'),canonicalWorkflow=loadYaml(canonicalWorkflowText);
const clone=value=>structuredClone(value);let passed=0;const seen=new Set();
function pass(id,message){if(seen.has(id))throw new Error(`duplicate test id ${id}`);seen.add(id);passed++;console.log(`${id} PASS: ${message}`)}
function assert(condition,message){if(!condition)throw new Error(message)}
function hasCode(diagnostics,code){return diagnostics.some(item=>item.code===code)}
function claim(sha='a'.repeat(40),source='github_actions',runId=123,profile=COMPLETION_PROFILE){return{validation_status:'passed',tested_commit:sha,source,validation_profile:profile,ci_run_reference:source==='github_actions'?runId:null}}
function complete(program,taskId,sha,runId=123,source='github_actions',profile=COMPLETION_PROFILE){const task=program.tasks.find(item=>item.task_id===taskId);task.state='complete';task.completion_validation=claim(sha,source,runId,profile);return task}
function mutateStatus(text,mutator){const pattern=/<!-- prompt-quality-status:start -->\s*```json\s*([\s\S]*?)\s*```/;const match=text.match(pattern);const status=JSON.parse(match[1]);mutator(status);return text.replace(match[1],JSON.stringify(status,null,2))}
function git(dir,...args){return String(execFileSync('git',args,{cwd:dir,encoding:'utf8'})).trim()}
function writeRepoState(dir,program,status){mkdirSync(path.join(dir,path.dirname(P)),{recursive:true});mkdirSync(path.join(dir,path.dirname(N)),{recursive:true});writeFileSync(path.join(dir,P),JSON.stringify(program));writeFileSync(path.join(dir,N),status)}
function commitAll(dir,message){git(dir,'add','.');git(dir,'commit','-qm',message);return git(dir,'rev-parse','HEAD')}
function initRepo(){
  const dir=mkdtempSync(path.join(tmpdir(),'pp31-profile-merge-'));git(dir,'init','-q');git(dir,'config','user.email','fixture@example.invalid');git(dir,'config','user.name','PP31 Fixture');
  writeRepoState(dir,base,next);mkdirSync(path.join(dir,'.github/workflows'),{recursive:true});writeFileSync(path.join(dir,'package.json'),JSON.stringify(canonicalPackage,null,2));writeFileSync(path.join(dir,'.github/workflows/ci.yml'),canonicalWorkflowText);writeFileSync(path.join(dir,'README.md'),'baseline\n');commitAll(dir,'baseline');return dir;
}
function addSubject(dir,name='subject'){mkdirSync(path.join(dir,'src'),{recursive:true});writeFileSync(path.join(dir,'src',`${name}.txt`),`${name}\n`);return commitAll(dir,name)}
function addClosure(dir,taskId,claimedSubject,{runId=123,extraPath=null,multiple=false}={}){
  const program=JSON.parse(readFileSync(path.join(dir,P),'utf8'));complete(program,taskId,claimedSubject,runId);if(multiple)complete(program,'PPQR-003',claimedSubject,runId);
  const currentStatus=readFileSync(path.join(dir,N),'utf8');const status=mutateStatus(currentStatus,value=>{value.current_task='PPQR-002';value.task_status='not_started';value.blocked_by=[];value.last_completed_task=taskId;value.next_action='Continue with the next eligible Task.'});
  writeRepoState(dir,program,status);if(extraPath){mkdirSync(path.join(dir,path.dirname(extraPath)),{recursive:true});writeFileSync(path.join(dir,extraPath),'unauthorized\n')}
  return{program,status,closure:commitAll(dir,'completion closure')};
}
function mockFetch(subject,{runId=123,runOverrides={},jobOverrides={},extraRuns=[]}={}){
  return async url=>{
    const ok=data=>({ok:true,status:200,json:async()=>data});
    if(url.includes(`/actions/workflows/${CANONICAL_WORKFLOW.id}/runs`)){
      const run={id:runId,repository:{full_name:REPO},workflow_id:CANONICAL_WORKFLOW.id,name:CANONICAL_WORKFLOW.name,status:'completed',conclusion:'success',head_sha:subject,...runOverrides};
      return ok({workflow_runs:[run,...extraRuns]});
    }
    if(url.includes(`/actions/runs/${runId}/jobs`))return ok({jobs:[{name:CANONICAL_WORKFLOW.job,status:'completed',conclusion:'success',...jobOverrides}]});
    for(const run of extraRuns)if(url.includes(`/actions/runs/${run.id}/jobs`))return ok({jobs:[{name:CANONICAL_WORKFLOW.job,status:'completed',conclusion:'success'}]});
    return{ok:false,status:404,json:async()=>({})};
  };
}
async function trusted(program,dir,head,subject,options={}){return loadTrustedCompletionEvidence(program,{cwd:dir,env:{TESTED_SHA:head,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:REPO,GITHUB_TOKEN:'test'},fetchImpl:mockFetch(subject,options)})}
async function fixtureCase(build){const dir=initRepo();try{return await build(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function canonicalEvidence(sha='a'.repeat(40),runId=123,overrides={}){
  const entry={repository:REPO,history_available:true,transition_count:1,closure_parent_count:1,closure_is_ancestor_of_validation_head:true,subject_commit:sha,subject_commit_exists:true,subject_parent_count:1,subject_scope_available:true,subject_task_was_complete:false,transitioned_task_ids:['PPQR-001'],closure_scope_valid:true,subject_has_non_closure_change:true,history_drift:false,profile_id:COMPLETION_PROFILE,profile_status:'valid',profile_issues:[],accepted_run_count:1,workflow_run:{run_id:runId,repository:REPO,workflow_id:CANONICAL_WORKFLOW.id,workflow_name:CANONICAL_WORKFLOW.name,status:'completed',conclusion:'success',head_sha:sha,jobs:[{name:CANONICAL_WORKFLOW.job,status:'completed',conclusion:'success'}]}};
  return{...entry,...overrides,workflow_run:overrides.workflow_run?{...entry.workflow_run,...overrides.workflow_run}:entry.workflow_run};
}
function completionContext(entry){return{trusted:true,repository:REPO,completions:{'PPQR-001':entry}}}

await fixtureCase(async dir=>{
  const subject=addSubject(dir,'canonical-profile-subject'),{program,closure}=addClosure(dir,'PPQR-001',subject),evidence=await trusted(program,dir,closure,subject);
  const diagnostics=await validateProgram(program,evidence.context);assert(diagnostics.length===0,JSON.stringify(diagnostics));assert(evidence.context.completions['PPQR-001'].profile_status==='valid','canonical profile was not derived as valid');
  pass('T-PROFILE-001','current canonical workflow and package profile accepted through adapter');
});
{
  for(const mutation of [pkg=>{pkg.scripts.ci='true'},pkg=>{pkg.scripts.ci='pnpm typecheck'},pkg=>{pkg.scripts.ci=pkg.scripts.ci.replace(' && pnpm peac:runtime-authority-test','')}]){
    const pkg=clone(canonicalPackage);mutation(pkg);const result=evaluateCanonicalProfile(pkg,canonicalWorkflow);assert(result.status==='mismatch',JSON.stringify(result));
  }
  const task={task_id:'PPQR-001',state:'complete',completion_validation:claim()};assert(hasCode(completionDiagnostics(task,completionContext(canonicalEvidence('a'.repeat(40),123,{profile_status:'mismatch',profile_issues:['package_ci_chain_mismatch']}))),'PQG_COMPLETION_PROFILE_MISMATCH'),'profile mismatch diagnostic missing');
  pass('T-PROFILE-002','weakened package CI chains reject');
}
{
  const mutations=[
    workflow=>{workflow.jobs['peac-ci'].steps.find(step=>step.name==='Run canonical CI script').run='echo skipped'},
    workflow=>{workflow.jobs['peac-ci'].steps.find(step=>step.name==='Run required renderer validation commands').run='pnpm typecheck'},
    workflow=>{workflow.jobs['peac-ci'].steps.find(step=>step.name==='Verify bundle output').run='echo no bundle check'}
  ];
  for(const mutation of mutations){const workflow=clone(canonicalWorkflow);mutation(workflow);assert(evaluateCanonicalProfile(canonicalPackage,workflow).status==='mismatch','weakened workflow accepted')}
  pass('T-PROFILE-003','weakened canonical workflow rejects');
}
{
  const packageMutations=[pkg=>{pkg.scripts.ci+=' || true'},pkg=>{pkg.scripts.ci+=' ; true'}];
  for(const mutation of packageMutations){const pkg=clone(canonicalPackage);mutation(pkg);assert(evaluateCanonicalProfile(pkg,canonicalWorkflow).status==='mismatch','package suppression accepted')}
  const workflowMutations=[
    workflow=>{workflow.jobs['peac-ci'].steps.find(step=>step.name==='Run canonical CI script').run='set +e\npnpm run ci'},
    workflow=>{workflow.jobs['peac-ci'].steps.find(step=>step.name==='Run canonical CI script').run='pnpm run ci || true'},
    workflow=>{workflow.jobs['peac-ci'].steps.find(step=>step.name==='Run canonical CI script')['continue-on-error']=true}
  ];
  for(const mutation of workflowMutations){const workflow=clone(canonicalWorkflow);mutation(workflow);assert(evaluateCanonicalProfile(canonicalPackage,workflow).status==='mismatch','workflow suppression accepted')}
  pass('T-PROFILE-004','continue-on-error and shell success suppression reject');
}
await fixtureCase(async dir=>{
  const pkg=clone(canonicalPackage);pkg.scripts.ci='true';writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg,null,2));mkdirSync(path.join(dir,'src'),{recursive:true});writeFileSync(path.join(dir,'src/weakened.txt'),'weakened\n');const subject=commitAll(dir,'weakened subject');
  const {program,closure}=addClosure(dir,'PPQR-001',subject),evidence=await trusted(program,dir,closure,subject);const diagnostics=completionDiagnostics(program.tasks[0],evidence.context);
  assert(hasCode(diagnostics,'PQG_COMPLETION_PROFILE_MISMATCH'),JSON.stringify(diagnostics));assert(evidence.externalApiCalls===0,'profile mismatch must precede GitHub run acceptance');
  pass('T-PROFILE-005','profile label alone cannot authorize weakened subject topology');
});
{
  const program=clone(base),task=complete(program,'PPQR-001','a'.repeat(40),123,'github_actions','peac-canonical-ci.v999');
  const diagnostics=await validateProgram(program,completionContext(canonicalEvidence()));assert(hasCode(diagnostics,'PQG_SCHEMA_INVALID')&&hasCode(diagnostics,'PQG_COMPLETION_PROFILE_INVALID'),JSON.stringify(diagnostics));
  pass('T-PROFILE-006','unknown validation profile rejects');
}

await fixtureCase(async dir=>{
  const main=git(dir,'branch','--show-current');git(dir,'checkout','-qb','feature-merge-valid');mkdirSync(path.join(dir,'src'),{recursive:true});writeFileSync(path.join(dir,'src/merged.txt'),'merged\n');commitAll(dir,'feature implementation');git(dir,'checkout','-q',main);git(dir,'merge','--no-ff','-m','merge implementation subject','feature-merge-valid');const subject=git(dir,'rev-parse','HEAD');
  const {program,closure}=addClosure(dir,'PPQR-001',subject),evidence=await trusted(program,dir,closure,subject),entry=evidence.context.completions['PPQR-001'];
  assert(entry.subject_parent_count===2&&entry.subject_changed_paths.includes('src/merged.txt'),JSON.stringify(entry));assert((await validateProgram(program,evidence.context)).length===0,'valid merge subject rejected');
  pass('T-MERGE-001','two-parent merge subject accepted from first-parent delta');
});
await fixtureCase(async dir=>{
  const main=git(dir,'branch','--show-current');git(dir,'checkout','-qb','feature-bookkeeping');writeFileSync(path.join(dir,N),readFileSync(path.join(dir,N),'utf8')+'\nBookkeeping-only merge note.\n');commitAll(dir,'bookkeeping only');git(dir,'checkout','-q',main);git(dir,'merge','--no-ff','-m','merge bookkeeping subject','feature-bookkeeping');const subject=git(dir,'rev-parse','HEAD');
  const {program,closure}=addClosure(dir,'PPQR-001',subject),evidence=await trusted(program,dir,closure,subject);assert(hasCode(completionDiagnostics(program.tasks[0],evidence.context),'PQG_COMPLETION_SUBJECT_SCOPE_INVALID'),'bookkeeping-only merge subject accepted');
  pass('T-MERGE-002','bookkeeping-only first-parent merge delta rejects');
});
await fixtureCase(async dir=>{
  const main=git(dir,'branch','--show-current');git(dir,'checkout','-qb','feature-second-parent');mkdirSync(path.join(dir,'src'),{recursive:true});writeFileSync(path.join(dir,'src/second-parent-only.txt'),'unrelated\n');commitAll(dir,'second parent implementation');git(dir,'checkout','-q',main);git(dir,'merge','--no-ff','-s','ours','-m','ours merge subject','feature-second-parent');const subject=git(dir,'rev-parse','HEAD');
  const {program,closure}=addClosure(dir,'PPQR-001',subject),evidence=await trusted(program,dir,closure,subject),entry=evidence.context.completions['PPQR-001'];assert(entry.subject_parent_count===2&&entry.subject_changed_paths.length===0,JSON.stringify(entry));assert(hasCode(completionDiagnostics(program.tasks[0],evidence.context),'PQG_COMPLETION_SUBJECT_SCOPE_INVALID'),'second-parent-only path created false subject scope');
  pass('T-MERGE-003','second-parent-only paths cannot satisfy first-parent subject scope');
});
{
  await fixtureCase(async dir=>{const subject=addSubject(dir,'direct-subject'),result=addClosure(dir,'PPQR-001',subject),evidence=await trusted(result.program,dir,result.closure,subject);assert((await validateProgram(result.program,evidence.context)).length===0,'single-parent subject regressed')});
  await fixtureCase(async dir=>{const old=addSubject(dir,'old-ancestor'),actual=addSubject(dir,'actual-subject'),result=addClosure(dir,'PPQR-001',old),evidence=await trusted(result.program,dir,result.closure,actual);assert(hasCode(completionDiagnostics(result.program.tasks[0],evidence.context),'PQG_COMPLETION_SUBJECT_NOT_PARENT'),'old non-parent ancestor accepted')});
  pass('T-SUBJECT-001','single-parent subject passes and old non-parent ancestor rejects');
}

{
  await fixtureCase(async dir=>{const old=addSubject(dir,'old'),actual=addSubject(dir,'actual'),result=addClosure(dir,'PPQR-001',old),evidence=await trusted(result.program,dir,result.closure,actual);assert(hasCode(completionDiagnostics(result.program.tasks[0],evidence.context),'PQG_COMPLETION_SUBJECT_NOT_PARENT'),'old ancestor accepted')});
  await fixtureCase(async dir=>{const subject=addSubject(dir),result=addClosure(dir,'PPQR-001',subject,{extraPath:'src/closure-code.txt'}),evidence=await trusted(result.program,dir,result.closure,subject);assert(hasCode(completionDiagnostics(result.program.tasks[0],evidence.context),'PQG_COMPLETION_CLOSURE_SCOPE_INVALID'),'closure scope regression')});
  await fixtureCase(async dir=>{const subject=addSubject(dir),result=addClosure(dir,'PPQR-001',subject,{multiple:true}),evidence=await trusted(result.program,dir,result.closure,subject);assert(hasCode(completionDiagnostics(result.program.tasks[0],evidence.context),'PQG_COMPLETION_TRANSITION_INVALID'),'multiple transition accepted')});
  await fixtureCase(async dir=>{const subject=addSubject(dir),result=addClosure(dir,'PPQR-001',subject);writeFileSync(path.join(dir,'README.md'),'descendant\n');const descendant=commitAll(dir,'ordinary descendant'),evidence=await trusted(result.program,dir,descendant,subject);assert((await validateProgram(result.program,evidence.context)).length===0,'descendant preservation regressed')});
  await fixtureCase(async dir=>{const subject=addSubject(dir),result=addClosure(dir,'PPQR-001',subject),drift=clone(result.program);drift.tasks[0].purpose=[...drift.tasks[0].purpose,'drift'];writeRepoState(dir,drift,result.status);const descendant=commitAll(dir,'completion drift'),evidence=await trusted(drift,dir,descendant,subject);assert(hasCode(completionDiagnostics(drift.tasks[0],evidence.context),'PQG_COMPLETION_HISTORY_DRIFT'),'history drift accepted')});
  const localTask={task_id:'PPQR-001',state:'complete',completion_validation:claim('a'.repeat(40),'local',null)};assert(hasCode(completionDiagnostics(localTask,{trusted:false,repository:REPO,completions:{}}),'PQG_COMPLETION_EVIDENCE_NOT_AUTHORITATIVE'),'local evidence unlocked completion');
  const wrongRunTask={task_id:'PPQR-001',state:'complete',completion_validation:claim()};assert(hasCode(completionDiagnostics(wrongRunTask,completionContext(canonicalEvidence('a'.repeat(40),123,{workflow_run:{head_sha:'b'.repeat(40)}}))),'PQG_COMPLETION_RUN_SHA_MISMATCH'),'wrong run SHA accepted');
  pass('T-CLOSURE-REGRESSION-001','closure scope, transitions, run binding, local evidence, descendants and drift preserved');
}
{
  for(const value of [null,[],'text',7,true]){assert(hasCode(await validateProgram(value,{}),'PQG_SCHEMA_INVALID'),'invalid root accepted');assert(hasCode(validateStatus(value,next,{}),'PQG_SCHEMA_INVALID'),'invalid status root accepted')}
  const missing=clone(base);delete missing.tasks[0].completion_validation;assert(hasCode(await validateProgram(missing,{}),'PQG_SCHEMA_INVALID'),'required completion field omitted');
  const statusMissing=mutateStatus(next,value=>{delete value.last_completed_task});assert(hasCode(validateStatus(base,statusMissing,{}),'PQG_STATUS_INVALID'),'required status field omitted');
  const map=taskMap(base);for(const [id,deps] of Object.entries(DEPS))assert(JSON.stringify(map.get(id).depends_on)===JSON.stringify(deps),`graph mismatch ${id}`);const graph=clone(base);graph.tasks.find(task=>task.task_id==='PPQR-004').depends_on=[];assert(hasCode(await validateProgram(graph,{}),'PQG_TASK_REGISTRY_INVALID'),'graph mutation accepted');
  pass('T-ROOT-SCHEMA-GRAPH-001','root guards, required fields and exact PPQR graph preserved');
}
{
  for(const key of ['peac:verify-artifact','peac:review-artifact','peac:runtime-authority-test','peac:runtime-cli-help'])assert(canonicalPackage.scripts[key],`missing ${key}`);
  assert(canonicalPackage.scripts['peac:smoke'].includes('--mode ci'),'smoke mode regressed');assert(canonicalPackage.scripts.ci.includes('peac:runtime-authority-test'),'Runtime Authority stage missing');
  for(const needle of ['INSPECTOR_SOURCE','Verify vendored pinned inspector identity','Renderer Node ${{ matrix.node-version }} exact-head'])assert(canonicalWorkflowText.includes(needle),`consumer control missing: ${needle}`);
  assert(evaluateCanonicalProfile(canonicalPackage,canonicalWorkflow).status==='valid','current repository no longer matches owned profile');
  pass('T-RUNTIME-PRESERVATION-001','Runtime Authority, renderer, bundle, smoke and consumer controls preserved');
}

const required=['T-PROFILE-001','T-PROFILE-002','T-PROFILE-003','T-PROFILE-004','T-PROFILE-005','T-PROFILE-006','T-MERGE-001','T-MERGE-002','T-MERGE-003','T-SUBJECT-001','T-CLOSURE-REGRESSION-001','T-ROOT-SCHEMA-GRAPH-001','T-RUNTIME-PRESERVATION-001'];
for(const id of required)assert(seen.has(id),`required focused test missing: ${id}`);
console.log(`Prompt Quality v2 profile/merge self-test passed. focused_cases=${passed} external_live_evidence=NOT_APPLICABLE completed_tasks=none`);
