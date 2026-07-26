import {execFileSync} from 'node:child_process';
import {load as loadYaml} from 'js-yaml';
import {N,P,R,REPO,isRecord} from './core.mjs';

export const CANONICAL_WORKFLOW={id:302284939,name:'CI',job:'PEaC canonical exact-head CI'};
export const COMPLETION_PROFILE='peac-canonical-ci.v1';
export const COMPLETION_AUTHORITY_MARKER='completion-authority-contract.v1|task_fields=completion_contract,completion_validation|contract_fields=contract_id,contract_version,task_id,required_changed_paths,required_artifact_paths,required_validation_script_ids,forbidden_changed_paths|claim_fields=validation_status,tested_commit,source,validation_profile,ci_run_reference|authority_sequence=closure>subject>authority_anchor>authority_blobs>preactivated_contract>contract_satisfaction>subject_profile>anchor_ci>subject_ci';
export const CLOSURE_PATHS=[P,N];
/* COMPLETION_AUTHORITY_INVENTORY_V1:["scripts/prompt-quality-program/core.mjs","scripts/prompt-quality-program/evidence.mjs","scripts/prompt-quality-program/program.mjs","scripts/peac-prompt-quality-program.mjs","scripts/peac-prompt-quality-program-self-test.mjs","planning/prompt-quality/schemas/prompt-quality-execution-program.v2.schema.json","package.json",".github/workflows/ci.yml"] */
export const AUTHORITY_INVENTORY=Object.freeze([
  'scripts/prompt-quality-program/core.mjs',
  'scripts/prompt-quality-program/evidence.mjs',
  'scripts/prompt-quality-program/program.mjs',
  'scripts/peac-prompt-quality-program.mjs',
  'scripts/peac-prompt-quality-program-self-test.mjs',
  'planning/prompt-quality/schemas/prompt-quality-execution-program.v2.schema.json',
  'package.json',
  '.github/workflows/ci.yml'
]);
const AUTHORITY_INVENTORY_ID='completion-authority-inventory.v1';
const AUTHORITY_MARKER_PATH='scripts/prompt-quality-program/evidence.mjs';
const STATUS_FIELDS=['active_program','operating_model','current_task','task_status','blocked_by','last_completed_task','next_action'];
const MUTABLE_STATUS_FIELDS=new Set(['current_task','task_status','blocked_by','last_completed_task','next_action']);
const CHECKOUT_ACTION='actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';
const SETUP_NODE_ACTION='actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const CORE_STEP_NAMES=['Checkout exact tested commit','Verify exact tested commit identity','Setup Node','Enable Corepack','Install authoritative dependency graph','Run required renderer validation commands','Run canonical CI script','Verify bundle output'];
const EXPECTED_CI_CHAIN=[
  'pnpm typecheck','pnpm peac:runtime-cli-help','pnpm peac:selftest','pnpm peac:routertest','pnpm peac:domaintest','pnpm peac:intakecheck','pnpm peac:validate','pnpm peac:eval','pnpm peac:output-contract','pnpm peac:behavioral-coverage','pnpm peac:production-gate','pnpm peac:human-review-gate','pnpm peac:model-profile','pnpm peac:context-policy','pnpm peac:context-case','pnpm peac:artifact-metadata','pnpm peac:provenance','pnpm peac:runtime-authority-test','pnpm peac:synctest','pnpm peac:sync -- --check','pnpm validate:prompt-quality-governance','pnpm peac:pr-inspector-renderer','pnpm peac:pr-inspector-renderer-pack','pnpm peac:bundle','pnpm peac:bundlecheck','pnpm peac:smoke'
];
const EXPECTED_SCRIPT_BINDINGS={
  'typecheck':'tsc --noEmit','peac:runtime-cli-help':'pnpm peac:generate -- --help && pnpm peac:review-artifact -- --help && pnpm peac:verify-artifact -- --help','peac:selftest':'tsx scripts/peac-self-test.ts','peac:routertest':'tsx scripts/peac-router-self-test.ts','peac:domaintest':'tsx scripts/peac-domain-self-test.ts','peac:intakecheck':'tsx scripts/peac-intake.ts --check-fixtures','peac:validate':'tsx scripts/peac-validate.ts','peac:eval':'tsx scripts/peac-eval.ts','peac:output-contract':'tsx scripts/peac-output-contract-check.ts','peac:behavioral-coverage':'tsx scripts/peac-behavioral-coverage-check.ts','peac:production-gate':'tsx scripts/peac-production-grade-gate.ts','peac:human-review-gate':'tsx scripts/peac-human-review-gate.ts','peac:model-profile':'tsx scripts/peac-model-profile-check.ts','peac:context-policy':'tsx scripts/peac-context-policy-check.ts','peac:context-case':'tsx scripts/peac-context-case-check.ts','peac:artifact-metadata':'tsx scripts/peac-artifact-metadata-check.ts','peac:provenance':'tsx scripts/peac-artifact-provenance-check.ts','peac:runtime-authority-test':'tsx scripts/peac-runtime-authority-ci.ts','peac:synctest':'tsx scripts/peac-sync-self-test.ts','peac:sync':'tsx scripts/peac-sync.ts','validate:prompt-quality-governance':'pnpm validate:prompt-quality-program && pnpm test:prompt-quality-governance','validate:prompt-quality-program':'node scripts/peac-prompt-quality-program.mjs --all','test:prompt-quality-governance':'node scripts/peac-prompt-quality-program-self-test.mjs','peac:pr-inspector-renderer':'npm --prefix packages/pr-inspector-prompt-renderer test','peac:pr-inspector-renderer-pack':'npm --prefix packages/pr-inspector-prompt-renderer run pack:check','peac:bundle':'tsx scripts/peac-build-bundle.ts','peac:bundlecheck':'tsx scripts/peac-portable-bundle-self-test.ts','peac:smoke':'pnpm peac:generate -- --case domains/image/cases/academic-portrait.yaml --mode ci'
};
export const CANONICAL_PROFILE_SCRIPT_IDS=Object.freeze(Object.keys(EXPECTED_SCRIPT_BINDINGS).sort());

