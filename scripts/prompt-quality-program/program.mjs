import {MODEL,N,P,PID,PS,REPO,d,eq,json,schema,txt,uniq} from './core.mjs';

export const IDS=Array.from({length:15},(_,index)=>`PPQR-${String(index+1).padStart(3,'0')}`);
export const DEPS={
  'PPQR-001':[],
  'PPQR-002':['PPQR-001'],
  'PPQR-003':['PPQR-001'],
  'PPQR-004':['PPQR-003'],
  'PPQR-005':['PPQR-003','PPQR-004'],
  'PPQR-006':['PPQR-001','PPQR-003','PPQR-004','PPQR-005'],
  'PPQR-007':['PPQR-003','PPQR-004','PPQR-006'],
  'PPQR-008':['PPQR-006','PPQR-007'],
  'PPQR-009':['PPQR-006','PPQR-007','PPQR-008'],
  'PPQR-010':['PPQR-006','PPQR-007','PPQR-008','PPQR-009'],
  'PPQR-011':['PPQR-002','PPQR-006','PPQR-007','PPQR-008','PPQR-010'],
  'PPQR-012':['PPQR-011'],
  'PPQR-013':['PPQR-009','PPQR-010','PPQR-012'],
  'PPQR-014':['PPQR-012','PPQR-013'],
  'PPQR-015':['PPQR-014']
};
export const taskMap=program=>new Map((program.tasks||[]).map(task=>[task.task_id,task]));
export const dependencyBlockers=(task,map)=>(task.depends_on||[]).filter(id=>map.get(id)?.state!=='complete').sort();
export const eligibility=(task,map)=>{
  if(task.state==='complete')return'complete';
  if(task.state==='active')return dependencyBlockers(task,map).length?'invalid':'active';
  if(task.state==='blocked')return'blocked';
  return dependencyBlockers(task,map).length?'dependency_blocked':'eligible';
};
function hasCycle(map){
  const seen=new Set(),stack=new Set();
  function visit(id){
    if(stack.has(id))return true;
    if(seen.has(id))return false;
    seen.add(id);stack.add(id);
    for(const dep of map.get(id)?.depends_on||[])if(map.has(dep)&&visit(dep))return true;
    stack.delete(id);return false;
  }
  return [...map.keys()].some(visit);
}
function statusBlock(text){
  const match=String(text).match(/<!-- prompt-quality-status:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- prompt-quality-status:end -->/);
  if(!match)return{error:d('PQG_STATUS_BLOCK_MISSING','bounded JSON status block missing',N)};
  try{return{value:JSON.parse(match[1])}}catch(error){return{error:d('PQG_STATUS_INVALID',`invalid JSON: ${error?.message||error}`,N)}}
}
export async function validateProgram(program=json(P),context={}){
  const z=[...await schema(PS,program,P)],map=taskMap(program),ids=(program.tasks||[]).map(task=>task.task_id);
  if(program.program_id!==PID||program.repository!==REPO||program.operating_model!==MODEL||program.status_authority!==N)z.push(d('PQG_PROGRAM_IDENTITY_INVALID','program identity, repository, operating model, or status authority differs from the approved model',P));
  if(ids.length!==IDS.length||new Set(ids).size!==ids.length||!eq(uniq(ids),uniq(IDS)))z.push(d('PQG_TASK_REGISTRY_INVALID','Task registry must contain exactly PPQR-001 through PPQR-015',P));
  for(const task of program.tasks||[]){
    const expected=DEPS[task.task_id];
    if(!expected||!eq(uniq(task.depends_on),uniq(expected)))z.push(d('PQG_TASK_REGISTRY_INVALID',`approved dependencies changed for ${task.task_id}`,task.task_id));
    if((task.depends_on||[]).includes(task.task_id)||(task.depends_on||[]).some(dep=>!map.has(dep)))z.push(d('PQG_DEPENDENCY_INVALID',`invalid dependency for ${task.task_id}`,task.task_id));
    const pending=dependencyBlockers(task,map);
    if(['active','complete'].includes(task.state)&&pending.length)z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} cannot be ${task.state} while dependencies are incomplete: ${pending.join(', ')}`,task.task_id));
    if(task.state==='complete'&&task.completion_validation?.validation_status!=='passed')z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} completion requires passed validation tied to a tested commit`,task.task_id));
    if(task.state!=='complete'&&task.completion_validation!==null)z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} has completion validation without complete state`,task.task_id));
    if(task.state==='blocked'&&!(task.blockers||[]).length)z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} blocked state requires an explicit blocker`,task.task_id));
  }
  if(hasCycle(map))z.push(d('PQG_DEPENDENCY_INVALID','dependency cycle detected',P));
  if((program.tasks||[]).filter(task=>task.state==='active').length>1)z.push(d('PQG_MULTIPLE_ACTIVE_TASKS','only one Task may be active',P));
  return z;
}
export function validateStatus(program=json(P),text=txt(N)){
  const parsed=statusBlock(text);if(parsed.error)return[parsed.error];
  const status=parsed.value,map=taskMap(program),allowed=['active_program','operating_model','current_task','task_status','blocked_by','last_completed_task','next_action'],z=[];
  if(Object.keys(status).some(key=>!allowed.includes(key)))z.push(d('PQG_STATUS_INVALID','status contains unsupported or retired lifecycle fields',N));
  if(status.active_program!==PID||status.operating_model!==MODEL)z.push(d('PQG_STATUS_INVALID','status identity does not match the active program and operating model',N));
  if(typeof status.current_task!=='string'||!map.has(status.current_task))return[...z,d('PQG_STATUS_TASK_INVALID','current_task must reference a registered Task',N)];
  const current=map.get(status.current_task),derived=eligibility(current,map),active=(program.tasks||[]).filter(task=>task.state==='active');
  if(active.length===1&&active[0].task_id!==status.current_task)z.push(d('PQG_STATUS_TASK_INVALID','current_task must be the active Task',N));
  if(!['eligible','active','blocked'].includes(derived))z.push(d('PQG_STATUS_TASK_INVALID',`${status.current_task} is not a current-work candidate: ${derived}`,N));
  if(status.task_status!==current.state)z.push(d('PQG_STATUS_TASK_INVALID','task_status differs from the machine-readable Task state',N));
  const expectedBlocked=current.state==='blocked'?uniq(current.blockers):dependencyBlockers(current,map);
  if(!Array.isArray(status.blocked_by)||!eq(uniq(status.blocked_by),expectedBlocked))z.push(d('PQG_STATUS_TASK_INVALID','blocked_by differs from explicit or dependency blockers',N));
  if(status.last_completed_task!==null&&map.get(status.last_completed_task)?.state!=='complete')z.push(d('PQG_STATUS_TASK_INVALID','last_completed_task must be null or a completed Task',N));
  if(typeof status.next_action!=='string'||!status.next_action.trim())z.push(d('PQG_STATUS_INVALID','next_action must be a non-empty string',N));
  return z;
}
