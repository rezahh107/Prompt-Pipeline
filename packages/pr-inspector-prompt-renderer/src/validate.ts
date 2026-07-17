import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCodeUnits } from "./canonical.js";
import { ACTION_ROUTES } from "./routes.js";
import { invalid } from "./errors.js";
import { validateSchema } from "./schema.js";
import { validateInput as validateLegacyInput, validateOutput as validateLegacyOutput } from "./validate-legacy.js";
import type { ActionKind, CanonicalReason, ReasonSnapshot, RendererInput, RendererOutput, TechnicalStatus } from "./types.js";

type Obj=Record<string,unknown>;
const HERE=dirname(fileURLToPath(import.meta.url));
const schema=JSON.parse(readFileSync(join(HERE,"assets/input.schema.json"),"utf8")) as Obj;
const snapshot=JSON.parse(readFileSync(join(HERE,"assets/reason-compatibility.v1.11.0.json"),"utf8")) as ReasonSnapshot;
const byCode=new Map(snapshot.canonical_reasons.map((x)=>[x.reason_code,x]));
const order=new Map(snapshot.canonical_reasons.map((x,i)=>[x.reason_code,i]));
const candidateMap=new Map(snapshot.candidate_reason_by_canonical.map((x)=>[x.canonical_reason_code,x.candidate_reason_code]));
const candidateStatus=new Map(snapshot.candidate_status_by_technical_status.map((x)=>[x.technical_status,x.candidate_status]));
const isObj=(x:unknown):x is Obj=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const strings=(x:unknown):string[]=>Array.isArray(x)?x.filter((v):v is string=>typeof v==="string"):[];
const same=(a:string[],b:string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const duplicates=(xs:string[])=>{const seen=new Set<string>(),out=new Set<string>();for(const x of xs){if(seen.has(x))out.add(x);seen.add(x);}return [...out].sort(compareCodeUnits);};
const ordered=(xs:string[])=>[...xs].sort((a,b)=>(order.get(a)??Number.MAX_SAFE_INTEGER)-(order.get(b)??Number.MAX_SAFE_INTEGER));
function status(reasons:CanonicalReason[]):TechnicalStatus{if(reasons.some((x)=>x.technical_status_effect==="RED"))return "RED_DO_NOT_MERGE";if(reasons.some((x)=>x.technical_status_effect==="YELLOW"))return "YELLOW_CHANGES_OR_VERIFICATION_REQUIRED";return "GREEN_TECHNICALLY_READY";}
function statusCodes(reasons:CanonicalReason[]):string[]{const effect=reasons.some((x)=>x.technical_status_effect==="RED")?"RED":reasons.some((x)=>x.technical_status_effect==="YELLOW")?"YELLOW":"NONE";return reasons.filter((x)=>x.technical_status_effect===effect&&effect!=="NONE").map((x)=>x.reason_code);}
function candidateCodes(codes:string[]):string[]{const out:string[]=[];for(const code of coder){const mapped=candidateMap.get(code);if(mapped&&!out.includes(mapped))out.push(mapped);}return out;}
function schemaView(raw:Obj,statusCarrier:string[],actionCarrier:string[]):Obj{const view=structuredClone(raw);delete view.reason_codes;view.technical_status_reason_codes=statusCarrier;view.next_action_reason_codes=actionCarrier;return view;}
function legacyView(raw:Obj,actionCarrier:string[]):Obj{const out=structuredClone(raw);delete out.technical_status_reason_codes;delete out.next_action_reason_codes;out.reason_codes=actionCarrier;const details=Array.isArray(raw.reason_details)?raw.reason_details:[];const detailMap=new Map(details.filter(isObj).map((x)=>[x.reason_code,x]));out.reason_details=actionCarrier.map((x)=>detailMap.get(x)).filter(Boolean);const reasons=actionCarrier.map((x)=>byCode.get(x)).filter((x):x is CanonicalReason=>Boolean(x));const computed=status(reasons);out.technical_status=computed;if(isObj(out.technical_decision)){out.technical_decision.status=candidateStatus.get(computed);out.technical_decision.reason_codes=candidateCodes(ordered(actionCarrier));}if(isObj(out.overall_recommendation))out.overall_recommendation.technical_ready=computed==="GREEN_TECHNICALLY_READY";return out;}
export function validateInput(raw:unknown):RendererInput{
 if(!isObj(raw))return validateLegacyInput(raw);
 const errors:string[]=[];
 const details=Array.isArray(raw.reason_details)?raw.reason_details:[];
 const complete=details.map((x)=>isObj(x)&&typeof x.reason_code==="string"?x.reason_code:"").filter(Boolean);
 for(const code of duplicates(complete))errors.push(`$.reason_details: duplicate reason detail ${code}`);
 const completeOrdered=ordered(complete);if(!same(complete,completeOrdered))errors.push(`$.reason_details: must preserve active registry order ${JSON.stringify(completeOrdered)}`);
 const completeSet=new Set(complete);
 const legacy=Array.isArray(raw.reason_codes)?strings(raw.reason_codes):null;
 const explicitStatus=Array.isArray(raw.technical_status_reason_codes)?strings(raw.technical_status_reason_codes):null;
 const explicitAction=Array.isArray(raw.next_action_reason_codes)?strings(raw.next_action_reason_codes):null;
 if((explicitStatus===null)!==(explicitAction===null))errors.push("$.technical_status_reason_codes: explicit status and action carriers must be supplied together");
 const reasons:CanonicalReason[]=[];for(const code of complete){const reason=byCode.get(code);if(!reason)errors.push(`$.reason_details: unregistered reason ${code}`);else reasons.push(reason);}
 const expectedStatusCodes=statusCodes(reasons),statusCarrier=explicitStatus??expectedStatusCodes,actionCarrier=explicitAction??legacy??[];
 for(const [codes,path] of [[statusCarrier,"$.technical_status_reason_codes"],[actionCarrier,"$.next_action_reason_codes"]] as const){for(const code of duplicates(codes))errors.push(`${path}: duplicate reason ${code}`);for(const code of codes)if(!completeSet.has(code))errors.push(`${path}: ${code} is absent from complete reason_details`);const canonical=ordered(codes);if(!same(codes,canonical))errors.push(`${path}: must preserve active registry order ${JSON.stringify(canonical)}`);}
 if(!same(statusCarrier,expectedStatusCodes))errors.push(`$.technical_status_reason_codes: must exactly equal active _technical_status reason projection ${JSON.stringify(expectedStatusCodes)}`);
 if(legacy&&explicitAction&&!same(legacy,explicitAction))errors.push("$.reason_codes: legacy action alias must equal next_action_reason_codes");
 const computed=status(reasons);if(raw.action_kind!=="blocked_internal_error"&&raw.technical_status!==computed)errors.push(`$.technical_status: complete canonical reasons require ${computed}`);
 const technical=isObj(raw.technical_decision)?raw.technical_decision:null;if(technical&&raw.action_kind!=="blocked_internal_error"){const expectedCandidate=candidateCodes(complete);if(technical.status!==candidateStatus.get(computed))errors.push(`$.technical_decision/status: must be ${String(candidateStatus.get(computed))}`);if(!same(strings(technical.reason_codes),expectedCandidate))errors.push(`$.technical_decision/reason_codes: must exactly equal all-canonical active projection ${JSON.stringify(expectedCandidate)}`);}
 const route=ACTION_ROUTES[raw.action_kind as ActionKind];if(route){const actionReasons=actionCarrier.map((x)=>byCode.get(x)).filter((x):x is CanonicalReason=>Boolean(x));for(const reason of actionReasons)if(!route.allowed_reason_effects.includes(reason.action_effect))errors.push(`$.next_action_reason_codes: ${reason.reason_code} action effect ${reason.action_effect} is incompatible with ${String(raw.action_kind)}`);}
 if(raw.review_validity!=="CURRENT"){if(raw.action_kind!=="rerun_review")errors.push("$.action_kind: STALE or UNKNOWN review must route only to rerun_review");if(raw.may_modify_code!==false)errors.push("$.may_modify_code: historical review cannot modify code");if(raw.repair_handoff!==null)errors.push("$.repair_handoff: historical review cannot carry repair authority");if(!same(actionCarrier,["RSN-REVIEW-NOT-CURRENT"]))errors.push("$.next_action_reason_codes: historical review action must contain only RSN-REVIEW-NOT-CURRENT");}
 for(const e of validateSchema(schema,schemaView(raw,statusCarrier,actionCarrier)))errors.push(`${e.path}: ${e.message}`);
 if(errors.length)throw invalid("projection reason-carrier validation failed",errors);
 validateLegacyInput(legacyView(raw,actionCarrier));
 return {...raw,reason_codes:actionCarrier,technical_status_reason_codes:statusCarrier,next_action_reason_codes:actionCarrier} as unknown as RendererInput;
}
export function validateOutput(output:RendererOutput):void{validateLegacyOutput(output);}
