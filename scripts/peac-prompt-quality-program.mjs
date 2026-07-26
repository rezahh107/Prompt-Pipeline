#!/usr/bin/env node
import {N,P,json,txt} from './prompt-quality-program/core.mjs';
import {loadTrustedCompletionEvidence} from './prompt-quality-program/evidence.mjs';
import {eligibility,taskMap,validateProgram,validateStatus} from './prompt-quality-program/program.mjs';

const args=new Set(process.argv.slice(2));
const supported=new Set(['--all','--program','--status']);
const unknown=[...args].filter(arg=>!supported.has(arg));
if(unknown.length){console.error(`Unsupported Prompt Quality governance argument(s): ${unknown.join(', ')}`);process.exit(2)}

let program;
try{program=json(P)}catch(error){
  console.error(`Prompt Quality program load failed: ${error?.message||error}`);
  process.exit(1);
}
const runProgram=args.size===0||args.has('--all')||args.has('--program');
const runStatus=args.size===0||args.has('--all')||args.has('--status');
const evidence=await loadTrustedCompletionEvidence(program);
const diagnostics=[];
if(runProgram)diagnostics.push(...await validateProgram(program,evidence.context));
if(runStatus)diagnostics.push(...validateStatus(program,txt(N),evidence.context));
const unique=[...new Map(diagnostics.map(item=>[`${item.code}:${item.source}:${item.message}`,item])).values()];
if(unique.length){
  console.error(`Prompt Quality program consistency validation failed with ${unique.length} diagnostic(s).`);
  for(const item of unique)console.error(`${item.code} | ${item.source} | ${item.message}`);
  process.exit(1);
}
const map=taskMap(program),eligible=(program.tasks||[]).filter(task=>eligibility(task,map,evidence.context)==='eligible').map(task=>task.task_id);
console.log(`Prompt Quality program consistency validation passed. tasks=${program.tasks.length} eligible=${eligible.join(',')||'none'} status_authority=${program.status_authority} completed_tasks=${evidence.completedTaskIds.join(',')||'none'} external_api_calls=${evidence.externalApiCalls}`);
