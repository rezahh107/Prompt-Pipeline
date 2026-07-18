import {cp,uniq} from './core.mjs';
import {validateImpact,validateImpactHistory,rehashImpact} from './scope-progress.mjs';
import {validateLifecycle,completeLedger,reLedger} from './lifecycle.mjs';
export const PROGRESS_LIFECYCLE=new Set(['activation_zero_credit','governance_progress','blocking_defect_zero_delta','maintenance_zero_delta','fabricated_quality_delta','quality_without_evidence','unchanged_obligation_complete','duplicate_obligation','unknown_obligation','unknown_deliverable','baseline_mismatch','progress_scope_mismatch','impact_wrong_head','impact_wrong_task','chronology_gap','duplicate_sequence','predecessor_mismatch','history_fork','historical_mutation','artificial_micro_progress','zero_delta_streak','migration_without_gate','new_only_without_retirement','two_authoritative_paths','zero_delta_quality_credit','premerge_sequence','postmerge_complete_sequence','owner_merge_without_evidence','exact_main_before_owner_merge','stale_exact_main','event_replay','evidence_replay','non_monotonic_time','stale_lifecycle_scope','feature_branch_completion']);
export async function runProgressLifecycle(c,a){const p=cp(a.p),s=cp(a.s),i=cp(a.i),l=cp(a.l),z=[];
if(['activation_zero_credit','governance_progress','blocking_defect_zero_delta','maintenance_zero_delta'].includes(c)){if(c==='governance_progress'){i.work_type='governance_foundation';i.zero_delta=false}if(c==='blocking_defect_zero_delta'){i.work_type='blocking_defect';i.blocking_defect='x'}if(c==='maintenance_zero_delta'){i.work_type='maintenance';i.maintenance_reason='x'}rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='fabricated_quality_delta'||c==='quality_without_evidence'){i.effects.quality_credit=true;i.quality_dimensions_improved=['x'];if(c==='fabricated_quality_delta')i.zero_delta=false;rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='unchanged_obligation_complete')z.push(...await validateImpact(i,p,s,{derived:[]}));
else if(c==='duplicate_obligation'){i.completed_obligation_ids.push(i.completed_obligation_ids[0]);rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:uniq(i.completed_obligation_ids)}))}
else if(c==='unknown_obligation'){i.completed_obligation_ids.push('ACT-999');rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='unknown_deliverable'){i.closed_deliverable_ids.push('UNKNOWN');rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='baseline_mismatch')z.push(...await validateImpact(i,p,s,{baselineBefore:{x:1}}));
else if(c==='progress_scope_mismatch'){i.scope_revision='sha256:'+'0'.repeat(64);rehashImpact(i);z.push(...await validateImpact(i,p,s))}
else if(c==='impact_wrong_head'){i.exact_head_binding={mode:'exact_commit',head_sha:'a'.repeat(40)};rehashImpact(i);z.push(...await validateImpact(i,p,s,{head:'b'.repeat(40)}))}
else if(c==='impact_wrong_task'){i.task_id='PPQR-001';rehashImpact(i);z.push(...await validateImpact(i,p,s))}
else if(c==='chronology_gap'){const j=cp(i);j.impact_id='PROMPT-QUALITY-IMPACT-0002';j.sequence_number=3;j.previous_impact_id=i.impact_id;z.push(...validateImpactHistory([i,j]))}
else if(c==='duplicate_sequence'){const j=cp(i);j.impact_id='PROMPT-QUALITY-IMPACT-0002';j.sequence_number=1;j.previous_impact_id=i.impact_id;z.push(...validateImpactHistory([i,j]))}
else if(c==='predecessor_mismatch'){const j=cp(i);j.impact_id='PROMPT-QUALITY-IMPACT-0002';j.sequence_number=2;j.previous_impact_id='wrong';z.push(...validateImpactHistory([i,j]))}
else if(c==='history_fork'){const j=cp(i),k=cp(i);j.impact_id='PROMPT-QUALITY-IMPACT-0002';j.sequence_number=2;j.previous_impact_id=i.impact_id;k.impact_id='PROMPT-QUALITY-IMPACT-0003';k.sequence_number=3;k.previous_impact_id=i.impact_id;z.push(...validateImpactHistory([i,j,k]))}
else if(c==='historical_mutation')z.push(...validateImpactHistory([i],{mutated:true}));
else if(c==='artificial_micro_progress'){i.zero_delta=false;i.completed_obligation_ids=[];i.closed_deliverable_ids=[];rehashImpact(i);z.push(...await validateImpact(i,p,s))}
else if(c==='zero_delta_streak')z.push(...validateImpactHistory([i],{zeroStreak:true}));
else if(c==='migration_without_gate'){i.effects.migration_promotion='promoted';rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='new_only_without_retirement'){i.zero_delta=false;i.effects.production_authority='new_only';rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='two_authoritative_paths'){i.zero_delta=false;i.production_paths=[{path_id:'a',authoritative:true},{path_id:'b',authoritative:true}];rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='zero_delta_quality_credit'){i.effects.quality_credit=true;rehashImpact(i);z.push(...await validateImpact(i,p,s,{derived:i.completed_obligation_ids}))}
else if(c==='premerge_sequence')z.push(...await validateLifecycle(l,s));
else if(c==='postmerge_complete_sequence'){const x=completeLedger(l,s);z.push(...await validateLifecycle(x.l,s,{head:x.h[0],main:x.h[2],headDigests:new Set([x.g[0]]),mergeDigests:new Set([x.g[1]]),mainDigests:new Set([x.g[2]])}))}
else if(c==='owner_merge_without_evidence'){const x=completeLedger(l,s);x.l.events.pop();x.l.completion_claim=false;x.l.next_required_event='exact_main_verified';reLedger(x.l);z.push(...await validateLifecycle(x.l,s,{head:x.h[0],headDigests:new Set([x.g[0]]),mergeDigests:new Set(),mainDigests:new Set()}))}
else if(c==='exact_main_before_owner_merge'){const x=completeLedger(l,s);x.l.events.splice(-2,1);x.l.events.at(-1).predecessor_event_id=x.l.events.at(-2).event_id;reLedger(x.l);z.push(...await validateLifecycle(x.l,s,{head:x.h[0],main:x.h[2],headDigests:new Set([x.g[0]]),mainDigests:new Set([x.g[2]])}))}
else if(c==='stale_exact_main'){const x=completeLedger(l,s);z.push(...await validateLifecycle(x.l,s,{head:x.h[0],main:'d'.repeat(40),headDigests:new Set([x.g[0]]),mergeDigests:new Set([x.g[1]]),mainDigests:new Set([x.g[2]])}))}
else if(c==='event_replay'){l.events[1].event_id=l.events[0].event_id;l.events[2].predecessor_event_id=l.events[1].event_id;reLedger(l);z.push(...await validateLifecycle(l,s))}
else if(c==='evidence_replay'){l.events[1].evidence[0].sha256=l.events[0].evidence[0].sha256;reLedger(l);z.push(...await validateLifecycle(l,s))}
else if(c==='non_monotonic_time'){l.events[1].occurred_at='2026-07-18T00:00:00Z';reLedger(l);z.push(...await validateLifecycle(l,s));const invalid=cp(a.l);invalid.events[1].occurred_at='not-a-date';reLedger(invalid);z.push(...await validateLifecycle(invalid,s))}
else if(c==='stale_lifecycle_scope'){l.scope_revision='sha256:'+'2'.repeat(64);for(const e of l.events)e.scope_revision=l.scope_revision;reLedger(l);z.push(...await validateLifecycle(l,s))}
else if(c==='feature_branch_completion'){l.completion_claim=true;reLedger(l);z.push(...await validateLifecycle(l,s))}
return uniq(z.map(x=>x.code))}