function runGit(args,{cwd=R,exec=execFileSync}={}){
  try{return{ok:true,stdout:String(exec('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})).trim()}}
  catch(error){return{ok:false,status:error?.status??1,stderr:String(error?.stderr||error?.message||'').trim()}}
}
function jsonAt(commit,file,options={}){const result=runGit(['show',`${commit}:${file}`],options);if(!result.ok)return null;try{return JSON.parse(result.stdout)}catch{return null}}
function textAt(commit,file,options={}){const result=runGit(['show',`${commit}:${file}`],options);return result.ok?result.stdout:null}
function taskOf(program,taskId){return Array.isArray(program?.tasks)?program.tasks.find(task=>task?.task_id===taskId)||null:null}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function clone(value){return structuredClone(value)}
function normalizeCommand(value){return String(value??'').trim().replace(/\s+/g,' ')}
function hasFailureSuppression(value){const text=String(value??'');return /\|\|/.test(text)||/\bset\s+\+e\b/i.test(text)||/\bexit\s+0\b/i.test(text)||/\btrap\b/i.test(text)||/(^|[;|]\s*)(true|:)($|[;|\s])/im.test(text)||/(^|[\n;])\s*(if|case|while|until|for|function)\b/im.test(text)}
function strictAndChain(value){const source=String(value??'').trim();if(!source||hasFailureSuppression(source))return null;const remainder=source.replace(/&&/g,'');if(/[;&|]/.test(remainder))return null;const commands=source.split(/\s*&&\s*/).map(normalizeCommand);return commands.length&&commands.every(Boolean)?commands:null}
function continueOnError(value){return value!==undefined&&value!==null&&value!==false&&String(value).toLowerCase()!=='false'}
function lines(value){return String(value??'').replace(/\\\r?\n/g,' ').split(/\r?\n/).map(line=>line.trim()).filter(Boolean)}
function stepByName(job,name){const matches=(Array.isArray(job?.steps)?job.steps:[]).filter(step=>step?.name===name);return matches.length===1?matches[0]:null}
function profileIssue(issues,code){issues.push(code)}

function packageProfile(pkg,issues){
  if(!isRecord(pkg)||!isRecord(pkg.scripts)){profileIssue(issues,'package_invalid');return null}
  const chain=strictAndChain(pkg.scripts.ci);if(!chain||!equal(chain,EXPECTED_CI_CHAIN))profileIssue(issues,'package_ci_chain_mismatch');
  for(const [name,expected] of Object.entries(EXPECTED_SCRIPT_BINDINGS)){const actual=normalizeCommand(pkg.scripts[name]);if(actual!==normalizeCommand(expected)||hasFailureSuppression(pkg.scripts[name]))profileIssue(issues,`script_binding_mismatch:${name}`)}
  const smoke=normalizeCommand(pkg.scripts['peac:smoke']);if(!/(^|\s)--mode\s+ci($|\s)/.test(smoke))profileIssue(issues,'smoke_mode_not_ci');
  return{ci_chain:chain,script_ids:[...CANONICAL_PROFILE_SCRIPT_IDS],bindings:Object.fromEntries(CANONICAL_PROFILE_SCRIPT_IDS.map(name=>[name,normalizeCommand(pkg.scripts[name])]))};
}
function workflowProfile(workflow,issues){
  if(!isRecord(workflow)||!isRecord(workflow.jobs)){profileIssue(issues,'workflow_invalid');return null}
  if(workflow.name!==CANONICAL_WORKFLOW.name)profileIssue(issues,'workflow_name_mismatch');
  const permissionKeys=isRecord(workflow.permissions)?Object.keys(workflow.permissions).sort():[];if(!equal(permissionKeys,['actions','contents'])||workflow?.permissions?.contents!=='read'||workflow?.permissions?.actions!=='read')profileIssue(issues,'workflow_permissions_mismatch');
  if(workflow.defaults!==undefined)profileIssue(issues,'workflow_defaults_unsupported');
  const jobs=Object.values(workflow.jobs).filter(job=>job?.name===CANONICAL_WORKFLOW.job);if(jobs.length!==1){profileIssue(issues,'canonical_job_missing_or_ambiguous');return null}
  const job=jobs[0];if(continueOnError(job?.['continue-on-error']))profileIssue(issues,'canonical_job_continue_on_error');if(job.defaults!==undefined||job.permissions!==undefined||job.container!==undefined||job.services!==undefined)profileIssue(issues,'canonical_job_execution_context_mismatch');
  const envKeys=isRecord(job.env)?Object.keys(job.env).sort():[];if(!equal(envKeys,['GITHUB_TOKEN','TESTED_SHA']))profileIssue(issues,'canonical_job_env_mismatch');if(job?.env?.TESTED_SHA!=="${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}")profileIssue(issues,'tested_sha_binding_mismatch');if(job?.env?.GITHUB_TOKEN!=='${{ github.token }}')profileIssue(issues,'github_token_binding_mismatch');
  const steps=Array.isArray(job.steps)?job.steps:[];if(!equal(steps.slice(0,CORE_STEP_NAMES.length).map(step=>step?.name),CORE_STEP_NAMES))profileIssue(issues,'canonical_step_order_mismatch');
  for(const name of CORE_STEP_NAMES){const step=stepByName(job,name);if(!step||continueOnError(step?.['continue-on-error'])||step?.if!==undefined||step?.env!==undefined||step?.['working-directory']!==undefined||step?.shell!==undefined)profileIssue(issues,`required_step_invalid:${name}`)}
  const checkout=stepByName(job,CORE_STEP_NAMES[0]);if(checkout&&(checkout.uses!==CHECKOUT_ACTION||checkout?.with?.ref!=='${{ env.TESTED_SHA }}'||Number(checkout?.with?.['fetch-depth'])!==0||String(checkout?.with?.['persist-credentials'])!=='false'))profileIssue(issues,'checkout_semantics_mismatch');
  const identity=stepByName(job,CORE_STEP_NAMES[1]);if(identity){const expected=['actual_sha="$(git rev-parse HEAD)"','test "$actual_sha" = "$TESTED_SHA"',"printf 'tested_commit_sha=%s\\n' \"$actual_sha\" | tee exact-head-ci-identity.txt"];if(hasFailureSuppression(identity.run)||!equal(lines(identity.run),expected))profileIssue(issues,'exact_sha_verification_missing')}
  const setup=stepByName(job,CORE_STEP_NAMES[2]);if(setup&&(setup.uses!==SETUP_NODE_ACTION||String(setup?.with?.['node-version'])!=='22.x'))profileIssue(issues,'setup_node_mismatch');
  const corepack=stepByName(job,CORE_STEP_NAMES[3]);if(corepack&&[...lines(corepack.run)].join('\n')!==['corepack enable','corepack prepare pnpm@10.13.1 --activate'].join('\n'))profileIssue(issues,'corepack_step_mismatch');
  const install=stepByName(job,CORE_STEP_NAMES[4]);if(install&&(normalizeCommand(install.run)!=='pnpm install --frozen-lockfile'||hasFailureSuppression(install.run)||install.shell))profileIssue(issues,'frozen_install_missing');
  const renderer=stepByName(job,CORE_STEP_NAMES[5]);if(renderer){const expected=['set -o pipefail','pnpm typecheck 2>&1 | tee renderer-required-validation.log','pnpm peac:pr-inspector-renderer 2>&1 | tee -a renderer-required-validation.log','pnpm peac:pr-inspector-renderer-pack 2>&1 | tee -a renderer-required-validation.log'];if(hasFailureSuppression(renderer.run)||!equal(lines(renderer.run),expected))profileIssue(issues,'renderer_validation_mismatch')}
  const ci=stepByName(job,CORE_STEP_NAMES[6]);if(ci){const expected=['set -o pipefail','pnpm run ci 2>&1 | tee peac-ci.log'];if(hasFailureSuppression(ci.run)||!equal(lines(ci.run),expected))profileIssue(issues,'canonical_ci_step_mismatch')}
  const bundle=stepByName(job,CORE_STEP_NAMES[7]);if(bundle){const expected=['test -d dist',"test -n \"$(find dist -maxdepth 1 -type f -name 'Prompt-Pipeline-KB-Bundle-v*.zip' -print -quit)\""];if(hasFailureSuppression(bundle.run)||!equal(lines(bundle.run),expected))profileIssue(issues,'bundle_verification_mismatch')}
  return{job_name:job.name,core_steps:steps.slice(0,CORE_STEP_NAMES.length).map(step=>step?.name)};
}
export function evaluateCanonicalProfile(packageJson,workflowDocument){const issues=[];const normalized={package:packageProfile(packageJson,issues),workflow:workflowProfile(workflowDocument,issues)};return{profile_id:COMPLETION_PROFILE,status:issues.length?'mismatch':'valid',issues,normalized}}
export function parseCanonicalProfile(packageText,workflowText){let pkg,workflow;try{pkg=JSON.parse(packageText)}catch{return{profile_id:COMPLETION_PROFILE,status:'invalid',issues:['package_parse_failed'],normalized:null}}try{workflow=loadYaml(workflowText)}catch{return{profile_id:COMPLETION_PROFILE,status:'invalid',issues:['workflow_parse_failed'],normalized:null}}if(!isRecord(pkg)||!isRecord(workflow))return{profile_id:COMPLETION_PROFILE,status:'invalid',issues:['profile_document_invalid'],normalized:null};return evaluateCanonicalProfile(pkg,workflow)}
export function inspectCanonicalProfileAt(commit,options={}){const packageText=textAt(commit,'package.json',options),workflowText=textAt(commit,'.github/workflows/ci.yml',options);if(packageText===null||workflowText===null)return{profile_id:COMPLETION_PROFILE,status:'invalid',issues:['profile_document_missing'],normalized:null};return parseCanonicalProfile(packageText,workflowText)}

function validRepoPath(value){return typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('//')&&!value.split('/').includes('..')&&!value.split('/').includes('.')}
function uniqueStrings(value,{nonempty=false}={}){return Array.isArray(value)&&(!nonempty||value.length>0)&&value.every(item=>typeof item==='string'&&item.length>0)&&new Set(value).size===value.length}
export function completionContractIssues(contract,taskId){
  const issues=[];const keys=['contract_id','contract_version','task_id','required_changed_paths','required_artifact_paths','required_validation_script_ids','forbidden_changed_paths'];
  if(!isRecord(contract))return['contract_not_object'];
  if(keys.some(key=>!Object.hasOwn(contract,key))||Object.keys(contract).some(key=>!keys.includes(key)))issues.push('contract_shape_mismatch');
  if(typeof contract.contract_id!=='string'||!contract.contract_id.trim())issues.push('contract_id_invalid');
  if(!Number.isInteger(contract.contract_version)||contract.contract_version<1)issues.push('contract_version_invalid');
  if(contract.task_id!==taskId)issues.push('contract_task_id_mismatch');
  if(!uniqueStrings(contract.required_changed_paths,{nonempty:true})||!contract.required_changed_paths.every(validRepoPath))issues.push('required_changed_paths_invalid');
  if(!uniqueStrings(contract.required_artifact_paths)||!contract.required_artifact_paths.every(validRepoPath))issues.push('required_artifact_paths_invalid');
  if(!uniqueStrings(contract.required_validation_script_ids,{nonempty:true})||!contract.required_validation_script_ids.every(id=>/^[a-z0-9][a-z0-9:-]*$/.test(id)))issues.push('required_validation_script_ids_invalid');
  if(!uniqueStrings(contract.forbidden_changed_paths)||!contract.forbidden_changed_paths.every(validRepoPath))issues.push('forbidden_changed_paths_invalid');
  if(Array.isArray(contract.required_changed_paths)&&Array.isArray(contract.forbidden_changed_paths)&&contract.required_changed_paths.some(path=>contract.forbidden_changed_paths.includes(path)))issues.push('required_forbidden_overlap');
  return issues;
}
function treeEntry(commit,file,options={}){const result=runGit(['ls-tree',commit,'--',file],options);if(!result.ok||!result.stdout)return null;const match=result.stdout.match(/^(\d+)\s+(\w+)\s+([0-9a-f]{40})\t(.+)$/);if(!match||match[4]!==file)return null;return{mode:match[1],type:match[2],blob:match[3],path:match[4],regular:match[2]==='blob'&&['100644','100755'].includes(match[1])}}
function parseAuthorityInventory(text){
  const match=String(text??'').match(/\/\* COMPLETION_AUTHORITY_INVENTORY_V1:(\[[^\n]+\]) \*\//);if(!match)return{status:'invalid',issues:['inventory_marker_missing'],paths:[]};
  let paths;try{paths=JSON.parse(match[1])}catch{return{status:'invalid',issues:['inventory_marker_invalid_json'],paths:[]}}
  const issues=[];if(!uniqueStrings(paths,{nonempty:true})||!paths.every(validRepoPath))issues.push('inventory_paths_invalid');for(const required of AUTHORITY_INVENTORY)if(!paths.includes(required))issues.push(`inventory_minimum_missing:${required}`);
  return{status:issues.length?'invalid':'valid',issues,paths:Array.isArray(paths)?paths:[]};
}
function inspectAuthority(anchor,subject,options={}){
  if(!anchor)return{authority_inventory_id:AUTHORITY_INVENTORY_ID,authority_status:'invalid',authority_issues:['authority_anchor_missing'],authority_inventory:[],authority_changed_paths:[]};
  const marker=textAt(anchor,AUTHORITY_MARKER_PATH,options),parsed=parseAuthorityInventory(marker);if(parsed.status!=='valid')return{authority_inventory_id:AUTHORITY_INVENTORY_ID,authority_status:'invalid',authority_issues:parsed.issues,authority_inventory:parsed.paths,authority_changed_paths:[]};
  const issues=[],changed=[];
  for(const file of parsed.paths){const before=treeEntry(anchor,file,options),after=treeEntry(subject,file,options);if(!before?.regular)issues.push(`anchor_authority_blob_missing:${file}`);if(!after?.regular)issues.push(`subject_authority_blob_missing:${file}`);if(before?.regular&&after?.regular&&before.blob!==after.blob)changed.push(file)}
  return{authority_inventory_id:AUTHORITY_INVENTORY_ID,authority_status:issues.length?'invalid':changed.length?'self_mutation':'valid',authority_issues:issues,authority_inventory:parsed.paths,authority_changed_paths:changed};
}
function statusDocument(text){if(typeof text!=='string')return null;const pattern=/<!-- prompt-quality-status:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- prompt-quality-status:end -->/;const match=text.match(pattern);if(!match)return null;try{const value=JSON.parse(match[1]);if(!isRecord(value))return null;return{value,outside:text.replace(pattern,'__PROMPT_QUALITY_STATUS_BLOCK__')}}catch{return null}}
function programDeltaValid(beforeProgram,afterProgram,taskId){if(!isRecord(beforeProgram)||!isRecord(afterProgram))return false;const beforeTask=taskOf(beforeProgram,taskId),afterTask=taskOf(afterProgram,taskId);if(!isRecord(beforeTask)||!isRecord(afterTask))return false;const normalized=clone(afterProgram),normalizedTask=taskOf(normalized,taskId);normalizedTask.state=beforeTask.state;normalizedTask.completion_validation=clone(beforeTask.completion_validation);return equal(normalized,beforeProgram)}
function statusDeltaValid(beforeText,afterText,taskId){const before=statusDocument(beforeText),after=statusDocument(afterText);if(!before||!after||before.outside!==after.outside)return false;if(!STATUS_FIELDS.every(key=>Object.hasOwn(before.value,key)&&Object.hasOwn(after.value,key)))return false;if(Object.keys(before.value).some(key=>!STATUS_FIELDS.includes(key))||Object.keys(after.value).some(key=>!STATUS_FIELDS.includes(key)))return false;const changed=STATUS_FIELDS.filter(key=>!equal(before.value[key],after.value[key]));if(!changed.length||changed.some(key=>!MUTABLE_STATUS_FIELDS.has(key)))return false;return before.value.last_completed_task!==taskId&&after.value.last_completed_task===taskId}
function commitParents(commit,options={}){const result=runGit(['rev-list','--parents','-n','1',commit],options);if(!result.ok||!result.stdout)return[];return result.stdout.split(/\s+/).slice(1)}
function changedPathsFromFirstParent(commit,options={}){const parents=commitParents(commit,options);if(!parents.length)return{available:false,parent_count:0,first_parent:null,paths:[]};const result=runGit(['diff','--no-renames','--name-only',parents[0],commit,'--'],options);return{available:result.ok,parent_count:parents.length,first_parent:parents[0],paths:result.ok?result.stdout.split(/\r?\n/).filter(Boolean).sort():[]}}
function isAncestor(candidate,head,options={}){return runGit(['merge-base','--is-ancestor',candidate,head],options).ok}
function inspectContract(taskId,anchor,subject,closure,validationHead,subjectDelta,profile,options={}){
  const anchorTask=taskOf(jsonAt(anchor,P,options),taskId),subjectTask=taskOf(jsonAt(subject,P,options),taskId),closureTask=taskOf(jsonAt(closure,P,options),taskId),headTask=taskOf(jsonAt(validationHead,P,options),taskId);
  const anchorContract=anchorTask?.completion_contract??null,subjectContract=subjectTask?.completion_contract??null,closureContract=closureTask?.completion_contract??null,headContract=headTask?.completion_contract??null;
  if(anchorContract===null)return{contract_status:subjectContract===null?'missing':'self_mutation',contract_issues:[subjectContract===null?'anchor_contract_missing':'contract_created_by_subject'],contract_anchor:null};
  if(!equal(anchorContract,subjectContract))return{contract_status:'self_mutation',contract_issues:['contract_changed_by_subject'],contract_anchor:anchorContract};
  if(!equal(subjectContract,closureContract))return{contract_status:'self_mutation',contract_issues:['contract_changed_by_closure'],contract_anchor:anchorContract};
  if(!equal(closureContract,headContract))return{contract_status:'history_drift',contract_issues:['contract_changed_after_closure'],contract_anchor:anchorContract};
  const issues=completionContractIssues(anchorContract,taskId);if(issues.length)return{contract_status:'invalid',contract_issues:issues,contract_anchor:anchorContract};
  const satisfaction=[];const paths=subjectDelta.paths||[];
  for(const file of anchorContract.required_changed_paths)if(!paths.includes(file))satisfaction.push(`required_change_missing:${file}`);
  for(const file of anchorContract.forbidden_changed_paths)if(paths.includes(file))satisfaction.push(`forbidden_change_present:${file}`);
  for(const file of anchorContract.required_artifact_paths)if(!treeEntry(subject,file,options)?.regular)satisfaction.push(`required_artifact_missing:${file}`);
  const verifiedScripts=new Set(profile?.normalized?.package?.script_ids||[]);for(const id of anchorContract.required_validation_script_ids)if(!verifiedScripts.has(id))satisfaction.push(`required_validation_script_unverified:${id}`);
  return{contract_status:satisfaction.length?'unsatisfied':'valid',contract_issues:satisfaction,contract_anchor:anchorContract};
}

export function deriveCompletionClosure(taskId,validationHead,options={}){
  const history=runGit(['rev-list','--reverse',validationHead,'--',P],options);if(!history.ok)return{history_available:false,transition_count:0};const transitions=[];
  for(const commit of history.stdout.split(/\r?\n/).filter(Boolean)){const parents=commitParents(commit,options);if(parents.length!==1)continue;const before=jsonAt(parents[0],P,options),after=jsonAt(commit,P,options),beforeTask=taskOf(before,taskId),afterTask=taskOf(after,taskId);if(isRecord(beforeTask)&&beforeTask.state!=='complete'&&isRecord(afterTask)&&afterTask.state==='complete')transitions.push({commit,parent:parents[0],before,after})}
  if(transitions.length!==1)return{history_available:true,transition_count:transitions.length};
  const transition=transitions[0],closure=transition.commit,subject=transition.parent,closureDelta=changedPathsFromFirstParent(closure,options),subjectDelta=changedPathsFromFirstParent(subject,options),authorityAnchor=subjectDelta.first_parent;
  const beforeProgram=transition.before,closureProgram=transition.after,beforeTasks=Array.isArray(beforeProgram?.tasks)?beforeProgram.tasks:[],closureTasks=Array.isArray(closureProgram?.tasks)?closureProgram.tasks:[],beforeMap=new Map(beforeTasks.map(task=>[task?.task_id,task]));
  const transitionedTaskIds=closureTasks.filter(task=>task?.state==='complete'&&beforeMap.get(task?.task_id)?.state!=='complete').map(task=>task.task_id).sort();const closureProgramTask=taskOf(closureProgram,taskId),headTask=taskOf(jsonAt(validationHead,P,options),taskId);
  const beforeStatus=textAt(subject,N,options),closureStatus=textAt(closure,N,options),closurePathsValid=closureDelta.available&&closureDelta.paths.length===CLOSURE_PATHS.length&&CLOSURE_PATHS.every(path=>closureDelta.paths.includes(path));const programValid=programDeltaValid(beforeProgram,closureProgram,taskId),statusValid=statusDeltaValid(beforeStatus,closureStatus,taskId);
  return{history_available:true,transition_count:1,closure_commit:closure,closure_parent_count:closureDelta.parent_count,closure_is_ancestor_of_validation_head:isAncestor(closure,validationHead,options),subject_commit:subject,subject_commit_exists:runGit(['cat-file','-e',`${subject}^{commit}`],options).ok,subject_parent_count:subjectDelta.parent_count,subject_first_parent:authorityAnchor,authority_anchor_commit:authorityAnchor,authority_anchor_exists:authorityAnchor?runGit(['cat-file','-e',`${authorityAnchor}^{commit}`],options).ok:false,subject_scope_available:subjectDelta.available,subject_task_was_complete:taskOf(beforeProgram,taskId)?.state==='complete',transitioned_task_ids:transitionedTaskIds,closure_changed_paths:closureDelta.paths,subject_changed_paths:subjectDelta.paths,subject_has_non_closure_change:subjectDelta.available&&subjectDelta.paths.some(path=>!CLOSURE_PATHS.includes(path)),program_delta_valid:programValid,status_delta_valid:statusValid,closure_scope_valid:closurePathsValid&&programValid&&statusValid,history_drift:!equal(closureProgramTask,headTask)};
}
async function apiJson(path,{token,fetchImpl=globalThis.fetch}){const response=await fetchImpl(`https://api.github.com${path}`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Prompt-Pipeline-Prompt-Quality-Validator'}});if(!response.ok)throw new Error(`github_api_http_${response.status}`);return response.json()}
function normalizeRun(run,jobs){return{run_id:run?.id??null,repository:run?.repository?.full_name||null,workflow_id:run?.workflow_id??null,workflow_name:run?.name||null,status:run?.status||null,conclusion:run?.conclusion||null,head_sha:run?.head_sha||null,jobs:(Array.isArray(jobs?.jobs)?jobs.jobs:[]).map(job=>({name:job?.name||null,status:job?.status||null,conclusion:job?.conclusion||null}))}}
function canonicalRun(run,commit){if(run.repository!==REPO||run.workflow_id!==CANONICAL_WORKFLOW.id||run.workflow_name!==CANONICAL_WORKFLOW.name)return false;if(run.status!=='completed'||run.conclusion!=='success'||run.head_sha!==commit)return false;const job=run.jobs.find(item=>item.name===CANONICAL_WORKFLOW.job);return job?.status==='completed'&&job?.conclusion==='success'}
async function canonicalRunsFor(commit,{token,fetchImpl}){let calls=0;const list=await apiJson(`/repos/${REPO}/actions/workflows/${CANONICAL_WORKFLOW.id}/runs?head_sha=${encodeURIComponent(commit)}&per_page=100`,{token,fetchImpl});calls++;const prelim=(Array.isArray(list?.workflow_runs)?list.workflow_runs:[]).filter(run=>run?.workflow_id===CANONICAL_WORKFLOW.id&&run?.name===CANONICAL_WORKFLOW.name&&run?.head_sha===commit),accepted=[];for(const run of prelim){const jobs=await apiJson(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`,{token,fetchImpl});calls++;const normalized=normalizeRun(run,jobs);if(canonicalRun(normalized,commit))accepted.push(normalized)}accepted.sort((a,b)=>a.run_id-b.run_id);return{calls,count:accepted.length,run:accepted.length===1?accepted[0]:null}}

export async function loadTrustedCompletionEvidence(program,options={}){
  const env=options.env||process.env,fetchImpl=options.fetchImpl||globalThis.fetch,cwd=options.cwd||R,completed=(Array.isArray(program?.tasks)?program.tasks:[]).filter(task=>task?.state==='complete');
  const validationHead=env.TESTED_SHA||env.GITHUB_SHA||runGit(['rev-parse','HEAD'],{cwd}).stdout||null,trusted=env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO,token=env.GITHUB_TOKEN||env.GH_TOKEN||null;const context={trusted,repository:REPO,validation_head:validationHead,completions:{}};let externalApiCalls=0;
  for(const task of completed){
    const closure=deriveCompletionClosure(task.task_id,validationHead,{cwd}),subject=closure.subject_commit,anchor=closure.authority_anchor_commit;
    const authority=subject&&anchor?inspectAuthority(anchor,subject,{cwd}):{authority_inventory_id:AUTHORITY_INVENTORY_ID,authority_status:'invalid',authority_issues:['authority_anchor_missing'],authority_inventory:[],authority_changed_paths:[]};
    const anchorProfile=anchor?inspectCanonicalProfileAt(anchor,{cwd}):{profile_id:COMPLETION_PROFILE,status:'invalid',issues:['anchor_missing'],normalized:null};
    const profile=subject?inspectCanonicalProfileAt(subject,{cwd}):{profile_id:COMPLETION_PROFILE,status:'invalid',issues:['subject_missing'],normalized:null};
    const contract=subject&&anchor&&closure.closure_commit?inspectContract(task.task_id,anchor,subject,closure.closure_commit,validationHead,{paths:closure.subject_changed_paths},profile,{cwd}):{contract_status:'invalid',contract_issues:['contract_context_missing'],contract_anchor:null};
    const evidence={repository:REPO,...closure,...authority,...contract,authority_profile_status:anchorProfile.status,authority_profile_issues:anchorProfile.issues,profile_id:profile.profile_id,profile_status:profile.status,profile_issues:profile.issues,authority_workflow_run:null,authority_accepted_run_count:0,workflow_run:null,accepted_run_count:0};context.completions[task.task_id]=evidence;
    if(task?.completion_validation?.source!=='github_actions')continue;if(!trusted){evidence.unavailable_reason='not_github_actions_context';continue}if(!token){evidence.unavailable_reason='github_token_missing';continue}
    const localValid=closure.transition_count===1&&closure.closure_scope_valid===true&&closure.subject_scope_available===true&&closure.subject_has_non_closure_change===true&&closure.authority_anchor_exists===true&&authority.authority_status==='valid'&&contract.contract_status==='valid'&&anchorProfile.status==='valid'&&profile.status==='valid';if(!localValid)continue;
    try{
      const anchorRuns=await canonicalRunsFor(anchor,{token,fetchImpl});externalApiCalls+=anchorRuns.calls;evidence.authority_accepted_run_count=anchorRuns.count;evidence.authority_workflow_run=anchorRuns.run;if(anchorRuns.count!==1)continue;
      const subjectRuns=await canonicalRunsFor(subject,{token,fetchImpl});externalApiCalls+=subjectRuns.calls;evidence.accepted_run_count=subjectRuns.count;evidence.workflow_run=subjectRuns.run;
    }catch(error){evidence.unavailable_reason=String(error?.message||error)}
  }
  return{context,externalApiCalls,completedTaskIds:completed.map(task=>task.task_id)};
}
