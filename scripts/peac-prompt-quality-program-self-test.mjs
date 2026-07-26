#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {N,P,REPO,json,txt} from './prompt-quality-program/core.mjs';
import {CANONICAL_WORKFLOW,COMPLETION_PROFILE,deriveCompletionClosure,loadTrustedCompletionEvidence} from './prompt-quality-program/evidence.mjs';
import {DEPS,completionDiagnostics,eligibility,taskMap,validateProgram,validateStatus} from './prompt-quality-program/program.mjs';

const base=json(P),next=txt(N),clone=value=>structuredClone(value);
let passed=0;const seen=new Set();
function pass(id,message){if(seen.has(id))throw new Error(`duplicate test id ${id}`);seen.add(id);passed++;console.log(`${id} PASS: ${message}`)}
function assert(condition,message){if(!condition)throw new Error(message)}
function hasCode(diagnostics,code){return diagnostics.some(item=>item.code===code)}
function claim(sha='a'.repeat(40),source='github_actions',runId=123){
  return{validation_status:'passed',tested_commit:sha,source,validation_profile:COMPLETION_PROFILE,ci_run_reference:source==='github_actions'?runId:null};
}
function complete(program,taskId,sha,runId=123,source='github_actions'){
  const task=program.tasks.find(item=>item.task_id===taskId);
  task.state='complete';task.completion_validation=claim(sha,source,runId);return task;
}
function statusText(mutator){
  const match=next.match(/<!-- prompt-quality-status:start -->\s*```json\s*([\s\S]*?)\s*```/);
  const status=JSON.parse(match[1]);mutator(status);
  return next.replace(match[1],JSON.stringify(status,null,2));
}
function git(dir,...args){return String(execFileSync('git',args,{cwd:dir,encoding:'utf8'})).trim()}
function writeRepoState(dir,program,status){
  mkdirSync(path.join(dir,path.dirname(P)),{recursive:true});
  mkdirSync(path.join(dir,path.dirname(N)),{recursive:true});
  writeFileSync(path.join(dir,P),JSON.stringify(program));
  writeFileSync(path.join(dir,N),status);
}
function commitAll(dir,message){git(dir,'add','.');git(dir,'commit','-qm',message);return git(dir,'rev-parse','HEAD')}
function initRepo(){
  const dir=mkdtempSync(path.join(tmpdir(),'pp31-closure-'));
  git(dir,'init','-q');git(dir,'config','user.email','fixture@example.invalid');git(dir,'config','user.name','PP31 Fixture');
  writeRepoState(dir,base,next);writeFileSync(path.join(dir,'README.md'),'baseline\n');commitAll(dir,'baseline');
  return dir;
}
function addSubject(dir,name='subject'){
  mkdirSync(path.join(dir,'src'),{recursive:true});writeFileSync(path.join(dir,'src',`${name}.txt`),`${name}\n`);
  return commitAll(dir,name);
}
function addClosure(dir,taskId,subject,{runId=123,extraPath=null,multiple=false}={}){
  const program=clone(base);complete(program,taskId,subject,runId);
  if(multiple)complete(program,'PPQR-003',subject,runId);
  const status=statusText(value=>{
    value.current_task='PPQR-002';value.task_status='not_started';value.blocked_by=[];
    value.last_completed_task=taskId;value.next_action='Continue with the next eligible Task.';
  });
  writeRepoState(dir,program,status);
  if(extraPath){mkdirSync(path.join(dir,path.dirname(extraPath)),{recursive:true});writeFileSync(path.join(dir,extraPath),'unauthorized\n')}
  const closure=commitAll(dir,'completion closure');
  return{program,status,closure};
}
function mockFetch(subject,{runId=123,runOverrides={},jobOverrides={},extraRuns=[]}={}){
  return async url=>{
    const ok=data=>({ok:true,status:200,json:async()=>data});
    if(url.includes(`/actions/workflows/${CANONICAL_WORKFLOW.id}/runs`)){
      const run={id:runId,repository:{full_name:REPO},workflow_id:CANONICAL_WORKFLOW.id,name:CANONICAL_WORKFLOW.name,status:'completed',conclusion:'success',head_sha:subject,...runOverrides};
      return ok({workflow_runs:[run,...extraRuns]});
    }
    if(url.includes(`/actions/runs/${runId}/jobs`)){
      return ok({jobs:[{name:CANONICAL_WORKFLOW.job,status:'completed',conclusion:'success',...jobOverrides}]});
    }
    for(const run of extraRuns)if(url.includes(`/actions/runs/${run.id}/jobs`)){
      return ok({jobs:[{name:CANONICAL_WORKFLOW.job,status:'completed',conclusion:'success'}]});
    }
    return{ok:false,status:404,json:async()=>({})};
  };
}
async function trusted(program,dir,head,subject,options={}){
  return loadTrustedCompletionEvidence(program,{
    cwd:dir,
    env:{TESTED_SHA:head,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:REPO,GITHUB_TOKEN:'test'},
    fetchImpl:mockFetch(subject,options)
  });
}
async function expectCode(id,task,context,code){
  const diagnostics=completionDiagnostics(task,context);
  assert(hasCode(diagnostics,code),`${id} expected ${code}: ${JSON.stringify(diagnostics)}`);
  pass(id,code);
}

