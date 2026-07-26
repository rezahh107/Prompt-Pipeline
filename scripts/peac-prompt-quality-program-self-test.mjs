#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {N,P,REPO,json,txt} from './prompt-quality-program/core.mjs';
import {inspectGitCommit,loadTrustedCompletionEvidence} from './prompt-quality-program/evidence.mjs';
import {ALLOWED_WORKFLOW,DEPS,completionDiagnostics,eligibility,taskMap,validateProgram,validateStatus} from './prompt-quality-program/program.mjs';

const base=json(P),next=txt(N),clone=value=>structuredClone(value);
let passed=0;
const seen=new Set();

function pass(id,message){
  if(seen.has(id))throw new Error(`duplicate test id ${id}`);
  seen.add(id);passed++;console.log(`${id} PASS: ${message}`);
}
function assert(condition,message){if(!condition)throw new Error(message)}
function hasCode(diagnostics,code){return diagnostics.some(item=>item.code===code)}

function claim(sha='a'.repeat(40),source='github_actions',runId=123){
  return{validation_status:'passed',tested_commit:sha,source,commands:['pnpm run ci'],ci_run_reference:source==='github_actions'?runId:null};
}
function completeFirst(program,sha='a'.repeat(40),source='github_actions',runId=123){
  const task=program.tasks.find(item=>item.task_id==='PPQR-001');
  task.state='complete';task.completion_validation=claim(sha,source,runId);
  return task;
}
function positiveContext(sha='a'.repeat(40),runId=123,overrides={}){
  const job={name:ALLOWED_WORKFLOW.job,status:'completed',conclusion:'success'};
  const entry={
    repository:REPO,tested_commit:sha,commit_exists:true,is_ancestor_of_validation_head:true,
    workflow_run:{
      run_id:runId,repository:REPO,workflow_id:ALLOWED_WORKFLOW.id,workflow_name:ALLOWED_WORKFLOW.name,
      status:'completed',conclusion:'success',head_sha:sha,jobs:[job]
    }
  };
  const merged={...entry,...overrides};
  if(overrides.workflow_run)merged.workflow_run={...entry.workflow_run,...overrides.workflow_run};
  return{trusted:true,repository:REPO,validation_head:'b'.repeat(40),completions:{'PPQR-001':merged}};
}
function replaceStatus(mutator){
  const match=next.match(/<!-- prompt-quality-status:start -->\s*```json\s*([\s\S]*?)\s*```/);
  const status=JSON.parse(match[1]);mutator(status);
  return next.replace(match[1],JSON.stringify(status,null,2));
}

async function expectProgramCode(id,mutate,code,context={}){
  const program=clone(base);mutate(program);
  const diagnostics=await validateProgram(program,context);
  assert(hasCode(diagnostics,code),`${id} expected ${code}: ${JSON.stringify(diagnostics)}`);
  pass(id,code);
}
function expectStatusCode(id,text,code,program=base,context={}){
  const diagnostics=validateStatus(program,text,context);
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
  assert(pkg.scripts.ci.includes('peac:runtime-authority-test'),'runtime authority stage missing from ci');
  for(const needle of ['INSPECTOR_SOURCE','Verify vendored pinned inspector identity','Renderer Node ${{ matrix.node-version }} exact-head'])assert(workflow.includes(needle),`workflow control missing: ${needle}`);
  pass('T-INT-001','current-main Runtime Authority and CI controls preserved');
}
{
  assert(base.status_authority===N,'v2 status authority mismatch');
  assert(next.includes('PR #29')&&next.includes('PR #32')&&next.includes('PR #33'),'repository facts missing');
  assert(next.includes('repository_implementation_assurance_lite'),'Assurance Lite registration missing');
  const blocks=[...next.matchAll(/<!-- prompt-quality-status:start -->/g)];
  assert(blocks.length===1,'more than one mutable status block');
  pass('T-INT-002','one coherent v2 status authority with preserved facts');
}

{
  for(const value of [null,[], 'text', 7, true]){
    const p=await validateProgram(value,{});
    const s=validateStatus(value,next,{});
    assert(hasCode(p,'PQG_SCHEMA_INVALID')&&hasCode(s,'PQG_SCHEMA_INVALID'),`invalid root escaped: ${JSON.stringify(value)}`);
  }
  pass('T-ROOT-001','null, arrays and primitives reject before dereference');
}
await expectProgramCode('T-ROOT-002',program=>{delete program.tasks[0].completion_validation},'PQG_SCHEMA_INVALID');
expectStatusCode('T-ROOT-003',replaceStatus(status=>{delete status.last_completed_task}),'PQG_STATUS_INVALID');

{
  const map=taskMap(base);
  for(const [id,deps] of Object.entries(DEPS))assert(JSON.stringify(map.get(id).depends_on)===JSON.stringify(deps),`graph mismatch ${id}`);
  const mutated=clone(base);mutated.tasks.find(task=>task.task_id==='PPQR-004').depends_on=[];
  const diagnostics=await validateProgram(mutated,{});
  assert(hasCode(diagnostics,'PQG_TASK_REGISTRY_INVALID'),'graph mutation accepted');
  pass('T-GRAPH-001','exact PPQR registry and dependency graph preserved');
}

