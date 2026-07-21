#!/usr/bin/env node
import {N,P,json,txt} from './prompt-quality-program/core.mjs';
import {eligibility,taskMap,validateProgram,validateStatus} from './prompt-quality-program/program.mjs';

const args=new Set(process.argv.slice(2));
const supported=new Set(['--all','--program','--status']);
const unknown=[...args].filter(arg=>!supported.has(arg));
if(unknown.length){console.error(`Unsupported Prompt Quality governance argument(s): ${unknown.join(', ')}`);process.exit(2)}
const program=json(P),runProgram=args.size===0||args.has('--all')||args.has('--program'),runStatus=args.size===0||args.has('--all')||args.has('--status');
const diagnostics=[];
if(runProgram)diagnostics.push(...await validateProgram(program));
if(runStatus)diagnostics.push(...validateStatus(program,txt(N)));
const unique=[...new Map(diagnostics.map(item=>[`${item.code}:${item.source}:${item.message}`,item])).values()];
if(unique.length){
  console.error(`Prompt Quality program consistency validation failed with ${unique.length} diagnostic(s).`);
  for(const item of unique)console.error(`${item.code} | ${item.source} | ${item.message}`);
  process.exit(1);
}
const map=taskMap(program),eligible=(program.tasks||[]).filter(task=>eligibility(task,map)==='eligible').map(task=>task.task_id);
console.log(`Prompt Quality program consistency validation passed. tasks=${program.tasks.length} eligible=${eligible.join(',')||'none'} status_authority=${program.status_authority} external_api_calls=0`);
