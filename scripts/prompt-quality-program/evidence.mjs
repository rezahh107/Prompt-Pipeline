import {execFileSync} from 'node:child_process';
import {N,P,R,REPO,isRecord} from './core.mjs';

export const CANONICAL_WORKFLOW={id:302284939,name:'CI',job:'PEaC canonical exact-head CI'};
export const COMPLETION_PROFILE='peac-canonical-ci.v1';
export const CLOSURE_PATHS=[P,N];
const STATUS_FIELDS=['active_program','operating_model','current_task','task_status','blocked_by','last_completed_task','next_action'];
const MUTABLE_STATUS_FIELDS=new Set(['current_task','task_status','blocked_by','last_completed_task','next_action']);

function runGit(args,{cwd=R,exec=execFileSync}={}){
  try{
    return{ok:true,stdout:String(exec('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})).trim()};
  }catch(error){
    return{ok:false,status:error?.status??1,stderr:String(error?.stderr||error?.message||'').trim()};
  }
}

function jsonAt(commit,file,options={}){
  const result=runGit(['show',`${commit}:${file}`],options);
  if(!result.ok)return null;
  try{return JSON.parse(result.stdout)}catch{return null}
}

function textAt(commit,file,options={}){
  const result=runGit(['show',`${commit}:${file}`],options);
  return result.ok?result.stdout:null;
}

function taskOf(program,taskId){
  return Array.isArray(program?.tasks)?program.tasks.find(task=>task?.task_id===taskId)||null:null;
}

function statusDocument(text){
  if(typeof text!=='string')return null;
  const pattern=/<!-- prompt-quality-status:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- prompt-quality-status:end -->/;
  const match=text.match(pattern);
  if(!match)return null;
  try{
    const value=JSON.parse(match[1]);
    if(!isRecord(value))return null;
    return{value,outside:text.replace(pattern,'__PROMPT_QUALITY_STATUS_BLOCK__')};
  }catch{return null}
}

function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function clone(value){return structuredClone(value)}

function programDeltaValid(beforeProgram,afterProgram,taskId){
  if(!isRecord(beforeProgram)||!isRecord(afterProgram))return false;
  const beforeTask=taskOf(beforeProgram,taskId),afterTask=taskOf(afterProgram,taskId);
  if(!isRecord(beforeTask)||!isRecord(afterTask))return false;
  const normalized=clone(afterProgram),normalizedTask=taskOf(normalized,taskId);
  normalizedTask.state=beforeTask.state;
  normalizedTask.completion_validation=clone(beforeTask.completion_validation);
  return equal(normalized,beforeProgram);
}

function statusDeltaValid(beforeText,afterText,taskId){
  const before=statusDocument(beforeText),after=statusDocument(afterText);
  if(!before||!after||before.outside!==after.outside)return false;
  if(!STATUS_FIELDS.every(key=>Object.hasOwn(before.value,key)&&Object.hasOwn(after.value,key)))return false;
  if(Object.keys(before.value).some(key=>!STATUS_FIELDS.includes(key))||Object.keys(after.value).some(key=>!STATUS_FIELDS.includes(key)))return false;
  const changed=STATUS_FIELDS.filter(key=>!equal(before.value[key],after.value[key]));
  if(!changed.length||changed.some(key=>!MUTABLE_STATUS_FIELDS.has(key)))return false;
  return before.value.last_completed_task!==taskId&&after.value.last_completed_task===taskId;
}

function commitParents(commit,options={}){
  const result=runGit(['rev-list','--parents','-n','1',commit],options);
  if(!result.ok||!result.stdout)return[];
  return result.stdout.split(/\s+/).slice(1);
}

function changedPaths(commit,options={}){
  const result=runGit(['diff-tree','--root','--no-commit-id','--name-only','-r',commit],options);
  return result.ok?result.stdout.split(/\r?\n/).filter(Boolean).sort():[];
}

function isAncestor(candidate,head,options={}){
  return runGit(['merge-base','--is-ancestor',candidate,head],options).ok;
}

export function deriveCompletionClosure(taskId,validationHead,options={}){
  const history=runGit(['rev-list','--reverse',validationHead,'--',P],options);
  if(!history.ok)return{history_available:false,transition_count:0};
  const transitions=[];
  for(const commit of history.stdout.split(/\r?\n/).filter(Boolean)){
    const parents=commitParents(commit,options);
    if(parents.length!==1)continue;
    const before=jsonAt(parents[0],P,options),after=jsonAt(commit,P,options);
    const beforeTask=taskOf(before,taskId),afterTask=taskOf(after,taskId);
    if(isRecord(beforeTask)&&beforeTask.state!=='complete'&&isRecord(afterTask)&&afterTask.state==='complete'){
      transitions.push({commit,parent:parents[0],before,after});
    }
  }
  if(transitions.length!==1)return{history_available:true,transition_count:transitions.length};
  const transition=transitions[0],closure=transition.commit,subject=transition.parent;
  const closureParents=commitParents(closure,options);
  const beforeProgram=transition.before,closureProgram=transition.after;
  const beforeTasks=Array.isArray(beforeProgram?.tasks)?beforeProgram.tasks:[];
  const closureTasks=Array.isArray(closureProgram?.tasks)?closureProgram.tasks:[];
  const beforeMap=new Map(beforeTasks.map(task=>[task?.task_id,task]));
  const transitionedTaskIds=closureTasks
    .filter(task=>task?.state==='complete'&&beforeMap.get(task?.task_id)?.state!=='complete')
    .map(task=>task.task_id).sort();
  const closureChangedPaths=changedPaths(closure,options);
  const subjectChangedPaths=changedPaths(subject,options);
  const closureProgramTask=taskOf(closureProgram,taskId);
  const headProgram=jsonAt(validationHead,P,options),headTask=taskOf(headProgram,taskId);
  const beforeStatus=textAt(subject,N,options),closureStatus=textAt(closure,N,options);
  const closurePathsValid=closureChangedPaths.length===CLOSURE_PATHS.length&&CLOSURE_PATHS.every(path=>closureChangedPaths.includes(path));
  const programValid=programDeltaValid(beforeProgram,closureProgram,taskId);
  const statusValid=statusDeltaValid(beforeStatus,closureStatus,taskId);
  return{
    history_available:true,
    transition_count:1,
    closure_commit:closure,
    closure_parent_count:closureParents.length,
    closure_is_ancestor_of_validation_head:isAncestor(closure,validationHead,options),
    subject_commit:subject,
    subject_commit_exists:runGit(['cat-file','-e',`${subject}^{commit}`],options).ok,
    subject_task_was_complete:taskOf(beforeProgram,taskId)?.state==='complete',
    transitioned_task_ids:transitionedTaskIds,
    closure_changed_paths:closureChangedPaths,
    subject_changed_paths:subjectChangedPaths,
    subject_has_non_closure_change:subjectChangedPaths.some(path=>!CLOSURE_PATHS.includes(path)),
    program_delta_valid:programValid,
    status_delta_valid:statusValid,
    closure_scope_valid:closurePathsValid&&programValid&&statusValid,
    history_drift:!equal(closureProgramTask,headTask)
  };
}

async function apiJson(path,{token,fetchImpl=globalThis.fetch}){
  const response=await fetchImpl(`https://api.github.com${path}`,{
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:`Bearer ${token}`,
      'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'Prompt-Pipeline-Prompt-Quality-Validator'
    }
  });
  if(!response.ok)throw new Error(`github_api_http_${response.status}`);
  return response.json();
}

function normalizeRun(run,jobs){
  return{
    run_id:run?.id??null,
    repository:run?.repository?.full_name||null,
    workflow_id:run?.workflow_id??null,
    workflow_name:run?.name||null,
    status:run?.status||null,
    conclusion:run?.conclusion||null,
    head_sha:run?.head_sha||null,
    jobs:(Array.isArray(jobs?.jobs)?jobs.jobs:[]).map(job=>({
      name:job?.name||null,status:job?.status||null,conclusion:job?.conclusion||null
    }))
  };
}

function canonicalRun(run,subject){
  if(run.repository!==REPO||run.workflow_id!==CANONICAL_WORKFLOW.id||run.workflow_name!==CANONICAL_WORKFLOW.name)return false;
  if(run.status!=='completed'||run.conclusion!=='success'||run.head_sha!==subject)return false;
  const job=run.jobs.find(item=>item.name===CANONICAL_WORKFLOW.job);
  return job?.status==='completed'&&job?.conclusion==='success';
}

export async function loadTrustedCompletionEvidence(program,options={}){
  const env=options.env||process.env,fetchImpl=options.fetchImpl||globalThis.fetch,cwd=options.cwd||R;
  const completed=(Array.isArray(program?.tasks)?program.tasks:[]).filter(task=>task?.state==='complete');
  const validationHead=env.TESTED_SHA||env.GITHUB_SHA||runGit(['rev-parse','HEAD'],{cwd}).stdout||null;
  const trusted=env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO;
  const token=env.GITHUB_TOKEN||env.GH_TOKEN||null;
  const context={trusted,repository:REPO,validation_head:validationHead,completions:{}};
  let externalApiCalls=0;

  for(const task of completed){
    const closure=deriveCompletionClosure(task.task_id,validationHead,{cwd});
    const evidence={repository:REPO,...closure,workflow_run:null,accepted_run_count:0};
    context.completions[task.task_id]=evidence;
    if(task?.completion_validation?.source!=='github_actions')continue;
    if(!trusted){evidence.unavailable_reason='not_github_actions_context';continue}
    if(!token){evidence.unavailable_reason='github_token_missing';continue}
    if(!closure.subject_commit||closure.transition_count!==1||closure.closure_scope_valid!==true)continue;

    try{
      const list=await apiJson(`/repos/${REPO}/actions/workflows/${CANONICAL_WORKFLOW.id}/runs?head_sha=${encodeURIComponent(closure.subject_commit)}&per_page=100`,{token,fetchImpl});
      externalApiCalls++;
      const prelim=(Array.isArray(list?.workflow_runs)?list.workflow_runs:[])
        .filter(run=>run?.workflow_id===CANONICAL_WORKFLOW.id&&run?.name===CANONICAL_WORKFLOW.name&&run?.head_sha===closure.subject_commit);
      const accepted=[];
      for(const run of prelim){
        const jobs=await apiJson(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`,{token,fetchImpl});
        externalApiCalls++;
        const normalized=normalizeRun(run,jobs);
        if(canonicalRun(normalized,closure.subject_commit))accepted.push(normalized);
      }
      accepted.sort((a,b)=>a.run_id-b.run_id);
      evidence.accepted_run_count=accepted.length;
      if(accepted.length===1)evidence.workflow_run=accepted[0];
    }catch(error){
      evidence.unavailable_reason=String(error?.message||error);
    }
  }

  return{context,externalApiCalls,completedTaskIds:completed.map(task=>task.task_id)};
}