{
  const evidence=await loadTrustedCompletionEvidence(base,{env:{},cwd:process.cwd()});
  const diagnostics=[...await validateProgram(base,evidence.context),...validateStatus(base,next,evidence.context)];
  assert(diagnostics.length===0,`baseline failed: ${JSON.stringify(diagnostics)}`);
  assert(evidence.completedTaskIds.length===0&&evidence.externalApiCalls===0,'no-completion baseline must not acquire external evidence');
}
{
  const pkg=JSON.parse(readFileSync('package.json','utf8')),workflow=readFileSync('.github/workflows/ci.yml','utf8');
  for(const key of ['peac:verify-artifact','peac:review-artifact','peac:runtime-authority-test','peac:runtime-cli-help'])assert(pkg.scripts[key],`missing ${key}`);
  assert(pkg.scripts['peac:smoke'].includes('--mode ci'),'smoke mode regressed');
  assert(pkg.scripts.ci.includes('peac:runtime-authority-test'),'runtime authority stage missing');
  for(const needle of ['INSPECTOR_SOURCE','Verify vendored pinned inspector identity','Renderer Node ${{ matrix.node-version }} exact-head'])assert(workflow.includes(needle),`workflow control missing: ${needle}`);
  pass('T-PRESERVE-001','Runtime Authority and consumer controls preserved');
}
{
  for(const value of [null,[],'text',7,true]){
    assert(hasCode(await validateProgram(value,{}),'PQG_SCHEMA_INVALID'),'invalid program root accepted');
    assert(hasCode(validateStatus(value,next,{}),'PQG_SCHEMA_INVALID'),'invalid status root accepted');
  }
  pass('T-ROOT-001','non-object roots reject before dereference');
}
{
  const missing=clone(base);delete missing.tasks[0].completion_validation;
  assert(hasCode(await validateProgram(missing,{}),'PQG_SCHEMA_INVALID'),'missing completion_validation accepted');
  const text=statusText(value=>{delete value.last_completed_task});
  assert(hasCode(validateStatus(base,text,{}),'PQG_STATUS_INVALID'),'missing last_completed_task accepted');
  pass('T-SCHEMA-001','required Task and status fields preserved');
}
{
  const map=taskMap(base);
  for(const [id,deps] of Object.entries(DEPS))assert(JSON.stringify(map.get(id).depends_on)===JSON.stringify(deps),`graph mismatch ${id}`);
  const mutated=clone(base);mutated.tasks.find(task=>task.task_id==='PPQR-004').depends_on=[];
  assert(hasCode(await validateProgram(mutated,{}),'PQG_TASK_REGISTRY_INVALID'),'graph mutation accepted');
  pass('T-GRAPH-001','exact PPQR graph preserved');
}
{
  const program=clone(base),task=complete(program,'PPQR-001','a'.repeat(40));
  task.completion_validation.commands=['pnpm run ci'];delete task.completion_validation.validation_profile;
  assert(hasCode(await validateProgram(program,{}),'PQG_SCHEMA_INVALID'),'arbitrary command strings retained authority');
  pass('T-COMMAND-001','completion uses fixed validation profile, not command strings');
}

