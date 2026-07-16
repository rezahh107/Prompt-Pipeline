import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_ROUTES } from "./routes.js";
import { invalid, policy, unsupported } from "./errors.js";
import { validateSchema } from "./schema.js";
import type { ActionKind, RendererInput, RendererOutput } from "./types.js";
type Schema=Record<string,unknown>;
const here=dirname(fileURLToPath(import.meta.url));
const inputSchema=JSON.parse(readFileSync(join(here,"assets/input.schema.json"),"utf8")) as Schema;
const outputSchema=JSON.parse(readFileSync(join(here,"assets/output.schema.json"),"utf8")) as Schema;
const isObj=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const prop=(name:string):Record<string,unknown>=>((inputSchema.properties as Record<string,Record<string,unknown>>)[name] ?? {});
const enumValues=(name:string):unknown[]=>Array.isArray(prop(name).enum)?prop(name).enum as unknown[]:[];
const contextLimits=(inputSchema["x-context-profile-limits"]??{}) as Record<string,{max_context_items:number;max_context_tokens:number}>;
function schemaDetails(schema:Schema,value:unknown):string[]{return validateSchema(schema,value).map((error)=>`${error.path}: ${error.message}`)}
function duplicateValues(values:string[]):string[]{const seen=new Set<string>(), duplicates=new Set<string>();for(const value of values){if(seen.has(value))duplicates.add(value);seen.add(value);}return [...duplicates].sort();}
export function validateInput(raw:unknown):RendererInput{
  if(!isObj(raw))throw invalid("input must be a JSON object");
  if(raw.schema_version!==prop("schema_version").const)throw unsupported("unsupported schema_version",[String(raw.schema_version)]);
  if(raw.pr_inspector_protocol_version!==prop("pr_inspector_protocol_version").const)throw unsupported("unsupported pr_inspector_protocol_version",[String(raw.pr_inspector_protocol_version)]);
  if(!enumValues("action_kind").includes(raw.action_kind))throw unsupported("unsupported action_kind",[String(raw.action_kind)]);
  if(!enumValues("target_model_profile").includes(raw.target_model_profile))throw unsupported("unsupported target_model_profile",[String(raw.target_model_profile)]);
  if(!enumValues("context_policy_profile").includes(raw.context_policy_profile))throw unsupported("unsupported context_policy_profile",[String(raw.context_policy_profile)]);
  if(raw.prompt_language!==prop("prompt_language").const)throw unsupported("unsupported prompt_language",[String(raw.prompt_language)]);
  if(raw.evaluation_suite_id!==prop("evaluation_suite_id").const)throw unsupported("unsupported evaluation_suite_id",[String(raw.evaluation_suite_id)]);
  const errors=schemaDetails(inputSchema,raw);
  const route=ACTION_ROUTES[raw.action_kind as ActionKind];
  if(!route)throw unsupported("unsupported action_kind",[String(raw.action_kind)]);
  if(raw.recipient!==route.recipient)errors.push(`$.recipient: must be ${route.recipient}`);
  if(raw.may_modify_code!==route.may_modify_code)errors.push(`$.may_modify_code: must be ${route.may_modify_code}`);
  if(raw.prompt_required!==route.prompt_required)errors.push(`$.prompt_required: must be ${route.prompt_required}`);
  if(raw.prompt_kind!==route.prompt_kind)errors.push(`$.prompt_kind: must be ${String(route.prompt_kind)}`);
  if(route.approval_requirement!==null&&raw.approval_requirement!==route.approval_requirement)errors.push(`$.approval_requirement: must be ${route.approval_requirement}`);
  if(!route.allowed_technical_statuses.includes(raw.technical_status as never))errors.push(`$.technical_status: incompatible with ${raw.action_kind}`);
  if(!route.allowed_review_validities.includes(raw.review_validity as never))errors.push(`$.review_validity: incompatible with ${raw.action_kind}`);
  if((raw.action_kind==="repair"||raw.action_kind==="repair_and_verify")&&(!Array.isArray(raw.findings)||raw.findings.length===0))errors.push("$.findings: repair route requires at least one canonical finding");
  const limit=contextLimits[String(raw.context_policy_profile)];
  if(limit&&isObj(raw.context_budget)){
    if(Number(raw.context_budget.max_context_items)>limit.max_context_items)errors.push(`$.context_budget/max_context_items: exceeds ${raw.context_policy_profile} profile`);
    if(Number(raw.context_budget.max_context_tokens)>limit.max_context_tokens)errors.push(`$.context_budget/max_context_tokens: exceeds ${raw.context_policy_profile} profile`);
    if(Array.isArray(raw.context_items)){
      if(raw.context_items.length>Number(raw.context_budget.max_context_items))errors.push("$.context_items: count exceeds context budget");
      const estimated=raw.context_items.reduce((sum,item)=>sum+(isObj(item)&&typeof item.content==="string"?Math.ceil(item.content.length/4):0),0);
      if(estimated>Number(raw.context_budget.max_context_tokens))errors.push("$.context_items: estimated tokens exceed context budget");
      const ids=raw.context_items.map((item)=>isObj(item)?item.id:undefined).filter((id):id is string=>typeof id==="string");
      if(duplicateValues(ids).length)errors.push("$.context_items: duplicate ids are forbidden");
    }
  }
  if(Array.isArray(raw.findings)&&Array.isArray(raw.evidence_records)){
    const findingIds=raw.findings.map((item)=>isObj(item)&&typeof item.finding_id==="string"?item.finding_id:"").filter(Boolean);
    const evidenceIds=raw.evidence_records.map((item)=>isObj(item)&&typeof item.evidence_id==="string"?item.evidence_id:"").filter(Boolean);
    for(const id of duplicateValues(findingIds))errors.push(`$.findings: duplicate finding_id ${id}`);
    for(const id of duplicateValues(evidenceIds))errors.push(`$.evidence_records: duplicate evidence_id ${id}`);
    const evidenceSet=new Set(evidenceIds), findingSet=new Set(findingIds);
    for(const [index,item] of raw.findings.entries())if(isObj(item)&&Array.isArray(item.evidence_refs))for(const ref of item.evidence_refs)if(typeof ref==="string"&&!evidenceSet.has(ref))errors.push(`$.findings/${index}/evidence_refs: unknown evidence ${ref}`);
    for(const [index,item] of raw.evidence_records.entries())if(isObj(item)&&typeof item.reviewed_head_sha==="string"&&typeof raw.reviewed_head_sha==="string"&&raw.reviewed_head_sha!=="UNKNOWN"&&item.reviewed_head_sha!==raw.reviewed_head_sha)errors.push(`$.evidence_records/${index}/reviewed_head_sha: must match reviewed_head_sha`);
    if(isObj(raw.repair_handoff)&&Array.isArray(raw.repair_handoff.affected_findings))for(const [index,item] of raw.repair_handoff.affected_findings.entries())if(isObj(item)&&typeof item.finding_id==="string"&&!findingSet.has(item.finding_id))errors.push(`$.repair_handoff/affected_findings/${index}/finding_id: unknown finding ${item.finding_id}`);
  }
  if(Array.isArray(raw.reason_codes)&&Array.isArray(raw.reason_details)){
    const detailCodes=new Set(raw.reason_details.map((item)=>isObj(item)&&typeof item.reason_code==="string"?item.reason_code:"").filter(Boolean));
    for(const code of raw.reason_codes)if(typeof code==="string"&&!detailCodes.has(code))errors.push(`$.reason_details: missing detail for ${code}`);
  }
  if(errors.length)throw invalid("input validation failed",errors);
  return raw as unknown as RendererInput;
}
export function validateOutput(output:RendererOutput):void{
  const errors=schemaDetails(outputSchema,output);
  const route=ACTION_ROUTES[output.action_kind];
  if(!route)errors.push("$.action_kind: unsupported action");
  else{
    if(output.prompt_required!==route.prompt_required)errors.push("$.prompt_required: route mismatch");
    if(output.prompt_kind!==route.prompt_kind)errors.push("$.prompt_kind: route mismatch");
    if(output.recipient!==route.recipient)errors.push("$.recipient: route mismatch");
    if(output.may_modify_code!==route.may_modify_code)errors.push("$.may_modify_code: route mismatch");
    if(route.approval_requirement!==null&&output.approval_requirement!==route.approval_requirement)errors.push("$.approval_requirement: route mismatch");
    if(!route.allowed_technical_statuses.includes(output.technical_status))errors.push("$.technical_status: route mismatch");
    if(!route.allowed_review_validities.includes(output.review_validity))errors.push("$.review_validity: route mismatch");
  }
  if(output.prompt_required){if(typeof output.rendered_prompt!=="string"||!output.rendered_prompt)errors.push("$.rendered_prompt: prompt-required output missing prompt");}
  else if(output.rendered_prompt!==null||output.rendered_prompt_sha256!==null)errors.push("$.rendered_prompt: no-prompt output must contain null prompt and hash");
  if(output.human_review.approval_satisfied!==false)errors.push("$.human_review/approval_satisfied: renderer cannot satisfy approval");
  const generator=output.generator as Record<string,unknown>;
  if(generator.source_commit_verified===true&&generator.source_identity_source!=="git")errors.push("$.generator/source_identity_source: verified source must be git");
  if(generator.source_commit_verified===false&&generator.dirty===false)errors.push("$.generator/dirty: unverified source cannot claim clean build");
  if(errors.length)throw policy("output validation failed",errors);
}
