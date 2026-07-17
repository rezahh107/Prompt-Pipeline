import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCodeUnits, sha256, stableJson } from "./canonical.js";
import { ACTION_ROUTES } from "./routes.js";
import { invalid, policy, unsupported } from "./errors.js";
import { validateSchema } from "./schema.js";
import type { ActionKind, CandidateReason, CanonicalReason, ReasonSnapshot, RendererInput, RendererOutput } from "./types.js";

type Schema=Record<string,unknown>;
const HERE=dirname(fileURLToPath(import.meta.url));
const ASSETS=join(HERE,"assets");
const inputSchema=JSON.parse(readFileSync(join(ASSETS,"input.schema.json"),"utf8")) as Schema;
const outputSchema=JSON.parse(readFileSync(join(ASSETS,"output.schema.json"),"utf8")) as Schema;
const reasonSnapshot=JSON.parse(readFileSync(join(ASSETS,"reason-compatibility.v1.11.0.json"),"utf8")) as ReasonSnapshot;
const consumerSnapshot=JSON.parse(readFileSync(join(ASSETS,"consumer-compatibility.v1.11.0.json"),"utf8")) as Record<string,unknown>;
const isObj=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const prop=(name:string):Record<string,unknown>=>((inputSchema.properties as Record<string,Record<string,unknown>>)[name]??{});
const enumValues=(name:string):unknown[]=>Array.isArray(prop(name).enum)?prop(name).enum as unknown[]:[];
const contextLimits=(inputSchema["x-context-profile-limits"]??{}) as Record<string,{max_context_items:number;max_context_tokens:number}>;
const exactSha=/^[0-9a-f]{40}$/;
const repairActions=new Set<ActionKind>(["repair","repair_and_verify"]);
const reasonsByCode=new Map<string,CanonicalReason>(reasonSnapshot.canonical_reasons.map((item)=>[item.reason_code,item]));
const candidateByCode=new Map<string,CandidateReason>(reasonSnapshot.candidate_reason_domains.map((item)=>[item.reason_code,item]));

function schemaDetails(schema:Schema,value:unknown):string[]{return validateSchema(schema,value).map((error)=>`${error.path}: ${error.message}`);}
function duplicateValues(values:string[]):string[]{const seen=new Set<string>(),duplicates=new Set<string>();for(const value of values){if(seen.has(value))duplicates.add(value);seen.add(value);}return [...duplicates].sort(compareCodeUnits);}
function expectedTechnicalStatus(reasons:CanonicalReason[]):string{if(reasons.some((item)=>item.technical_status_effect==="RED"))return "RED_DO_NOT_MERGE";if(reasons.some((item)=>item.technical_status_effect==="YELLOW"))return "YELLOW_CHANGES_OR_VERIFICATION_REQUIRED";return "GREEN_TECHNICALLY_READY";}
function expectedCandidateStatus(value:string):string{return value==="GREEN_TECHNICALLY_READY"?"GREEN":value==="RED_DO_NOT_MERGE"?"RED":"YELLOW";}
function expectedGovernanceFollowUp(status:string):string{return status==="NOT_REQUESTED"||status==="VERIFIED"?"none":status==="NOT_VERIFIABLE"?"access_limitation":"informational_gap";}
function selectedReasonHash():string{return sha256(stableJson({canonical_reasons:reasonSnapshot.canonical_reasons,candidate_reason_domains:reasonSnapshot.candidate_reason_domains}));}
function consumerHash():string{const copy={...consumerSnapshot};delete copy.snapshot_sha256;return sha256(stableJson(copy));}

