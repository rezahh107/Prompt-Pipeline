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
export function validateInput(raw:unknown):RendererInput{
  if(!isObj(raw))throw invalid("input must be a JSON object");
  if(raw.schema_version!==prop("schema_version").const)throw unsupported("unsupported schema_version",[String(raw.schema_version)]);
  if(!enumValues("action_kind").includes(raw.action_kind))throw unsupported("unsupported action_kind",[String(raw.action_kind)]);
  if(!enumValues("target_model_profile").includes(raw.target_model_profile))throw unsupported("unsupported target_model_profile",[String(raw.target_model_profile)]);
  if(!enumValues("context_policy_profile").includes(raw.context_policy_profile))throw unsupported("unsupported context_policy_profile",[String(raw.context_policy_profile)]);
  if(raw.evaluation_suite_id!==prop("evaluation_suite_id").const)throw unsupported("unsupported evaluation_suite_id",[String(raw.evaluation_suite_id)]);
  const errors=schemaDetails(inputSchema,raw);
  const route=ACTION_ROUTES[raw.action_kind as ActionKind];
  if(!route)throw unsupported("unsupported action_kind",[String(raw.action_kind)]);
  if(raw.recipient!==route.recipient)errors.push(`$.recipient: must be ${route.recipient}`);
  if(raw.may_modify_code!==route.may_modify_code)errors.push(`$.may_modify_code: must be ${route.may_modify_code}`);
  if(raw.prompt_required!==route.prompt_required)errors.push(`$.prompt_required: must be ${route.prompt_required}`);
  if(raw.prompt_kind!==route.prompt_kind)errors.push(`$.prompt_kind: must be ${String(route.prompt_kind)}`);
  if(raw.action_kind==="rerun_review"&&raw.review_validity==="CURRENT")errors.push("$.review_validity: rerun_review requires non-current validity");
  if(raw.action_kind!=="rerun_review"&&raw.action_kind!=="blocked_internal_error"&&raw.review_validity!=="CURRENT")errors.push("$.review_validity: non-current review must use rerun_review");
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
      if(new Set(ids).size!==ids.length)errors.push("$.context_items: duplicate ids are forbidden");
    }
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
  }
  if(output.prompt_required){if(typeof output.rendered_prompt!=="string"||!output.rendered_prompt)errors.push("$.rendered_prompt: prompt-required output missing prompt");}
  else if(output.rendered_prompt!==null||output.rendered_prompt_sha256!==null)errors.push("$.rendered_prompt: no-prompt output must contain null prompt and hash");
  if(output.human_review.approval_satisfied!==false)errors.push("$.human_review/approval_satisfied: renderer cannot satisfy approval");
  if(errors.length)throw policy("output validation failed",errors);
}
