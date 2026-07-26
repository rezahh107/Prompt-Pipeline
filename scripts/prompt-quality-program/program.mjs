import {MODEL,N,P,PID,PS,REPO,d,eq,isRecord,json,schema,txt,uniq} from './core.mjs';

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

export const ALLOWED_WORKFLOW={id:302284939,name:'CI',job:'PEaC canonical exact-head CI'};

export const taskMap=program=>new Map((isRecord(program)&&Array.isArray(program.tasks)?program.tasks:[]).map(task=>[task.task_id,task]));

function completionDiagnostic(code,message,task){
  return d(code,message,task?.task_id||P);
}

export function completionDiagnostics(task,context={}){
  if(!isRecord(task)||task.state!=='complete')return[];
  const claim=task.completion_validation;
  if(!isRecord(claim))return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_MISSING','completed Task has no completion claim',task)];
  if(claim.source!=='github_actions')return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_NOT_AUTHORITATIVE','local-only completion evidence cannot authorize Task completion',task)];
  if(context?.trusted!==true)return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_NOT_AUTHORITATIVE','trusted GitHub Actions evidence context is unavailable',task)];
  if(context.repository!==REPO)return[completionDiagnostic('PQG_COMPLETION_REPOSITORY_MISMATCH','trusted evidence context belongs to another repository',task)];

  const evidence=context.completions?.[task.task_id];
  if(!isRecord(evidence))return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_MISSING','trusted completion evidence is missing',task)];
  if(evidence.repository!==REPO)return[completionDiagnostic('PQG_COMPLETION_REPOSITORY_MISMATCH','completion evidence belongs to another repository',task)];
  if(evidence.tested_commit!==claim.tested_commit)return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_MISMATCH','trusted evidence is bound to a different claimed commit',task)];
  if(evidence.commit_exists!==true)return[completionDiagnostic('PQG_COMPLETION_COMMIT_NOT_FOUND','claimed completion commit does not exist in this repository',task)];
  if(evidence.is_ancestor_of_validation_head!==true)return[completionDiagnostic('PQG_COMPLETION_COMMIT_NOT_ANCESTOR','claimed completion commit is not the validation Head or its ancestor',task)];
  if(evidence.unavailable_reason)return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_UNAVAILABLE',`trusted evidence unavailable: ${evidence.unavailable_reason}`,task)];

  const run=evidence.workflow_run;
  if(!isRecord(run))return[completionDiagnostic('PQG_COMPLETION_EVIDENCE_MISSING','canonical workflow-run evidence is missing',task)];
  if(run.repository!==REPO)return[completionDiagnostic('PQG_COMPLETION_REPOSITORY_MISMATCH','workflow run belongs to another repository',task)];
  if(run.run_id!==claim.ci_run_reference)return[completionDiagnostic('PQG_COMPLETION_RUN_REFERENCE_MISMATCH','workflow run does not match ci_run_reference',task)];
  if(run.workflow_id!==ALLOWED_WORKFLOW.id||run.workflow_name!==ALLOWED_WORKFLOW.name)return[completionDiagnostic('PQG_COMPLETION_WORKFLOW_INVALID','workflow identity is not the allowed canonical CI workflow',task)];
  if(run.status!=='completed')return[completionDiagnostic('PQG_COMPLETION_RUN_INCOMPLETE','canonical workflow run is not completed',task)];
  if(run.conclusion!=='success')return[completionDiagnostic('PQG_COMPLETION_RUN_FAILED',`canonical workflow run conclusion is ${run.conclusion||'missing'}`,task)];
  if(run.head_sha!==claim.tested_commit)return[completionDiagnostic('PQG_COMPLETION_RUN_SHA_MISMATCH','canonical workflow run Head SHA differs from the completion claim',task)];

  const job=(Array.isArray(run.jobs)?run.jobs:[]).find(item=>item?.name===ALLOWED_WORKFLOW.job);
  if(!job)return[completionDiagnostic('PQG_COMPLETION_JOB_MISSING','canonical CI job is missing from the workflow run',task)];
  if(job.status!=='completed')return[completionDiagnostic('PQG_COMPLETION_JOB_INCOMPLETE','canonical CI job is not completed',task)];
  if(job.conclusion!=='success')return[completionDiagnostic('PQG_COMPLETION_JOB_FAILED',`canonical CI job conclusion is ${job.conclusion||'missing'}`,task)];
  return[];
}

export const isAuthoritativelyComplete=(task,context={})=>isRecord(task)&&task.state==='complete'&&completionDiagnostics(task,context).length===0;

export const dependencyBlockers=(task,map,context={})=>(task?.depends_on||[])
  .filter(id=>!isAuthoritativelyComplete(map.get(id),context))
  .sort();

export const eligibility=(task,map,context={})=>{
  if(!isRecord(task))return'invalid';
  if(task.state==='complete')return isAuthoritativelyComplete(task,context)?'complete':'invalid';
  if(task.state==='active')return dependencyBlockers(task,map,context).length?'invalid':'active';
  if(task.state==='blocked')return'blocked';
  return dependencyBlockers(task,map,context).length?'dependency_blocked':'eligible';
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
  try{
    const value=JSON.parse(match[1]);
    if(!isRecord(value))return{error:d('PQG_STATUS_INVALID','bounded status must be a JSON object',N)};
    return{value};
  }catch(error){
    return{error:d('PQG_STATUS_INVALID',`invalid JSON: ${error?.message||error}`,N)};
  }
}