function validateSnapshotIdentity(errors:string[]):void{
  if(reasonSnapshot.snapshot_schema!=="pr_inspector_reason_compatibility.v1")errors.push("$.compatibility: unsupported reason snapshot schema");
  if(reasonSnapshot.source_protocol_version!=="v1.11.0")errors.push("$.compatibility: reason snapshot protocol mismatch");
  if(reasonSnapshot.source_inspector_repository!=="rezahh107/PR-Inspector")errors.push("$.compatibility: reason snapshot repository mismatch");
  if(reasonSnapshot.source_inspector_commit!=="f0f74bba89e4c85f4a4b10c706a2be2980d71c25")errors.push("$.compatibility: reason snapshot commit mismatch");
  if(reasonSnapshot.source_path!=="protocols/v1.11.0/registries/DECISION_REASON_REGISTRY.yaml")errors.push("$.compatibility: reason snapshot path mismatch");
  if(reasonSnapshot.source_git_blob_sha!=="ba50e4eb2bf2918ed3a46535c1e3490566cdc7c5")errors.push("$.compatibility: reason snapshot Git blob mismatch");
  if(reasonSnapshot.selected_fields_sha256!==selectedReasonHash())errors.push("$.compatibility: reason snapshot selected-fields hash mismatch");
  if(consumerSnapshot.consumer_protocol_version!=="v1.11.0"||consumerSnapshot.inspector_commit!=="f0f74bba89e4c85f4a4b10c706a2be2980d71c25"||consumerSnapshot.active_contract!=="pr_inspector_action.v2")errors.push("$.compatibility: consumer snapshot identity mismatch");
  if(consumerSnapshot.snapshot_sha256!==consumerHash())errors.push("$.compatibility: consumer snapshot hash mismatch");
}

function validateReasons(raw:Record<string,unknown>,action:ActionKind,errors:string[]):void{
  const codes=Array.isArray(raw.reason_codes)?raw.reason_codes.filter((item):item is string=>typeof item==="string"):[];
  const details=Array.isArray(raw.reason_details)?raw.reason_details:[];
  for(const code of duplicateValues(codes))errors.push(`$.reason_codes: duplicate reason ${code}`);
  const detailCodes=details.map((item)=>isObj(item)&&typeof item.reason_code==="string"?item.reason_code:"").filter(Boolean);
  for(const code of duplicateValues(detailCodes))errors.push(`$.reason_details: duplicate reason detail ${code}`);
  const detailSet=new Set(detailCodes),codeSet=new Set(codes);
  for(const code of codes)if(!detailSet.has(code))errors.push(`$.reason_details: missing detail for ${code}`);
  for(const code of detailCodes)if(!codeSet.has(code))errors.push(`$.reason_details: orphan detail for ${code}`);
  const resolved:CanonicalReason[]=[];
  for(const [index,detail] of details.entries()){
    if(!isObj(detail)||typeof detail.reason_code!=="string")continue;
    const canonical=reasonsByCode.get(detail.reason_code);
    if(!canonical){errors.push(`$.reason_details/${index}/reason_code: unregistered reason`);continue;}
    resolved.push(canonical);
    if(detail.decision_domain!==canonical.decision_domain)errors.push(`$.reason_details/${index}/decision_domain: must be ${canonical.decision_domain}`);
    if(detail.recovery_action!==canonical.recovery_action)errors.push(`$.reason_details/${index}/recovery_action: must be ${canonical.recovery_action}`);
  }
  const route=ACTION_ROUTES[action];
  for(const reason of resolved)if(!route.allowed_reason_effects.includes(reason.action_effect))errors.push(`$.reason_codes: ${reason.reason_code} action effect ${reason.action_effect} is incompatible with ${action}`);
  const requiringReason=!new Set<ActionKind>(["merge_now","blocked_internal_error"]).has(action);
  if(requiringReason&&resolved.length===0)errors.push(`$.reason_codes: ${action} requires at least one registered canonical reason`);
  if(!requiringReason&&resolved.length>0)errors.push(`$.reason_codes: ${action} must not carry canonical action reasons`);
  if(action==="repair_and_verify"){
    if(!resolved.some((item)=>item.action_effect==="repair"))errors.push("$.reason_codes: repair_and_verify requires a registered repair reason");
    if(!resolved.some((item)=>item.action_effect==="verify"))errors.push("$.reason_codes: repair_and_verify requires a registered verify reason");
  }
  if(action==="repair"&&resolved.some((item)=>item.decision_domain==="governance"))errors.push("$.reason_codes: governance-only reasons cannot authorize technical repair");
  if(raw.may_modify_code===true&&!resolved.some((item)=>item.action_effect==="repair"&&item.may_modify_code))errors.push("$.reason_codes: modifying authority requires a registered repair reason");
  if(action!=="repair_and_verify"){
    for(const reason of resolved){
      if(reason.recipient!==raw.recipient)errors.push(`$.recipient: ${reason.reason_code} requires ${reason.recipient}`);
      if(reason.may_modify_code!==raw.may_modify_code)errors.push(`$.may_modify_code: ${reason.reason_code} requires ${reason.may_modify_code}`);
      if(reason.prompt_kind!==raw.prompt_kind)errors.push(`$.prompt_kind: ${reason.reason_code} requires ${String(reason.prompt_kind)}`);
    }
  }
  const technicalReasons=resolved.filter((item)=>item.decision_domain==="technical");
  const expected=expectedTechnicalStatus(technicalReasons);
  if(action!=="blocked_internal_error"&&raw.technical_status!==expected)errors.push(`$.technical_status: registered technical reasons require ${expected}`);
}

