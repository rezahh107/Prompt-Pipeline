import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,"../../..");
const [registryPath,projectionPath,corePath,constantsPath]=process.argv.slice(2);
if(!registryPath||!projectionPath||!corePath||!constantsPath)throw new Error("usage: verify-consumer-source.mjs REGISTRY_YAML DECISION_PROJECTION_PY DECISION_PROJECTION_CORE_PY CONSTANTS_PY");
const snapshot=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/reason-compatibility.v1.11.0.json"),"utf8"));
const sha=(value)=>createHash("sha256").update(value).digest("hex");
const normalize=(value)=>value.replace(/\r\n?/g,"\n");
const canonicalize=(value)=>Array.isArray(value)?value.map(canonicalize):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map((key)=>[key,canonicalize(value[key])])):typeof value==="string"?normalize(value):value;
const stable=(value)=>JSON.stringify(canonicalize(value));
const sourceBytes={registry:readFileSync(registryPath),projection:readFileSync(projectionPath),projection_core:readFileSync(corePath),constants:readFileSync(constantsPath)};
const sourceText=Object.fromEntries(Object.entries(sourceBytes).map(([key,value])=>[key,normalize(value.toString("utf8"))]));
for(const key of Object.keys(sourceBytes)){
  const actual=sha(sourceBytes[key]);
  if(actual!==snapshot.sources[key].content_sha256)throw new Error(`${key} source SHA-256 mismatch: ${actual}`);
}
function scalar(value){if(value==="null")return null;if(value==="true")return true;if(value==="false")return false;return value;}
function parseRegistry(text){
  const canonical=[],candidate=[];let section="",current=null;
  for(const line of text.split("\n")){
    if(line==="reasons:"){section="canonical";continue;}
    if(line==="candidate_reason_domains:"){if(current)(section==="canonical"?canonical:candidate).push(current);current=null;section="candidate";continue;}
    const start=/^- reason_code: (.+)$/.exec(line);
    if(start){if(current)(section==="canonical"?canonical:candidate).push(current);current={reason_code:start[1]};continue;}
    const field=/^  ([a-z_]+): (.+)$/.exec(line);
    if(field&&current){
      const wanted=section==="canonical"?["technical_status_effect","action_effect","recipient","may_modify_code","prompt_kind","recovery_action"]:["decision_domain","status_effect","recipient","authority","recovery_action"];
      if(wanted.includes(field[1]))current[field[1]]=scalar(field[2]);
    }
  }
  if(current)(section==="canonical"?canonical:candidate).push(current);
  return {canonical,candidate};
}
function assignmentBlock(text,name){
  const marker=`${name} = {`;const start=text.indexOf(marker);if(start<0)throw new Error(`missing source assignment ${name}`);
  const bodyStart=start+marker.length;let depth=1,inString=false,quote="",escaped=false;
  for(let index=bodyStart;index<text.length;index++){
    const ch=text[index];
    if(inString){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch===quote)inString=false;continue;}
    if(ch==='"'||ch==="'"){inString=true;quote=ch;continue;}
    if(ch==="{")depth++;else if(ch==="}"&&--depth===0)return text.slice(bodyStart,index);
  }
  throw new Error(`unterminated source assignment ${name}`);
}
function stringPairs(text,name,{symbolKeys=false}={}){
  const block=assignmentBlock(text,name),out=[];
  for(const raw of block.split("\n")){
    const line=raw.trim();if(!line)continue;
    const match=(symbolKeys?/^(?:_core\.)?([A-Z_]+):\s*["']([^"']+)["'],?$/:/^["']([^"']+)["']:\s*["']([^"']+)["'],?$/).exec(line);
    if(!match)throw new Error(`unsupported ${name} source line: ${line}`);
    out.push([match[1],match[2]]);
  }
  return out;
}
function constantValues(text){
  const out={};
  for(const name of ["STATUS_GREEN","STATUS_YELLOW","STATUS_RED"]){const match=new RegExp(`^${name}\\s*=\\s*["']([^"']+)["']$`,`m`).exec(text);if(!match)throw new Error(`missing ${name}`);out[name]=match[1];}
  return out;
}
function functionBlock(text,name){
  const lines=normalize(text).split(/(?<=\n)/);const start=lines.findIndex((line)=>line.startsWith(`def ${name}(`));if(start<0)throw new Error(`missing function ${name}`);let end=lines.length;for(let i=start+1;i<lines.length;i++)if(lines[i].startsWith("def ")){end=i;break;}return lines.slice(start,end).join("").trimEnd()+"\n";
}
const parsed=parseRegistry(sourceText.registry);
const constants=constantValues(sourceText.constants);
const candidatePairs=stringPairs(sourceText.projection,"_CANDIDATE_REASON_BY_CANONICAL");
const statusSymbolPairs=stringPairs(sourceText.projection,"_CANDIDATE_STATUS_BY_TECHNICAL_STATUS",{symbolKeys:true});
const candidateStatus=statusSymbolPairs.map(([symbol,candidate])=>{if(!(symbol in constants))throw new Error(`unknown status symbol ${symbol}`);return {technical_status:constants[symbol],candidate_status:candidate};});
const canonicalStatus=[
  {technical_status_effect:"RED",technical_status:constants.STATUS_RED},
  {technical_status_effect:"YELLOW",technical_status:constants.STATUS_YELLOW},
  {technical_status_effect:"NONE",technical_status:constants.STATUS_GREEN},
];
const mapping=candidatePairs.map(([canonical_reason_code,candidate_reason_code])=>({canonical_reason_code,candidate_reason_code}));
const selected={canonical_status_by_effect:canonicalStatus,candidate_status_by_technical_status:candidateStatus,candidate_reason_by_canonical:mapping,canonical_reasons:parsed.canonical,candidate_reason_domains:parsed.candidate};
const expectedSelectedHash=sha(stable(selected));
if(expectedSelectedHash!==snapshot.selected_fields_sha256)throw new Error(`selected source transformation mismatch: ${expectedSelectedHash}`);
for(const [name,actual,expected] of [
  ["canonical registry",parsed.canonical,snapshot.canonical_reasons],
  ["candidate domains",parsed.candidate,snapshot.candidate_reason_domains],
  ["candidate mapping",mapping,snapshot.candidate_reason_by_canonical],
  ["candidate status",candidateStatus,snapshot.candidate_status_by_technical_status],
  ["canonical status",canonicalStatus,snapshot.canonical_status_by_effect],
])if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${name} transformation mismatch`);
const blockChecks=[
  ["projection","_candidate_technical_reasons","candidate_reason_mapping_block_sha256"],
  ["projection","_governance_decision","governance_decision_block_sha256"],
  ["projection","_governance_follow_up","governance_follow_up_block_sha256"],
  ["projection_core","_technical_status","technical_status_block_sha256"],
];
for(const [sourceKey,functionName,hashKey] of blockChecks){const actual=sha(functionBlock(sourceText[sourceKey],functionName));if(actual!==snapshot.sources[sourceKey][hashKey])throw new Error(`${functionName} source block mismatch: ${actual}`);}
const constantsHash=sha(stable(constants));if(constantsHash!==snapshot.sources.constants.selected_constants_sha256)throw new Error(`status constants mismatch: ${constantsHash}`);
if(snapshot.canonical_reasons.some((item)=>Object.hasOwn(item,"decision_domain")))throw new Error("canonical snapshot contains non-source decision_domain authority");
if(sourceText.projection.includes("governanceCanonical"))throw new Error("manual canonical governance classification is forbidden");
const projectBlock=functionBlock(sourceText.projection,"project_decision");
const chooseActionBlock=functionBlock(sourceText.projection_core,"_choose_action");
for(const required of [
  'reason_instances = _canonical_reason_instances(pkg, assessment)',
  'all_codes = [item["reason_code"] for item in reason_instances]',
  '_core._technical_status(all_codes)',
  '_core._choose_action(pkg, technical_status, all_codes)',
  '_candidate_technical_reasons(all_codes)',
  '"technical_status_reason_codes": technical_codes',
  '"reason_codes": action_codes',
  '"reason_details": reason_instances',
])if(!projectBlock.includes(required))throw new Error(`project_decision carrier separation drift: ${required}`);
if(!chooseActionBlock.includes('return "rerun_review", ["RSN-REVIEW-NOT-CURRENT"]'))throw new Error("stale action reason separation drift");
console.log(JSON.stringify({ok:true,separation_verified:true,source_content_sha256:Object.fromEntries(Object.entries(sourceBytes).map(([key,value])=>[key,sha(value)])),canonical_reason_count:parsed.canonical.length,candidate_reason_count:parsed.candidate.length,candidate_mapping_count:mapping.length,selected_fields_sha256:expectedSelectedHash}));
