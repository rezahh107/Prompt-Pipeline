import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCodeUnits, sortedUnique } from "./canonical.js";
import { ACTION_ROUTES } from "./routes.js";
import { invalid } from "./errors.js";
import { validateSchema } from "./schema.js";
import { validateActiveInputSemantics, validateOutput as validateSemanticOutput } from "./validate-semantics.js";
import type { ActionKind, CanonicalReason, CanonicalReasonCode, ReasonDetail, ReasonSnapshot, RendererInput, RendererOutput, TechnicalStatus } from "./types.js";

type Obj=Record<string,unknown>;
type Schema=Record<string,unknown>;
const HERE=dirname(fileURLToPath(import.meta.url));
const schema=JSON.parse(readFileSync(join(HERE,"assets/input.schema.json"),"utf8")) as Schema;
const snapshot=JSON.parse(readFileSync(join(HERE,"assets/reason-compatibility.v1.11.0.json"),"utf8")) as ReasonSnapshot;
const byCode=new Map(snapshot.canonical_reasons.map((item)=>[item.reason_code,item]));
const order=new Map(snapshot.canonical_reasons.map((item,index)=>[item.reason_code,index]));
const candidateMap=new Map(snapshot.candidate_reason_by_canonical.map((item)=>[item.canonical_reason_code,item.candidate_reason_code]));
const candidateStatus=new Map(snapshot.candidate_status_by_technical_status.map((item)=>[item.technical_status,item.candidate_status]));
const isObj=(value:unknown):value is Obj=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const same=(a:string[],b:string[]):boolean=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const duplicates=(values:string[]):string[]=>{const seen=new Set<string>(),out=new Set<string>();for(const value of values){if(seen.has(value))out.add(value);seen.add(value);}return [...out].sort(compareCodeUnits);};
const ordered=(values:CanonicalReasonCode[]):CanonicalReasonCode[]=>[...values].sort((a,b)=>(order.get(a)??Number.MAX_SAFE_INTEGER)-(order.get(b)??Number.MAX_SAFE_INTEGER)||compareCodeUnits(a,b));
function status(reasons:CanonicalReason[]):TechnicalStatus{if(reasons.some((item)=>item.technical_status_effect==="RED"))return "RED_DO_NOT_MERGE";if(reasons.some((item)=>item.technical_status_effect==="YELLOW"))return "YELLOW_CHANGES_OR_VERIFICATION_REQUIRED";return "GREEN_TECHNICALLY_READY";}
function statusCodes(reasons:CanonicalReason[]):CanonicalReasonCode[]{const effect=reasons.some((item)=>item.technical_status_effect==="RED")?"RED":reasons.some((item)=>item.technical_status_effect==="YELLOW")?"YELLOW":"NONE";return reasons.filter((item)=>item.technical_status_effect===effect&&effect!=="NONE").map((item)=>item.reason_code);}
function candidateCodes(codes:CanonicalReasonCode[]):string[]{const out:string[]=[];for(const code of codes){const mapped=candidateMap.get(code);if(mapped&&!out.includes(mapped))out.push(mapped);}return out;}
function normalizeDetails(details:ReasonDetail[]):ReasonDetail[]{return [...details].sort((a,b)=>(order.get(a.reason_code)??Number.MAX_SAFE_INTEGER)-(order.get(b.reason_code)??Number.MAX_SAFE_INTEGER)||compareCodeUnits(a.reason_code,b.reason_code)).map((detail)=>({...detail,subjects:sortedUnique(detail.subjects)}));}
export function validateInput(raw:unknown):RendererInput{
  if(!isObj(raw))throw invalid("input must be a JSON object");
  const rawSchemaErrors=validateSchema(schema,raw).map((error)=>`${error.path}: ${error.message}`);
  if(rawSchemaErrors.length)throw invalid("raw active-v2 input schema validation failed",rawSchemaErrors);
  const input=structuredClone(raw) as unknown as RendererInput;
  input.technical_status_reason_codes=ordered(input.technical_status_reason_codes);
  input.next_action_reason_codes=ordered(input.next_action_reason_codes);
  input.reason_details=normalizeDetails(input.reason_details);
  const errors:string[]=[];
  const completeCodes=input.reason_details.map((detail)=>detail.reason_code);
  for(const code of duplicates(completeCodes))errors.push(`$.reason_details: duplicate reason detail ${code}`);
  const completeSet=new Set(completeCodes);
  const reasons:CanonicalReason[]=[];
  for(const code of completeCodes){const reason=byCode.get(code);if(!reason)errors.push(`$.reason_details: unregistered reason ${code}`);else reasons.push(reason);}
  for(const [codes,path] of [[input.technical_status_reason_codes,"$.technical_status_reason_codes"],[input.next_action_reason_codes,"$.next_action_reason_codes"]] as const){for(const code of duplicates(codes))errors.push(`${path}: duplicate reason ${code}`);for(const code of codes)if(!completeSet.has(code))errors.push(`${path}: ${code} is absent from complete reason_details`);}
  const expectedStatusCodes=statusCodes(reasons);
  if(!same(input.technical_status_reason_codes,expectedStatusCodes))errors.push(`$.technical_status_reason_codes: must exactly equal active _technical_status reason projection ${JSON.stringify(expectedStatusCodes)}`);
  const computed=status(reasons);
  if(input.action_kind!=="blocked_internal_error"&&input.technical_status!==computed)errors.push(`$.technical_status: complete canonical reasons require ${computed}`);
  if(input.action_kind!=="blocked_internal_error"){
    const expectedCandidate=candidateCodes(completeCodes);
    if(input.technical_decision.status!==candidateStatus.get(computed))errors.push(`$.technical_decision/status: must be ${String(candidateStatus.get(computed))}`);
    if(!same(input.technical_decision.reason_codes,expectedCandidate))errors.push(`$.technical_decision/reason_codes: must exactly equal all-canonical active projection ${JSON.stringify(expectedCandidate)}`);
  }
  const route=ACTION_ROUTES[input.action_kind as ActionKind];
  for(const code of input.next_action_reason_codes){const reason=byCode.get(code);if(reason&&!route.allowed_reason_effects.includes(reason.action_effect))errors.push(`$.next_action_reason_codes: ${reason.reason_code} action effect ${reason.action_effect} is incompatible with ${input.action_kind}`);}
  if(input.review_validity!=="CURRENT"){
    if(input.may_modify_code!==false)errors.push("$.may_modify_code: historical review cannot modify code");
    if(input.repair_handoff!==null)errors.push("$.repair_handoff: historical review cannot carry repair authority");
    if(input.action_kind!=="blocked_internal_error"){
      if(input.action_kind!=="rerun_review")errors.push("$.action_kind: STALE or UNKNOWN review must route only to rerun_review");
      if(!same(input.next_action_reason_codes,["RSN-REVIEW-NOT-CURRENT"]))errors.push("$.next_action_reason_codes: historical review action must contain only RSN-REVIEW-NOT-CURRENT");
    }
  }
  if(errors.length)throw invalid("projection reason-carrier validation failed",errors);
  validateActiveInputSemantics(input);
  return input;
}
export function validateOutput(output:RendererOutput):void{validateSemanticOutput(output);}