function validateCandidateContext(raw:Record<string,unknown>,errors:string[]):void{
  const technical=isObj(raw.technical_decision)?raw.technical_decision:null;
  const governance=isObj(raw.governance_decision)?raw.governance_decision:null;
  const overall=isObj(raw.overall_recommendation)?raw.overall_recommendation:null;
  const followUp=isObj(raw.governance_follow_up)?raw.governance_follow_up:null;
  const reconciliation=isObj(raw.external_review_reconciliation)?raw.external_review_reconciliation:null;
  if(technical){
    const expected=expectedCandidateStatus(String(raw.technical_status));
    if(technical.status!==expected)errors.push(`$.technical_decision/status: must be ${expected}`);
    const codes=Array.isArray(technical.reason_codes)?technical.reason_codes:[];
    for(const code of codes){const entry=typeof code==="string"?candidateByCode.get(code):undefined;if(!entry||entry.decision_domain!=="technical")errors.push(`$.technical_decision/reason_codes: invalid technical reason ${String(code)}`);}
    const effects=codes.map((code)=>typeof code==="string"?candidateByCode.get(code)?.status_effect:undefined);const projected=effects.includes("RED")?"RED":effects.includes("YELLOW")?"YELLOW":"GREEN";if(technical.status!==projected)errors.push(`$.technical_decision/status: registered reasons require ${projected}`);
    if(technical.status!=="GREEN"&&codes.length===0)errors.push("$.technical_decision/reason_codes: non-Green technical decision requires a registered technical reason");
    if(technical.status==="GREEN"&&codes.length>0)errors.push("$.technical_decision/reason_codes: Green technical decision must not carry reasons");
  }
  if(governance){
    const codes=Array.isArray(governance.reason_codes)?governance.reason_codes:[];
    for(const code of codes){const entry=typeof code==="string"?candidateByCode.get(code):undefined;if(!entry||entry.decision_domain!=="governance")errors.push(`$.governance_decision/reason_codes: invalid governance reason ${String(code)}`);}
    const effects=codes.map((code)=>typeof code==="string"?candidateByCode.get(code)?.status_effect:undefined);const projected=effects.includes("NOT_VERIFIABLE")?"NOT_VERIFIABLE":effects.includes("GAP_FOUND")?"GAP_FOUND":String(governance.status);if(codes.length>0&&governance.status!==projected)errors.push(`$.governance_decision/status: registered reasons require ${projected}`);
    if(["GAP_FOUND","NOT_VERIFIABLE"].includes(String(governance.status))&&codes.length===0)errors.push("$.governance_decision/reason_codes: governance gap requires a registered governance reason");
    if(["NOT_REQUESTED","VERIFIED"].includes(String(governance.status))&&codes.length>0)errors.push("$.governance_decision/reason_codes: non-gap governance status must not carry reasons");
    if(raw.inspection_profile==="minimal"&&governance.status!=="NOT_REQUESTED")errors.push("$.governance_decision/status: minimal profile must be NOT_REQUESTED");
  }
  if(overall&&technical&&governance){
    if(overall.technical_ready!==(technical.status==="GREEN"))errors.push("$.overall_recommendation/technical_ready: contradicts technical decision");
    if(overall.merge_governance_verified!==(governance.status==="VERIFIED"))errors.push("$.overall_recommendation/merge_governance_verified: contradicts governance decision");
  }
  if(followUp&&governance){const expected=expectedGovernanceFollowUp(String(governance.status));if(followUp.kind!==expected)errors.push(`$.governance_follow_up/kind: must be ${expected}`);if(followUp.may_modify_code!==false||followUp.prompt_required!==false)errors.push("$.governance_follow_up: governance follow-up cannot carry modification or prompt authority");}
  if(reconciliation&&technical){
    const total=Number(reconciliation.open_bot_sources_total),inspected=Number(reconciliation.inspected_total);const uninspected=Array.isArray(reconciliation.uninspected_source_ids)?reconciliation.uninspected_source_ids:[];
    if(inspected>total)errors.push("$.external_review_reconciliation/inspected_total: exceeds source total");
    if(reconciliation.collection_status==="COMPLETE"&&(inspected!==total||uninspected.length>0))errors.push("$.external_review_reconciliation: COMPLETE collection has missing sources");
    if(reconciliation.collection_status==="INCOMPLETE"&&(inspected>=total||uninspected.length===0))errors.push("$.external_review_reconciliation: INCOMPLETE collection must identify missing sources");
    const technicalCodes=Array.isArray(technical.reason_codes)?technical.reason_codes:[];
    if(reconciliation.collection_status!=="COMPLETE"&&!technicalCodes.includes("bot_collection_incomplete"))errors.push("$.technical_decision/reason_codes: incomplete bot collection requires bot_collection_incomplete");
    const validIds=new Set(Array.isArray(reconciliation.valid_blocking_finding_ids)?reconciliation.valid_blocking_finding_ids.filter((item):item is string=>typeof item==="string"):[]);
    if(technicalCodes.includes("unresolved_valid_bot_finding")&&validIds.size===0)errors.push("$.external_review_reconciliation/valid_blocking_finding_ids: unresolved bot finding requires an independently valid blocking finding");
    const findingIds=new Set(Array.isArray(raw.findings)?raw.findings.map((item)=>isObj(item)&&typeof item.finding_id==="string"?item.finding_id:"").filter(Boolean):[]);
    for(const id of validIds)if(!findingIds.has(id))errors.push(`$.external_review_reconciliation/valid_blocking_finding_ids: unknown finding ${id}`);
  }
}

