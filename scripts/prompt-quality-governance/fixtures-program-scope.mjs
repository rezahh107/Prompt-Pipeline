import {cp,uniq,d,S} from './core.mjs';
import {validateProgram} from './program.mjs';
import {validateScope,scopeHash,amendmentHash} from './scope-progress.mjs';
export const PROGRAM_SCOPE=new Set(['dependency_derived_eligibility','authorized_dependency_blocked','parallel_after_ppqr001','missing_task','extra_task','duplicate_task','dependency_mutation','self_dependency','dependency_cycle','dependency_cycle_hidden','implemented_incomplete_dependency','complete_incomplete_dependency','program_complete_incomplete_task','unauthorized_eligible','exact_scope','valid_amendment','undeclared_changed_path','declared_unchanged_path','stale_base','stale_revision','wrong_task','wrong_program','silent_deletion','deferred_deleted','forbidden_operation','scope_expansion_same_revision','retroactive_amendment']);
export async function runProgramScope(c,a){const p=cp(a.p),s=cp(a.s),z=[];
if(c==='dependency_derived_eligibility'||c==='authorized_dependency_blocked')z.push(...await validateProgram(p));
else if(c==='parallel_after_ppqr001'){const one=p.tasks.find(x=>x.task_id==='PPQR-001');one.completion_state='complete';one.implementation_state='implemented';for(const id of ['PPQR-002','PPQR-003']){const t=p.tasks.find(x=>x.task_id===id);t.execution_state='eligible';t.blocking_state={blocked:false,blocking_reasons:[]}}z.push(...await validateProgram(p,{implementationAllowed:true,completionAllowed:true}))}
else if(c==='missing_task'){p.tasks.pop();z.push(...await validateProgram(p))}
else if(c==='extra_task'){p.tasks.push({...cp(p.tasks[0]),task_id:'PPQR-016'});z.push(...await validateProgram(p))}
else if(c==='duplicate_task'){p.tasks.push(cp(p.tasks[0]));z.push(...await validateProgram(p))}
else if(c==='dependency_mutation'){p.tasks.find(x=>x.task_id==='PPQR-004').depends_on=['PPQR-001'];z.push(...await validateProgram(p))}
else if(c==='self_dependency'){p.tasks.find(x=>x.task_id==='PPQR-004').depends_on=['PPQR-004'];z.push(...await validateProgram(p))}
else if(c==='dependency_cycle'||c==='dependency_cycle_hidden'){const t=p.tasks.find(x=>x.task_id==='PPQR-001');t.depends_on=['PPQR-015'];if(c==='dependency_cycle'){t.execution_state='dependency_blocked';t.blocking_state={blocked:true,blocking_reasons:['incomplete_dependency:PPQR-015']}}z.push(...await validateProgram(p))}
else if(c==='implemented_incomplete_dependency'){p.tasks.find(x=>x.task_id==='PPQR-002').implementation_state='implemented';z.push(...await validateProgram(p))}
else if(c==='complete_incomplete_dependency'){const t=p.tasks.find(x=>x.task_id==='PPQR-002');t.completion_state='complete';t.execution_state='eligible';z.push(...await validateProgram(p))}
else if(c==='program_complete_incomplete_task')z.push(...await validateProgram(p,{programComplete:true}));
else if(c==='unauthorized_eligible'){p.tasks[0].authorization_state='unauthorized';z.push(...await validateProgram(p))}
else if(c==='exact_scope')z.push(...await validateScope(s));
else if(c==='valid_amendment'){const old=s.scope_revision,a={revision:'',previous_revision:old,reason:'fixture',authorization_commit_sha:'a'.repeat(40),added_paths:['fixture/path']};a.revision=amendmentHash(a);s.amendments=[a];s.committed_paths.push('fixture/path');s.scope_revision=scopeHash(s);z.push(...await validateScope(s,{actual:s.committed_paths}))}
else if(c==='undeclared_changed_path')z.push(...await validateScope(s,{actual:[...s.committed_paths,'x']}));
else if(c==='declared_unchanged_path')z.push(...await validateScope(s,{actual:s.committed_paths.slice(1)}));
else if(c==='stale_base')z.push(...await validateScope(s,{base:'f'.repeat(40)}));
else if(c==='stale_revision'){s.scope_revision='sha256:'+'0'.repeat(64);z.push(...await validateScope(s))}
else if(c==='wrong_task'){s.task_id='PPQR-001';s.scope_revision=scopeHash(s);z.push(...await validateScope(s))}
else if(c==='wrong_program'){s.program_id='WRONG';s.scope_revision=scopeHash(s);z.push(d('PQG_SCHEMA_INVALID','wrong const',S),...await validateScope(s))}
else if(c==='silent_deletion')z.push(...await validateScope(s,{deleted:['x']}));
else if(c==='deferred_deleted')z.push(...await validateScope(s,{deferredDeleted:true}));
else if(c==='forbidden_operation')z.push(...await validateScope(s,{forbidden:'modify domains/**'}));
else if(c==='scope_expansion_same_revision'){s.committed_paths.push('x');z.push(...await validateScope(s,{expandedWithoutRevision:true,actual:s.committed_paths}))}
else if(c==='retroactive_amendment')z.push(...await validateScope(s,{retroactive:true}));
return uniq(z.map(x=>x.code))}