export async function validateProgram(program=json(P),context={}){
  if(!isRecord(program))return[d('PQG_SCHEMA_INVALID','program root must be a non-array JSON object',P)];
  const z=[...await schema(PS,program,P)];
  const map=taskMap(program),tasks=Array.isArray(program.tasks)?program.tasks:[],ids=tasks.map(task=>task?.task_id);
  if(program.program_id!==PID||program.repository!==REPO||program.operating_model!==MODEL||program.status_authority!==N){
    z.push(d('PQG_PROGRAM_IDENTITY_INVALID','program identity, repository, operating model, or status authority differs from the approved model',P));
  }
  if(ids.length!==IDS.length||new Set(ids).size!==ids.length||!eq(uniq(ids),uniq(IDS))){
    z.push(d('PQG_TASK_REGISTRY_INVALID','Task registry must contain exactly PPQR-001 through PPQR-015',P));
  }
  for(const task of tasks){
    if(!isRecord(task))continue;
    const expected=DEPS[task.task_id];
    if(!expected||!eq(uniq(task.depends_on),uniq(expected))){
      z.push(d('PQG_TASK_REGISTRY_INVALID',`approved dependencies changed for ${task.task_id}`,task.task_id));
    }
    if((task.depends_on||[]).includes(task.task_id)||(task.depends_on||[]).some(dep=>!map.has(dep))){
      z.push(d('PQG_DEPENDENCY_INVALID',`invalid dependency for ${task.task_id}`,task.task_id));
    }
    const pending=dependencyBlockers(task,map,context);
    if(['active','complete'].includes(task.state)&&pending.length){
      z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} cannot be ${task.state} while dependencies are incomplete or unverified: ${pending.join(', ')}`,task.task_id));
    }
    if(task.state==='complete')z.push(...completionDiagnostics(task,context));
    if(task.state!=='complete'&&task.completion_validation!==null){
      z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} has completion validation without complete state`,task.task_id));
    }
    if(task.state==='blocked'&&!(task.blockers||[]).length){
      z.push(d('PQG_TASK_STATE_INVALID',`${task.task_id} blocked state requires an explicit blocker`,task.task_id));
    }
  }
  if(hasCycle(map))z.push(d('PQG_DEPENDENCY_INVALID','dependency cycle detected',P));
  if(tasks.filter(task=>task?.state==='active').length>1)z.push(d('PQG_MULTIPLE_ACTIVE_TASKS','only one Task may be active',P));
  return z;
}

export function validateStatus(program=json(P),text=txt(N),context={}){
  if(!isRecord(program))return[d('PQG_SCHEMA_INVALID','program root must be a non-array JSON object',P)];
  const parsed=statusBlock(text);if(parsed.error)return[parsed.error];
  const status=parsed.value;
  const required=['active_program','operating_model','current_task','task_status','blocked_by','last_completed_task','next_action'];
  const allowed=new Set(required),missing=required.filter(key=>!Object.hasOwn(status,key)),z=[];
  if(missing.length)return[d('PQG_STATUS_INVALID',`status is missing required field(s): ${missing.join(', ')}`,N)];
  if(Object.keys(status).some(key=>!allowed.has(key)))z.push(d('PQG_STATUS_INVALID','status contains unsupported or retired lifecycle fields',N));
  if(status.active_program!==PID||status.operating_model!==MODEL)z.push(d('PQG_STATUS_INVALID','status identity does not match the active program and operating model',N));

  const map=taskMap(program);
  if(typeof status.current_task!=='string'||!map.has(status.current_task)){
    return[...z,d('PQG_STATUS_TASK_INVALID','current_task must reference a registered Task',N)];
  }
  const current=map.get(status.current_task),derived=eligibility(current,map,context),active=(program.tasks||[]).filter(task=>task.state==='active');
  if(active.length===1&&active[0].task_id!==status.current_task)z.push(d('PQG_STATUS_TASK_INVALID','current_task must be the active Task',N));
  if(!['eligible','active','blocked'].includes(derived))z.push(d('PQG_STATUS_TASK_INVALID',`${status.current_task} is not a current-work candidate: ${derived}`,N));
  if(status.task_status!==current.state)z.push(d('PQG_STATUS_TASK_INVALID','task_status differs from the machine-readable Task state',N));
  const expectedBlocked=current.state==='blocked'?uniq(current.blockers):dependencyBlockers(current,map,context);
  if(!Array.isArray(status.blocked_by)||!eq(uniq(status.blocked_by),expectedBlocked))z.push(d('PQG_STATUS_TASK_INVALID','blocked_by differs from explicit or dependency blockers',N));
  if(status.last_completed_task!==null&&!isAuthoritativelyComplete(map.get(status.last_completed_task),context)){
    z.push(d('PQG_STATUS_TASK_INVALID','last_completed_task must be null or an authoritatively completed Task',N));
  }
  if(typeof status.next_action!=='string'||!status.next_action.trim())z.push(d('PQG_STATUS_INVALID','next_action must be a non-empty string',N));
  return z;
}
