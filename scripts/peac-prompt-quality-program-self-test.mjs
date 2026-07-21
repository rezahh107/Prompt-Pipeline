#!/usr/bin/env node
import {N,P,json,txt} from './prompt-quality-program/core.mjs';
import {validateProgram,validateStatus} from './prompt-quality-program/program.mjs';

const base=json(P),next=txt(N);let passed=0;
const clone=value=>structuredClone(value);
async function expectProgram(name,mutate,code){
  const value=clone(base);mutate(value);const diagnostics=await validateProgram(value);
  if(!diagnostics.some(item=>item.code===code))throw new Error(`${name} did not emit ${code}: ${JSON.stringify(diagnostics)}`);
  passed++;console.log(`program consistency mutation PASS: ${name}`);
}
function expectStatus(name,text,code){
  const diagnostics=validateStatus(base,text);
  if(!diagnostics.some(item=>item.code===code))throw new Error(`${name} did not emit ${code}: ${JSON.stringify(diagnostics)}`);
  passed++;console.log(`status consistency mutation PASS: ${name}`);
}
const valid=[...await validateProgram(base),...validateStatus(base,next)];
if(valid.length)throw new Error(`valid baseline failed: ${JSON.stringify(valid)}`);passed++;console.log('program consistency baseline PASS');
await expectProgram('duplicate Task ID',program=>{program.tasks[1].task_id='PPQR-001'},'PQG_TASK_REGISTRY_INVALID');
await expectProgram('approved dependency mutation',program=>{program.tasks.find(task=>task.task_id==='PPQR-004').depends_on=[]},'PQG_TASK_REGISTRY_INVALID');
await expectProgram('unknown dependency',program=>{program.tasks.find(task=>task.task_id==='PPQR-002').depends_on=['PPQR-999']},'PQG_DEPENDENCY_INVALID');
await expectProgram('dependency cycle',program=>{program.tasks.find(task=>task.task_id==='PPQR-001').depends_on=['PPQR-015']},'PQG_DEPENDENCY_INVALID');
await expectProgram('premature active Task',program=>{program.tasks.find(task=>task.task_id==='PPQR-002').state='active'},'PQG_TASK_STATE_INVALID');
await expectProgram('completion without validation',program=>{program.tasks.find(task=>task.task_id==='PPQR-001').state='complete'},'PQG_SCHEMA_INVALID');
await expectProgram('multiple active Tasks',program=>{program.tasks.find(task=>task.task_id==='PPQR-001').state='active';program.tasks.find(task=>task.task_id==='PPQR-003').state='active'},'PQG_MULTIPLE_ACTIVE_TASKS');
expectStatus('malformed status JSON',next.replace('"current_task": "PPQR-001"','"current_task":'), 'PQG_STATUS_INVALID');
expectStatus('unknown current Task',next.replace('"PPQR-001"','"PPQR-999"'),'PQG_STATUS_TASK_INVALID');
expectStatus('retired lifecycle field',next.replace('"next_action":', '"merge_state": "merged",\n  "next_action":'),'PQG_STATUS_INVALID');
expectStatus('empty next action',next.replace(/"next_action": ".*"/, '"next_action": ""'),'PQG_STATUS_INVALID');
if(passed!==12)throw new Error(`expected 12 cases, observed ${passed}`);
console.log(`Prompt Quality program consistency self-test passed. cases=${passed}`);
