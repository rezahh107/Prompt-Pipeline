import {execFileSync} from 'node:child_process';
import {R,REPO,isRecord} from './core.mjs';

export const CANONICAL_WORKFLOW={id:302284939,name:'CI',job:'PEaC canonical exact-head CI'};

function runGit(args,{cwd=R,exec=execFileSync}={}){
  try{
    return{ok:true,stdout:String(exec('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})).trim()};
  }catch(error){
    return{ok:false,status:error?.status??1,stderr:String(error?.stderr||error?.message||'').trim()};
  }
}

export function inspectGitCommit(testedCommit,validationHead,options={}){
  const exists=runGit(['cat-file','-e',`${testedCommit}^{commit}`],options).ok;
  if(!exists)return{commit_exists:false,is_ancestor_of_validation_head:false};
  const ancestor=runGit(['merge-base','--is-ancestor',testedCommit,validationHead],options);
  return{commit_exists:true,is_ancestor_of_validation_head:ancestor.ok};
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

function normalizeRun(run,jobs,runId){
  return{
    run_id:runId,
    repository:run?.repository?.full_name||null,
    workflow_id:run?.workflow_id??null,
    workflow_name:run?.name||null,
    status:run?.status||null,
    conclusion:run?.conclusion||null,
    head_sha:run?.head_sha||null,
    jobs:(Array.isArray(jobs?.jobs)?jobs.jobs:[]).map(job=>({
      name:job?.name||null,
      status:job?.status||null,
      conclusion:job?.conclusion||null
    }))
  };
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
    const claim=isRecord(task.completion_validation)?task.completion_validation:{};
    const git=inspectGitCommit(claim.tested_commit,validationHead,{cwd});
    const evidence={
      repository:REPO,
      tested_commit:claim.tested_commit,
      commit_exists:git.commit_exists,
      is_ancestor_of_validation_head:git.is_ancestor_of_validation_head,
      workflow_run:null
    };
    context.completions[task.task_id]=evidence;

    if(claim.source!=='github_actions')continue;
    if(!trusted){evidence.unavailable_reason='not_github_actions_context';continue}
    if(!token){evidence.unavailable_reason='github_token_missing';continue}
    if(!Number.isInteger(claim.ci_run_reference)){evidence.unavailable_reason='ci_run_reference_missing';continue}

    try{
      const run=await apiJson(`/repos/${REPO}/actions/runs/${claim.ci_run_reference}`,{token,fetchImpl});externalApiCalls++;
      const jobs=await apiJson(`/repos/${REPO}/actions/runs/${claim.ci_run_reference}/jobs?per_page=100`,{token,fetchImpl});externalApiCalls++;
      evidence.workflow_run=normalizeRun(run,jobs,claim.ci_run_reference);
    }catch(error){
      evidence.unavailable_reason=String(error?.message||error);
    }
  }

  return{context,externalApiCalls,completedTaskIds:completed.map(task=>task.task_id)};
}
