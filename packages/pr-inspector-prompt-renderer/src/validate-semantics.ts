import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCodeUnits, sha256, stableJson } from "./canonical.js";
import { ACTION_ROUTES } from "./routes.js";
import { invalid, policy } from "./errors.js";
import { validateSchema } from "./schema.js";
import type { ActionKind, CandidateReason, CanonicalReason, CanonicalReasonCode, ReasonSnapshot, RendererInput, RendererOutput, TechnicalStatus } from "./types.js";

type Obj=Record<string,unknown>;
type Schema=Record<string,unknown>;
const HERE=dirname(fileURLToPath(import.meta.url));
const ASSETS=join(HERE,"assets");
const inputSchema=JSON.parse(readFileSync(join(ASSETS,"input.schema.json"),"utf8")) as Schema;
const outputSchema=JSON.parse(readFileSync(join(ASSETS,"output.schema.json"),"utf8")) as Schema;
const reasonSnapshot=JSON.parse(readFileSync(join(ASSETS,"reason-compatibility.v1.11.0.json"),"utf8")) as ReasonSnapshot;
const consumerSnapshot=JSON.parse(readFileSync(join(ASSETS,"consumer-compatibility.v1.11.0.json"),"utf8")) as Record<string,unknown>;
const exactSha=/^[0-9a-f]{40}$/;
const repairActions=new Set<ActionKind>(["repair","repair_and_verify"]);
const reasonsByCode=new Map<CanonicalReasonCode,CanonicalReason>(reasonSnapshot.canonical_reasons.map((item)=>[item.reason_code,item]));
const candidateByCode=new Map<string,CandidateReason>(reasonSnapshot.candidate_reason_domains.map((item)=>[item.reason_code,item]));
const candidateReasonByCanonical=new Map(reasonSnapshot.candidate_reason_by_canonical.map((item)=>[item.canonical_reason_code,item.candidate_reason_code]));
const candidateStatusByTechnical=new Map<TechnicalStatus,string>(reasonSnapshot.candidate_status_by_technical_status.map((item)=>[item.technical_status,item.candidate_status]));
const technicalStatusByEffect=new Map(reasonSnapshot.canonical_status_by_effect.map((item)=>[item.technical_status_effect,item.technical_status]));
const contextLimits=(inputSchema["x-context-profile-limits"]??{}) as Record<string,{max_context_items:number;max_context_tokens:number}>;
const duplicateValues=(values:string[]):string[]=>{const seen=new Set<string>(),dupes=new Set<string>();for(const value of values){if(seen.has(value))dupes.add(value);seen.add(value);}return [...dupes].sort(compareCodeUnits);};
const sameStrings=(actual:unknown[],expected:string[]):boolean=>actual.length===expected.length&&actual.every((value,index)=>value===expected[index]);
const orderedCanonicalReasons=(codes:CanonicalReasonCode[]):CanonicalReason[]=>{const selected=new Set(codes);return reasonSnapshot.canonical_reasons.filter((item)=>selected.has(item.reason_code));};
function expectedTechnicalStatus(reasons:CanonicalReason[]):TechnicalStatus{if(reasons.some((item)=>item.technical_status_effect==="RED"))return technicalStatusByEffect.get("RED")??"RED_DO_NOT_MERGE";if(reasons.some((item)=>item.technical_status_effect==="YELLOW"))return technicalStatusByEffect.get("YELLOW")??"YELLOW_CHANGES_OR_VERIFICATION_REQUIRED";return technicalStatusByEffect.get("NONE")??"GREEN_TECHNICALLY_READY";}
function expectedCandidateReasons(codes:CanonicalReasonCode[]):string[]{const out:string[]=[];const seen=new Set<string>();for(const reason of orderedCanonicalReasons(codes)){const mapped=candidateReasonByCanonical.get(reason.reason_code);if(mapped&&!seen.has(mapped)){seen.add(mapped);out.push(mapped);}}return out;}
const expectedGovernanceFollowUp=(status:string):string=>status==="NOT_REQUESTED"||status==="VERIFIED"?"none":status==="NOT_VERIFIABLE"?"access_limitation":"informational_gap";
const selectedReasonHash=():string=>sha256(stableJson({canonical_status_by_effect:reasonSnapshot.canonical_status_by_effect,candidate_status_by_technical_status:reasonSnapshot.candidate_status_by_technical_status,candidate_reason_by_canonical:reasonSnapshot.candidate_reason_by_canonical,canonical_reasons:reasonSnapshot.canonical_reasons,candidate_reason_domains:reasonSnapshot.candidate_reason_domains}));
function consumerHash():string{const copy={...consumerSnapshot};delete copy.snapshot_sha256;return sha256(stableJson(copy));}
function validateSnapshotIdentity(errors:string[]):void{
  if(reasonSnapshot.snapshot_schema!=="pr_inspector_reason_compatibility.v2")errors.push("$.compatibility: unsupported reason snapshot schema");
  if(reasonSnapshot.source_protocol_version!=="v1.11.0"||reasonSnapshot.source_inspector_repository!=="rezahh107/PR-Inspector"||reasonSnapshot.source_inspector_commit!=="f0f74bba89e4c85f4a4b10c706a2be2980d71c25")errors.push("$.compatibility: reason snapshot identity mismatch");
  if(reasonSnapshot.selected_fields_sha256!==selectedReasonHash())errors.push("$.compatibility: reason snapshot selected-fields hash mismatch");
  if(consumerSnapshot.consumer_protocol_version!=="v1.11.0"||consumerSnapshot.inspector_commit!=="f0f74bba89e4c85f4a4b10c706a2be2980d71c25"||consumerSnapshot.active_contract!=="pr_inspector_action.v2"||consumerSnapshot.snapshot_sha256!==consumerHash())errors.push("$.compatibility: consumer snapshot identity mismatch");
}
function validateReasonSemantics(input:RendererInput,errors:string[]):void{
  const actionCodes=input.next_action_reason_codes;
  const completeCodes=input.reason_details.map((item)=>item.reason_code);
  const completeSet=new Set(completeCodes);
  for(const code of duplicateValues(actionCodes))errors.push(`$.next_action_reason_codes: duplicate reason ${code}`);
  for(const code of duplicateValues(completeCodes))errors.push(`$.reason_details: duplicate reason detail ${code}`);
  for(const code of actionCodes)if(!completeSet.has(code))errors.push(`$.next_action_reason_codes: ${code} is absent from complete reason_details`);
  for(const [index,detail] of input.reason_details.entries()){
    const canonical=reasonsByCode.get(detail.reason_code);
    if(!canonical){errors.push(`$.reason_details/${index}/reason_code: unregistered reason`);continue;}
    if(detail.recovery_action!==canonical.recovery_action)errors.push(`$.reason_details/${index}/recovery_action: must be ${canonical.recovery_action}`);
  }
  const actionReasons=orderedCanonicalReasons(actionCodes),route=ACTION_ROUTES[input.action_kind];
  for(const reason of actionReasons)if(!route.allowed_reason_effects.includes(reason.action_effect))errors.push(`$.next_action_reason_codes: ${reason.reason_code} action effect ${reason.action_effect} is incompatible with ${input.action_kind}`);
  const requiringReason=!new Set<ActionKind>(["merge_now","blocked_internal_error"]).has(input.action_kind);
  if(requiringReason&&actionReasons.length===0)errors.push(`$.next_action_reason_codes: ${input.action_kind} requires at least one registered canonical action reason`);
  if(!requiringReason&&actionReasons.length>0)errors.push(`$.next_action_reason_codes: ${input.action_kind} must not carry canonical action reasons`);
  if(input.action_kind==="repair_and_verify"){
    if(!actionReasons.some((item)=>item.action_effect==="repair"))errors.push("$.next_action_reason_codes: repair_and_verify requires a registered repair reason");
    if(!actionReasons.some((item)=>item.action_effect==="verify"))errors.push("$.next_action_reason_codes: repair_and_verify requires a registered verify reason");
  }
  if(input.may_modify_code&&!actionReasons.some((item)=>item.action_effect==="repair"&&item.may_modify_code))errors.push("$.next_action_reason_codes: modifying authority requires a registered repair reason");
  const completeReasons=orderedCanonicalReasons(completeCodes);
  const expectedStatus=expectedTechnicalStatus(completeReasons);
  if(input.action_kind!=="blocked_internal_error"&&input.technical_status!==expectedStatus)errors.push(`$.technical_status: complete canonical reasons require ${expectedStatus}`);
  const expectedCandidateStatus=candidateStatusByTechnical.get(input.technical_status);
  if(input.action_kind!=="blocked_internal_error"&&input.technical_decision.status!==expectedCandidateStatus)errors.push(`$.technical_decision/status: must be ${String(expectedCandidateStatus)}`);
  const expectedCandidates=expectedCandidateReasons(completeCodes);
  if(input.action_kind!=="blocked_internal_error"&&!sameStrings(input.technical_decision.reason_codes,expectedCandidates))errors.push(`$.technical_decision/reason_codes: must exactly equal all complete canonical reasons ${JSON.stringify(expectedCandidates)}`);
}
function validateCandidateAndReconciliation(input:RendererInput,errors:string[]):void{
  for(const code of input.technical_decision.reason_codes){const entry=candidateByCode.get(code);if(!entry||entry.decision_domain!=="technical")errors.push(`$.technical_decision/reason_codes: invalid technical reason ${code}`);}
  for(const code of input.governance_decision.reason_codes){const entry=candidateByCode.get(code);if(!entry||entry.decision_domain!=="governance")errors.push(`$.governance_decision/reason_codes: invalid governance reason ${code}`);}
  if(input.inspection_profile==="minimal"){
    if(input.governance_decision.status!=="NOT_REQUESTED"||input.governance_decision.reason_codes.length!==0)errors.push("$.governance_decision: minimal profile must be NOT_REQUESTED with no reasons");
  }else{
    const status=input.governance_decision.status,codes=input.governance_decision.reason_codes;
    const valid=(status==="VERIFIED"&&codes.length===0)||(status==="NOT_VERIFIABLE"&&sameStrings(codes,["repository_settings_not_verified"]))||(status==="GAP_FOUND"&&sameStrings(codes,["merge_authorization_unverified"]));
    if(!valid)errors.push("$.governance_decision: strict profile must match an exact active emitted status/reason relation");
  }
  if(input.overall_recommendation.technical_ready!==(input.technical_decision.status==="GREEN"))errors.push("$.overall_recommendation/technical_ready: contradicts technical decision");
  if(input.overall_recommendation.merge_governance_verified!==(input.governance_decision.status==="VERIFIED"))errors.push("$.overall_recommendation/merge_governance_verified: contradicts governance decision");
  const expectedFollowUp=expectedGovernanceFollowUp(input.governance_decision.status);if(input.governance_follow_up.kind!==expectedFollowUp)errors.push(`$.governance_follow_up/kind: must be ${expectedFollowUp}`);
  const reconciliation=input.external_review_reconciliation,total=reconciliation.open_bot_sources_total,inspected=reconciliation.inspected_total;
  if(inspected>total)errors.push("$.external_review_reconciliation/inspected_total: exceeds source total");
  if(reconciliation.collection_status==="COMPLETE"&&(inspected!==total||reconciliation.uninspected_source_ids.length>0))errors.push("$.external_review_reconciliation: COMPLETE collection has missing sources");
  if(reconciliation.collection_status==="INCOMPLETE"&&(inspected>=total||reconciliation.uninspected_source_ids.length===0))errors.push("$.external_review_reconciliation: INCOMPLETE collection must identify missing sources");
  const validIds=new Set(reconciliation.valid_blocking_finding_ids),findingIds=new Set(input.findings.map((item)=>item.finding_id));
  if(input.technical_decision.reason_codes.includes("unresolved_valid_bot_finding")&&validIds.size===0)errors.push("$.external_review_reconciliation/valid_blocking_finding_ids: unresolved bot finding requires an independently valid blocking finding");
  for(const id of validIds)if(!findingIds.has(id))errors.push(`$.external_review_reconciliation/valid_blocking_finding_ids: unknown finding ${id}`);
}
export function validateActiveInputSemantics(input:RendererInput):void{
  const errors:string[]=[];validateSnapshotIdentity(errors);
  const route=ACTION_ROUTES[input.action_kind];
  if(input.recipient!==route.recipient)errors.push(`$.recipient: must be ${route.recipient}`);
  if(input.may_modify_code!==route.may_modify_code)errors.push(`$.may_modify_code: must be ${route.may_modify_code}`);
  if(input.prompt_required!==route.prompt_required)errors.push(`$.prompt_required: must be ${route.prompt_required}`);
  if(input.prompt_kind!==route.prompt_kind)errors.push(`$.prompt_kind: must be ${String(route.prompt_kind)}`);
  if(route.approval_requirement!==null&&input.approval_requirement!==route.approval_requirement)errors.push(`$.approval_requirement: must be ${route.approval_requirement}`);
  if(!route.allowed_technical_statuses.includes(input.technical_status))errors.push(`$.technical_status: incompatible with ${input.action_kind}`);
  if(!route.allowed_review_validities.includes(input.review_validity))errors.push(`$.review_validity: incompatible with ${input.action_kind}`);
  if(input.review_validity==="CURRENT"&&(!exactSha.test(input.reviewed_head_sha)||!exactSha.test(input.base_sha)))errors.push("$.identity: CURRENT requires exact reviewed-head and base SHAs");
  if(input.may_modify_code&&(input.review_validity!=="CURRENT"||!exactSha.test(input.reviewed_head_sha)||!exactSha.test(input.base_sha)))errors.push("$.identity: modifying authority requires exact CURRENT identities");
  if(!repairActions.has(input.action_kind)&&input.repair_handoff!==null)errors.push(`$.repair_handoff: ${input.action_kind} must not carry repair authority`);
  if(repairActions.has(input.action_kind)&&input.findings.length===0)errors.push("$.findings: repair route requires at least one canonical finding");
  const limit=contextLimits[input.context_policy_profile];if(limit){if(input.context_budget.max_context_items>limit.max_context_items)errors.push(`$.context_budget/max_context_items: exceeds ${input.context_policy_profile} profile`);if(input.context_budget.max_context_tokens>limit.max_context_tokens)errors.push(`$.context_budget/max_context_tokens: exceeds ${input.context_policy_profile} profile`);if(input.context_items.length>input.context_budget.max_context_items)errors.push("$.context_items: count exceeds context budget");const estimated=input.context_items.reduce((sum,item)=>sum+Math.ceil(item.content.length/4),0);if(estimated>input.context_budget.max_context_tokens)errors.push("$.context_items: estimated tokens exceed context budget");if(duplicateValues(input.context_items.map((item)=>item.id)).length)errors.push("$.context_items: duplicate ids are forbidden");}
  const findingIds=input.findings.map((item)=>item.finding_id),evidenceIds=input.evidence_records.map((item)=>item.evidence_id),evidenceSet=new Set(evidenceIds),findingSet=new Set(findingIds);
  for(const id of duplicateValues(findingIds))errors.push(`$.findings: duplicate finding_id ${id}`);for(const id of duplicateValues(evidenceIds))errors.push(`$.evidence_records: duplicate evidence_id ${id}`);
  for(const [index,item] of input.findings.entries())for(const ref of item.evidence_refs)if(!evidenceSet.has(ref))errors.push(`$.findings/${index}/evidence_refs: unknown evidence ${ref}`);
  for(const [index,item] of input.evidence_records.entries())if(item.reviewed_head_sha!==input.reviewed_head_sha)errors.push(`$.evidence_records/${index}/reviewed_head_sha: must match reviewed_head_sha`);
  if(input.repair_handoff)for(const [index,item] of input.repair_handoff.affected_findings.entries())if(!findingSet.has(item.finding_id))errors.push(`$.repair_handoff/affected_findings/${index}/finding_id: unknown finding ${item.finding_id}`);
  validateReasonSemantics(input,errors);validateCandidateAndReconciliation(input,errors);
  if(errors.length)throw invalid("input semantic validation failed",errors);
}
export function validateOutput(output:RendererOutput):void{
  const errors=validateSchema(outputSchema,output).map((error)=>`${error.path}: ${error.message}`),route=ACTION_ROUTES[output.action_kind];
  if(!route)errors.push("$.action_kind: unsupported action");else{if(output.prompt_required!==route.prompt_required)errors.push("$.prompt_required: route mismatch");if(output.prompt_kind!==route.prompt_kind)errors.push("$.prompt_kind: route mismatch");if(output.recipient!==route.recipient)errors.push("$.recipient: route mismatch");if(output.may_modify_code!==route.may_modify_code)errors.push("$.may_modify_code: route mismatch");if(route.approval_requirement!==null&&output.approval_requirement!==route.approval_requirement)errors.push("$.approval_requirement: route mismatch");if(!route.allowed_technical_statuses.includes(output.technical_status))errors.push("$.technical_status: route mismatch");if(!route.allowed_review_validities.includes(output.review_validity))errors.push("$.review_validity: route mismatch");}
  if(output.identity.review_validity!==output.review_validity)errors.push("$.identity/review_validity: output identity mismatch");if(output.identity.review_validity==="CURRENT"&&(!exactSha.test(output.identity.reviewed_head_sha)||!exactSha.test(output.identity.base_sha)))errors.push("$.identity: CURRENT output requires exact commit identities");
  const identityHash=sha256(stableJson({target_repository:output.identity.target_repository,pull_request_number:output.identity.pull_request_number,reviewed_head_sha:output.identity.reviewed_head_sha,base_sha:output.identity.base_sha,review_validity:output.identity.review_validity}));if(output.identity.identity_sha256!==identityHash)errors.push("$.identity/identity_sha256: output identity hash mismatch");
  if(output.prompt_required){if(typeof output.rendered_prompt!=="string"||!output.rendered_prompt)errors.push("$.rendered_prompt: prompt-required output missing prompt");else{if(!output.rendered_prompt.includes(`- reviewed_head_sha: ${JSON.stringify(output.identity.reviewed_head_sha)}`))errors.push("$.rendered_prompt: reviewed head identity missing or altered");if(!output.rendered_prompt.includes(`- base_sha: ${JSON.stringify(output.identity.base_sha)}`))errors.push("$.rendered_prompt: base identity missing or altered");}}else if(output.rendered_prompt!==null||output.rendered_prompt_sha256!==null)errors.push("$.rendered_prompt: no-prompt output must contain null prompt and hash");
  if(output.human_review.approval_satisfied!==false)errors.push("$.human_review/approval_satisfied: renderer cannot satisfy approval");const generator=output.generator as Obj;if(generator.source_commit_verified===true&&generator.source_identity_source!=="git")errors.push("$.generator/source_identity_source: verified source must be git");if(generator.source_commit_verified===false&&generator.dirty===false)errors.push("$.generator/dirty: unverified source cannot claim clean build");
  if(errors.length)throw policy("output validation failed",errors);
}