async function fixtureCase(build){
  const dir=initRepo();
  try{return await build(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}

await fixtureCase(async dir=>{
  const old=addSubject(dir,'old-success');const subject=addSubject(dir,'actual-subject');
  const {program,closure}=addClosure(dir,'PPQR-001',old);
  const evidence=await trusted(program,dir,closure,subject);
  await expectCode('T-CLOSURE-001',program.tasks[0],evidence.context,'PQG_COMPLETION_SUBJECT_NOT_PARENT');
});
await fixtureCase(async dir=>{
  const subject=addSubject(dir);const {program,closure}=addClosure(dir,'PPQR-001',subject);
  const evidence=await trusted(program,dir,closure,subject);
  const diagnostics=await validateProgram(program,evidence.context);
  assert(diagnostics.length===0,JSON.stringify(diagnostics));
  assert(eligibility(taskMap(program).get('PPQR-002'),taskMap(program),evidence.context)==='eligible','valid closure did not unlock dependency');
  pass('T-CLOSURE-002','direct metadata-only closure accepted');
  pass('T-EVIDENCE-002','loadTrustedCompletionEvidence positive path accepted');
});
await fixtureCase(async dir=>{
  const claimed=addSubject(dir,'claimed-subject');writeFileSync(path.join(dir,'notes.txt'),'intervening\n');const actual=commitAll(dir,'intervening');
  const {program,closure}=addClosure(dir,'PPQR-001',claimed);
  const evidence=await trusted(program,dir,closure,actual);
  await expectCode('T-CLOSURE-003',program.tasks[0],evidence.context,'PQG_COMPLETION_SUBJECT_NOT_PARENT');
});
await fixtureCase(async dir=>{
  const subject=addSubject(dir);const {program,closure}=addClosure(dir,'PPQR-001',subject,{extraPath:'src/closure-code.txt'});
  const evidence=await trusted(program,dir,closure,subject);
  await expectCode('T-CLOSURE-004',program.tasks[0],evidence.context,'PQG_COMPLETION_CLOSURE_SCOPE_INVALID');
});
await fixtureCase(async dir=>{
  const subject=addSubject(dir);const {program,closure}=addClosure(dir,'PPQR-001',subject,{multiple:true});
  const evidence=await trusted(program,dir,closure,subject);
  await expectCode('T-CLOSURE-005',program.tasks[0],evidence.context,'PQG_COMPLETION_TRANSITION_INVALID');
});
await fixtureCase(async dir=>{
  const subject=addSubject(dir);const {program,closure}=addClosure(dir,'PPQR-001',subject);
  writeFileSync(path.join(dir,'README.md'),'descendant\n');const descendant=commitAll(dir,'ordinary descendant');
  const evidence=await trusted(program,dir,descendant,subject);
  const diagnostics=await validateProgram(program,evidence.context);
  assert(diagnostics.length===0,JSON.stringify(diagnostics));
  pass('T-CLOSURE-006','valid completion preserved on descendant');
});
await fixtureCase(async dir=>{
  const subject=addSubject(dir);const {program}=addClosure(dir,'PPQR-001',subject);
  const drift=clone(program);drift.tasks[0].purpose=[...drift.tasks[0].purpose,'drift'];
  writeRepoState(dir,drift,statusText(value=>{value.current_task='PPQR-002';value.task_status='not_started';value.blocked_by=[];value.last_completed_task='PPQR-001';value.next_action='Continue with the next eligible Task.';}));
  const descendant=commitAll(dir,'mutate completed Task');
  const evidence=await trusted(drift,dir,descendant,subject);
  await expectCode('T-CLOSURE-007',drift.tasks[0],evidence.context,'PQG_COMPLETION_HISTORY_DRIFT');
});

{
  const task={task_id:'PPQR-001',state:'complete',completion_validation:claim('a'.repeat(40),'local',null)};
  const context={trusted:false,repository:REPO,completions:{}};
  await expectCode('T-EVIDENCE-003',task,context,'PQG_COMPLETION_EVIDENCE_NOT_AUTHORITATIVE');
}
{
  const task={task_id:'PPQR-001',state:'complete',completion_validation:claim('a'.repeat(40))};
  const baseEvidence={
    repository:REPO,history_available:true,transition_count:1,closure_parent_count:1,
    closure_is_ancestor_of_validation_head:true,subject_commit:'a'.repeat(40),subject_commit_exists:true,
    subject_task_was_complete:false,transitioned_task_ids:['PPQR-001'],closure_scope_valid:true,
    subject_has_non_closure_change:true,history_drift:false,accepted_run_count:1,
    workflow_run:{run_id:123,repository:REPO,workflow_id:CANONICAL_WORKFLOW.id,workflow_name:CANONICAL_WORKFLOW.name,status:'completed',conclusion:'success',head_sha:'a'.repeat(40),jobs:[{name:CANONICAL_WORKFLOW.job,status:'completed',conclusion:'success'}]}
  };
  const cases=[
    [{...baseEvidence,repository:'other/repo'},'PQG_COMPLETION_REPOSITORY_MISMATCH'],
    [{...baseEvidence,workflow_run:{...baseEvidence.workflow_run,workflow_id:1}},'PQG_COMPLETION_WORKFLOW_INVALID'],
    [{...baseEvidence,workflow_run:{...baseEvidence.workflow_run,head_sha:'b'.repeat(40)}},'PQG_COMPLETION_RUN_SHA_MISMATCH'],
    [{...baseEvidence,workflow_run:{...baseEvidence.workflow_run,status:'queued',conclusion:null}},'PQG_COMPLETION_RUN_INCOMPLETE'],
    [{...baseEvidence,workflow_run:{...baseEvidence.workflow_run,conclusion:'failure'}},'PQG_COMPLETION_RUN_FAILED'],
    [{...baseEvidence,workflow_run:{...baseEvidence.workflow_run,jobs:[]}},'PQG_COMPLETION_JOB_MISSING']
  ];
  for(const [entry,code] of cases){
    const context={trusted:true,repository:REPO,completions:{'PPQR-001':entry}};
    assert(hasCode(completionDiagnostics(task,context),code),`missing ${code}`);
  }
  pass('T-EVIDENCE-001','repository, workflow, job, status, conclusion and SHA mismatches reject');
}

const required=['T-CLOSURE-001','T-CLOSURE-002','T-CLOSURE-003','T-CLOSURE-004','T-CLOSURE-005','T-CLOSURE-006','T-CLOSURE-007','T-EVIDENCE-001','T-EVIDENCE-002','T-EVIDENCE-003','T-COMMAND-001','T-ROOT-001','T-SCHEMA-001','T-GRAPH-001','T-PRESERVE-001'];
for(const id of required)assert(seen.has(id),`required focused test missing: ${id}`);
console.log(`Prompt Quality v2 closure self-test passed. focused_cases=${passed} external_live_evidence=NOT_APPLICABLE completed_tasks=none`);