export function validateInput(raw:unknown):RendererInput{
  if(!isObj(raw))throw invalid("input must be a JSON object");
  if(raw.schema_version!==prop("schema_version").const)throw unsupported("unsupported schema_version",[String(raw.schema_version)]);
  if(raw.pr_inspector_protocol_version!==prop("pr_inspector_protocol_version").const)throw unsupported("unsupported pr_inspector_protocol_version",[String(raw.pr_inspector_protocol_version)]);
  if(!enumValues("action_kind").includes(raw.action_kind))throw unsupported("unsupported action_kind",[String(raw.action_kind)]);
  if(!enumValues("target_model_profile").includes(raw.target_model_profile))throw unsupported("unsupported target_model_profile",[String(raw.target_model_profile)]);
  if(!enumValues("context_policy_profile").includes(raw.context_policy_profile))throw unsupported("unsupported context_policy_profile",[String(raw.context_policy_profile)]);
  if(raw.prompt_language!==prop("prompt_language").const)throw unsupported("unsupported prompt_language",[String(raw.prompt_language)]);
  if(raw.evaluation_suite_id!==prop("evaluation_suite_id").const)throw unsupported("unsupported evaluation_suite_id",[String(raw.evaluation_suite_id)]);
  const errors=schemaDetails(inputSchema,raw);validateSnapshotIdentity(errors);
  const action=raw.action_kind as ActionKind;const route=ACTION_ROUTES[action];if(!route)throw unsupported("unsupported action_kind",[String(raw.action_kind)]);
  if(raw.recipient!==route.recipient)errors.push(`$.recipient: must be ${route.recipient}`);if(raw.may_modify_code!==route.may_modify_code)errors.push(`$.may_modify_code: must be ${route.may_modify_code}`);if(raw.prompt_required!==route.prompt_required)errors.push(`$.prompt_required: must be ${route.prompt_required}`);if(raw.prompt_kind!==route.prompt_kind)errors.push(`$.prompt_kind: must be ${String(route.prompt_kind)}`);if(route.approval_requirement!==null&&raw.approval_requirement!==route.approval_requirement)errors.push(`$.approval_requirement: must be ${route.approval_requirement}`);if(!route.allowed_technical_statuses.includes(raw.technical_status as never))errors.push(`$.technical_status: incompatible with ${raw.action_kind}`);if(!route.allowed_review_validities.includes(raw.review_validity as never))errors.push(`$.review_validity: incompatible with ${raw.action_kind}`);
  if(raw.review_validity==="CURRENT"){
    if(typeof raw.reviewed_head_sha!=="string"||!exactSha.test(raw.reviewed_head_sha))errors.push("$.reviewed_head_sha: CURRENT requires an exact lowercase 40-character commit SHA");
    if(typeof raw.base_sha!=="string"||!exactSha.test(raw.base_sha))errors.push("$.base_sha: CURRENT requires an exact lowercase 40-character commit SHA");
  }
  if(raw.may_modify_code===true&&(raw.review_validity!=="CURRENT"||typeof raw.reviewed_head_sha!=="string"||!exactSha.test(raw.reviewed_head_sha)))errors.push("$.reviewed_head_sha: modifying authority requires an exact CURRENT reviewed head");
  if(!repairActions.has(action)&&raw.repair_handoff!==null)errors.push(`$.repair_handoff: ${action} must not carry repair authority`);if(repairActions.has(action)&&(!Array.isArray(raw.findings)||raw.findings.length===0))errors.push("$.findings: repair route requires at least one canonical finding");
  const limit=contextLimits[String(raw.context_policy_profile)];if(limit&&isObj(raw.context_budget)){if(Number(raw.context_budget.max_context_items)>limit.max_context_items)errors.push(`$.context_budget/max_context_items: exceeds ${raw.context_policy_profile} profile`);if(Number(raw.context_budget.max_context_tokens)>limit.max_context_tokens)errors.push(`$.context_budget/max_context_tokens: exceeds ${raw.context_policy_profile} profile`);if(Array.isArray(raw.context_items)){if(raw.context_items.length>Number(raw.context_budget.max_context_items))errors.push("$.context_items: count exceeds context budget");const estimated=raw.context_items.reduce((sum,item)=>sum+(isObj(item)&&typeof item.content==="string"?Math.ceil(item.content.length/4):0),0);if(estimated>Number(raw.context_budget.max_context_tokens))errors.push("$.context_items: estimated tokens exceed context budget");const ids=raw.context_items.map((item)=>isObj(item)?item.id:undefined).filter((id):id is string=>typeof id==="string");if(duplicateValues(ids).length)errors.push("$.context_items: duplicate ids are forbidden");}}
  if(Array.isArray(raw.findings)&&Array.isArray(raw.evidence_records)){const findingIds=raw.findings.map((item)=>isObj(item)&&typeof item.finding_id==="string"?item.finding_id:"").filter(Boolean);const evidenceIds=raw.evidence_records.map((item)=>isObj(item)&&typeof item.evidence_id==="string"?item.evidence_id:"").filter(Boolean);for(const id of duplicateValues(findingIds))errors.push(`$.findings: duplicate finding_id ${id}`);for(const id of duplicateValues(evidenceIds))errors.push(`$.evidence_records: duplicate evidence_id ${id}`);const evidenceSet=new Set(evidenceIds),findingSet=new Set(findingIds);for(const [index,item] of raw.findings.entries())if(isObj(item)&&Array.isArray(item.evidence_refs))for(const ref of item.evidence_refs)if(typeof ref==="string"&&!evidenceSet.has(ref))errors.push(`$.findings/${index}/evidence_refs: unknown evidence ${ref}`);for(const [index,item] of raw.evidence_records.entries())if(isObj(item)&&typeof item.reviewed_head_sha==="string"&&typeof raw.reviewed_head_sha==="string"&&item.reviewed_head_sha!==raw.reviewed_head_sha)errors.push(`$.evidence_records/${index}/reviewed_head_sha: must match reviewed_head_sha`);if(isObj(raw.repair_handoff)&&Array.isArray(raw.repair_handoff.affected_findings))for(const [index,item] of raw.repair_handoff.affected_findings.entries())if(isObj(item)&&typeof item.finding_id==="string"&&!findingSet.has(item.finding_id))errors.push(`$.repair_handoff/affected_findings/${index}/finding_id: unknown finding ${item.finding_id}`);}
  validateReasons(raw,action,errors);validateCandidateContext(raw,errors);
  if(errors.length)throw invalid("input validation failed",errors);return raw as unknown as RendererInput;
}