{
  const program=clone(base),task=completeFirst(program,'1'.repeat(40));
  const context=positiveContext('1'.repeat(40),123,{commit_exists:false});
  const diagnostics=completionDiagnostics(task,context);
  assert(hasCode(diagnostics,'PQG_COMPLETION_COMMIT_NOT_FOUND'),JSON.stringify(diagnostics));
  pass('T-EVID-001','nonexistent completion SHA rejected');
}
{
  const program=clone(base);completeFirst(program,'2'.repeat(40),'local');
  const context={trusted:false,repository:REPO,validation_head:'3'.repeat(40),completions:{}};
  const diagnostics=await validateProgram(program,context);
  const map=taskMap(program),second=map.get('PPQR-002');
  assert(hasCode(diagnostics,'PQG_COMPLETION_EVIDENCE_NOT_AUTHORITATIVE'),'local claim became authoritative');
  assert(eligibility(second,map,context)==='dependency_blocked','local claim unlocked dependent Task');
  pass('T-EVID-003','local-only completion cannot unlock dependencies');
}
{
  const program=clone(base),task=completeFirst(program,'4'.repeat(40));
  const context=positiveContext('4'.repeat(40),123,{workflow_run:{head_sha:'5'.repeat(40)}});
  const diagnostics=completionDiagnostics(task,context);
  assert(hasCode(diagnostics,'PQG_COMPLETION_RUN_SHA_MISMATCH'),JSON.stringify(diagnostics));
  pass('T-EVID-004','run and tested-SHA mismatch rejected');
}
{
  const sha='6'.repeat(40),program=clone(base),task=completeFirst(program,sha);
  const cases=[
    [{trusted:true,repository:REPO,validation_head:'7'.repeat(40),completions:{}},'PQG_COMPLETION_EVIDENCE_MISSING'],
    [positiveContext(sha,123,{unavailable_reason:'github_api_http_403'}),'PQG_COMPLETION_EVIDENCE_UNAVAILABLE'],
    [positiveContext(sha,123,{workflow_run:{status:'queued',conclusion:null}}),'PQG_COMPLETION_RUN_INCOMPLETE'],
    [positiveContext(sha,123,{workflow_run:{status:'completed',conclusion:'failure'}}),'PQG_COMPLETION_RUN_FAILED'],
    [positiveContext(sha,123,{workflow_run:{jobs:[]}}),'PQG_COMPLETION_JOB_MISSING'],
    [positiveContext(sha,123,{workflow_run:{jobs:[{name:ALLOWED_WORKFLOW.job,status:'queued',conclusion:null}]}}),'PQG_COMPLETION_JOB_INCOMPLETE'],
    [positiveContext(sha,123,{workflow_run:{jobs:[{name:ALLOWED_WORKFLOW.job,status:'completed',conclusion:'failure'}]}}),'PQG_COMPLETION_JOB_FAILED']
  ];
  for(const [context,code] of cases)assert(hasCode(completionDiagnostics(task,context),code),`missing ${code}`);
  pass('T-EVID-005','missing, unavailable, incomplete and failed evidence rejects');
}
{
  const sha='8'.repeat(40),program=clone(base);completeFirst(program,sha);
  const context=positiveContext(sha);
  const diagnostics=await validateProgram(program,context),map=taskMap(program);
  assert(diagnostics.length===0,`valid evidence rejected: ${JSON.stringify(diagnostics)}`);
  assert(eligibility(map.get('PPQR-002'),map,context)==='eligible','verified completion did not unlock dependency');
  pass('T-EVID-006','exact matching canonical evidence accepted');
}

{
  const dir=mkdtempSync(path.join(tmpdir(),'pp31-evidence-'));
  try{
    const git=(...args)=>String(execFileSync('git',args,{cwd:dir,encoding:'utf8'})).trim();
    git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','PP31 Fixture');
    writeFileSync(path.join(dir,'f'),'a');git('add','f');git('commit','-qm','ancestor');const ancestor=git('rev-parse','HEAD');
    writeFileSync(path.join(dir,'f'),'b');git('commit','-qam','descendant');const descendant=git('rev-parse','HEAD');
    git('checkout','--orphan','unrelated','-q');git('rm','-rf','-q','.');writeFileSync(path.join(dir,'u'),'u');git('add','u');git('commit','-qm','unrelated');const unrelated=git('rev-parse','HEAD');
    git('checkout','-q',descendant);

    const bad=inspectGitCommit(unrelated,descendant,{cwd:dir});
    const badProgram=clone(base),badTask=completeFirst(badProgram,unrelated);
    const badContext=positiveContext(unrelated,123,{commit_exists:bad.commit_exists,is_ancestor_of_validation_head:bad.is_ancestor_of_validation_head});
    assert(hasCode(completionDiagnostics(badTask,badContext),'PQG_COMPLETION_COMMIT_NOT_ANCESTOR'),'unrelated commit accepted');
    pass('T-EVID-002','real unrelated commit rejected');

    const good=inspectGitCommit(ancestor,descendant,{cwd:dir});
    const goodProgram=clone(base);completeFirst(goodProgram,ancestor);
    const goodContext=positiveContext(ancestor,123,{commit_exists:good.commit_exists,is_ancestor_of_validation_head:good.is_ancestor_of_validation_head});
    const diagnostics=await validateProgram(goodProgram,goodContext);
    assert(diagnostics.length===0,`ancestor completion rejected: ${JSON.stringify(diagnostics)}`);
    pass('T-EVID-007','verified historical completion preserved on descendant Head');
  }finally{rmSync(dir,{recursive:true,force:true})}
}

const required=['T-INT-001','T-INT-002','T-EVID-001','T-EVID-002','T-EVID-003','T-EVID-004','T-EVID-005','T-EVID-006','T-EVID-007','T-ROOT-001','T-ROOT-002','T-ROOT-003','T-GRAPH-001'];
for(const id of required)assert(seen.has(id),`required focused test missing: ${id}`);
console.log(`Prompt Quality v2 self-test passed. focused_cases=${passed} external_live_evidence=NOT_APPLICABLE completed_tasks=none`);