export function validateOutput(output:RendererOutput):void{
  const errors=schemaDetails(outputSchema,output);const route=ACTION_ROUTES[output.action_kind];if(!route)errors.push("$.action_kind: unsupported action");else{if(output.prompt_required!==route.prompt_required)errors.push("$.prompt_required: route mismatch");if(output.prompt_kind!==route.prompt_kind)errors.push("$.prompt_kind: route mismatch");if(output.recipient!==route.recipient)errors.push("$.recipient: route mismatch");if(output.may_modify_code!==route.may_modify_code)errors.push("$.may_modify_code: route mismatch");if(route.approval_requirement!==null&&output.approval_requirement!==route.approval_requirement)errors.push("$.approval_requirement: route mismatch");if(!route.allowed_technical_statuses.includes(output.technical_status))errors.push("$.technical_status: route mismatch");if(!route.allowed_review_validities.includes(output.review_validity))errors.push("$.review_validity: route mismatch");}
  if(output.identity.review_validity!==output.review_validity)errors.push("$.identity/review_validity: output identity mismatch");if(output.identity.review_validity==="CURRENT"&&(!exactSha.test(output.identity.reviewed_head_sha)||!exactSha.test(output.identity.base_sha)))errors.push("$.identity: CURRENT output requires exact commit identities");
  const identityHash=sha256(stableJson({target_repository:output.identity.target_repository,pull_request_number:output.identity.pull_request_number,reviewed_head_sha:output.identity.reviewed_head_sha,base_sha:output.identity.base_sha,review_validity:output.identity.review_validity}));if(output.identity.identity_sha256!==identityHash)errors.push("$.identity/identity_sha256: output identity hash mismatch");
  if(output.prompt_required){if(typeof output.rendered_prompt!=="string"||!output.rendered_prompt)errors.push("$.rendered_prompt: prompt-required output missing prompt");else{if(!output.rendered_prompt.includes(`- reviewed_head_sha: ${JSON.stringify(output.identity.reviewed_head_sha)}`))errors.push("$.rendered_prompt: reviewed head identity missing or altered");if(!output.rendered_prompt.includes(`- base_sha: ${JSON.stringify(output.identity.base_sha)}`))errors.push("$.rendered_prompt: base identity missing or altered");}}else if(output.rendered_prompt!==null||output.rendered_prompt_sha256!==null)errors.push("$.rendered_prompt: no-prompt output must contain null prompt and hash");
  if(output.human_review.approval_satisfied!==false)errors.push("$.human_review/approval_satisfied: renderer cannot satisfy approval");const generator=output.generator as Record<string,unknown>;if(generator.source_commit_verified===true&&generator.source_identity_source!=="git")errors.push("$.generator/source_identity_source: verified source must be git");if(generator.source_commit_verified===false&&generator.dirty===false)errors.push("$.generator/dirty: unverified source cannot claim clean build");
  if(errors.length)throw policy("output validation failed",errors);
}
