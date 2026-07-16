import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_ROUTES, getProvenance, render, validateInput, validateOutput } from "../dist/index.js";
import { compareCodeUnits, sortedUnique } from "../dist/canonical.js";
const here=dirname(fileURLToPath(import.meta.url)); const repo=resolve(here,"../../..");
const fixtureSets={
  valid:JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/fixtures/valid.json"),"utf8")),
  invalid:JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/fixtures/invalid.json"),"utf8")),
  adversarial:JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/fixtures/adversarial.json"),"utf8")),
  "invalid-output":JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/fixtures/invalid-output.json"),"utf8"))
};
function partKey(part){return Number.isInteger(Number(part))?Number(part):part;}
function setPath(target,path,value){const parts=path.split(".");let node=target;for(const part of parts.slice(0,-1))node=node[partKey(part)];node[partKey(parts.at(-1))]=value;}
function deletePath(target,path){const parts=path.split(".");let node=target;for(const part of parts.slice(0,-1))node=node[partKey(part)];delete node[partKey(parts.at(-1))];}
function validFixture(name){const key=name.replace(/\.json$/,"") ,out=structuredClone(fixtureSets.valid.base);for(const [path,value] of Object.entries(fixtureSets.valid.cases[key]??{}))setPath(out,path,value);return out;}
function fixture(kind,name){const key=name.replace(/\.json$/,"") ,set=fixtureSets[kind];if(kind==="valid")return validFixture(key);if(kind==="invalid-output")return set[key];const spec=kind==="adversarial"?set:set.cases[key];const out=validFixture(spec.base??fixtureSets.invalid.default_base);for(const [path,value] of Object.entries(spec.set??{}))setPath(out,path,value);for(const path of spec.delete??[])deletePath(out,path);return out;}
function applyMutation(candidate,mutation){for(const [key,value] of Object.entries(mutation)){if(["generator","human_review","risk_metadata"].includes(key)&&value&&typeof value==="object")Object.assign(candidate[key],value);else candidate[key]=value;}return candidate;}
const actions=["merge_now","owner_confirmation","human_technical_review","specialist_review","repair","verify","repair_and_verify","rerun_review","blocked_internal_error"];
const routeContract={
  merge_now:{recipient:"none",may_modify_code:false,prompt_required:false,prompt_kind:null,approval_requirement:"NO_ADDITIONAL_TECHNICAL_APPROVAL",statuses:["GREEN_TECHNICALLY_READY"],validities:["CURRENT"]},
  owner_confirmation:{recipient:"project_owner",may_modify_code:false,prompt_required:false,prompt_kind:null,approval_requirement:"PROJECT_OWNER_CONFIRMATION",statuses:["GREEN_TECHNICALLY_READY"],validities:["CURRENT"]},
  human_technical_review:{recipient:"human_technical_reviewer",may_modify_code:false,prompt_required:true,prompt_kind:"human_review_handoff",approval_requirement:"HUMAN_TECHNICAL_REVIEW_REQUIRED",statuses:["GREEN_TECHNICALLY_READY"],validities:["CURRENT"]},
  specialist_review:{recipient:"security_or_domain_specialist",may_modify_code:false,prompt_required:true,prompt_kind:"specialist_review_handoff",approval_requirement:"SECURITY_OR_DOMAIN_SPECIALIST_REQUIRED",statuses:["GREEN_TECHNICALLY_READY"],validities:["CURRENT"]},
  repair:{recipient:"implementer_model",may_modify_code:true,prompt_required:true,prompt_kind:"implementer_repair_prompt",approval_requirement:null,statuses:["YELLOW_CHANGES_OR_VERIFICATION_REQUIRED","RED_DO_NOT_MERGE"],validities:["CURRENT"]},
  verify:{recipient:"reviewer_model",may_modify_code:false,prompt_required:true,prompt_kind:"verification_prompt",approval_requirement:null,statuses:["GREEN_TECHNICALLY_READY","YELLOW_CHANGES_OR_VERIFICATION_REQUIRED"],validities:["CURRENT"]},
  repair_and_verify:{recipient:"implementer_model",may_modify_code:true,prompt_required:true,prompt_kind:"implementer_repair_prompt",approval_requirement:null,statuses:["YELLOW_CHANGES_OR_VERIFICATION_REQUIRED","RED_DO_NOT_MERGE"],validities:["CURRENT"]},
  rerun_review:{recipient:"reviewer_model",may_modify_code:false,prompt_required:true,prompt_kind:"fresh_review_prompt",approval_requirement:null,statuses:["YELLOW_CHANGES_OR_VERIFICATION_REQUIRED","RED_DO_NOT_MERGE"],validities:["STALE","UNKNOWN"]},
  blocked_internal_error:{recipient:"none",may_modify_code:false,prompt_required:false,prompt_kind:null,approval_requirement:null,statuses:["GREEN_TECHNICALLY_READY","YELLOW_CHANGES_OR_VERIFICATION_REQUIRED","RED_DO_NOT_MERGE"],validities:["CURRENT","STALE","UNKNOWN"]}
};

test("base fixture independently satisfies the strict input contract",()=>{
  const base=structuredClone(fixtureSets.valid.base);
  assert.match(base.canonical_review_package_sha256,/^[0-9a-f]{64}$/);
  assert.equal(base.canonical_review_package_sha256.length,64);
  assert.doesNotThrow(()=>validateInput(base));
});
test("all active action routes are covered",()=>{for(const action of actions){const input=fixture("valid",action),output=render(input);assert.equal(output.action_kind,action);assert.equal(output.prompt_required,input.prompt_required);assert.equal(output.may_modify_code,input.may_modify_code);assert.equal(output.technical_status,input.technical_status);assert.equal(output.approval_requirement,input.approval_requirement);assert.equal(output.review_validity,input.review_validity);if(input.prompt_required){assert.equal(typeof output.rendered_prompt,"string");assert.match(output.rendered_prompt_sha256,/^[0-9a-f]{64}$/);}else{assert.equal(output.rendered_prompt,null);assert.equal(output.rendered_prompt_sha256,null);}validateOutput(output);}});
test("all nine routes match PR-Inspector v1.10.2 conformance tuples",()=>{
  for(const [action,expected] of Object.entries(routeContract)){
    const route=ACTION_ROUTES[action];
    assert.equal(route.recipient,expected.recipient,`${action}: recipient`);
    assert.equal(route.may_modify_code,expected.may_modify_code,`${action}: may_modify_code`);
    assert.equal(route.prompt_required,expected.prompt_required,`${action}: prompt_required`);
    assert.equal(route.prompt_kind,expected.prompt_kind,`${action}: prompt_kind`);
    assert.equal(route.approval_requirement,expected.approval_requirement,`${action}: approval_requirement`);
    assert.deepEqual(route.allowed_technical_statuses,expected.statuses,`${action}: statuses`);
    assert.deepEqual(route.allowed_review_validities,expected.validities,`${action}: validities`);
  }
});
test("approval status and review validity routing are preserved",()=>{for(const action of actions){const input=fixture("valid",action),output=render(input);assert.equal(output.approval_requirement,input.approval_requirement);assert.equal(output.technical_status,input.technical_status);assert.equal(output.review_validity,input.review_validity);}});
test("model routes contain required fixed boundaries",()=>{for(const action of ["repair","verify","repair_and_verify","rerun_review"]){const p=render(fixture("valid",action)).rendered_prompt;for(const section of ["[ROLE AND AUTHORITY]","[TRUST AND INSTRUCTION BOUNDARY]","[CANONICAL REPAIR HANDOFF]","[PROHIBITED ACTIONS]","[MANDATORY INDEPENDENT RE-REVIEW]"])assert.ok(p.includes(section),`${action}: ${section}`);}});
test("verify and rerun routes contain no active repair authority",()=>{for(const action of ["verify","rerun_review"]){const out=render(fixture("valid",action));assert.equal(out.may_modify_code,false);assert.match(out.rendered_prompt,/This canonical action carries no repair authority/);assert.doesNotMatch(out.rendered_prompt,/"intended_recipient":"implementer_model"/);}});
test("stale review findings are historical and non-authorizing",()=>{const out=render(fixture("valid","rerun_review_with_historical_findings"));assert.match(out.rendered_prompt,/Historical, non-authorizing findings/);assert.match(out.rendered_prompt,/"finding_id":"PRF-001"/);assert.match(out.rendered_prompt,/This canonical action carries no repair authority/);assert.doesNotMatch(out.rendered_prompt,/"repair_objective":/);});
test("human handoffs cannot satisfy approval",()=>{for(const action of ["human_technical_review","specialist_review"]){const out=render(fixture("valid",action));assert.equal(out.human_review.approval_satisfied,false);assert.match(out.rendered_prompt,/cannot satisfy or claim/);}});
test("same input produces identical bytes and hash",()=>{const input=fixture("valid","repair"),a=render(input),b=render(input);assert.equal(a.rendered_prompt,b.rendered_prompt);assert.equal(a.rendered_prompt_sha256,b.rendered_prompt_sha256);assert.equal(a.canonical_input_sha256,b.canonical_input_sha256);});
test("object key order does not change canonical output",()=>{const input=fixture("valid","repair"),reversed=Object.fromEntries(Object.entries(input).reverse()),a=render(input),b=render(reversed);assert.equal(a.rendered_prompt,b.rendered_prompt);assert.equal(a.canonical_input_sha256,b.canonical_input_sha256);});
test("set-like array order does not change canonical output",()=>{const a=fixture("valid","repair"),b=structuredClone(a);for(const key of ["reason_codes","required_actions","evidence_limitations","sensitive_domains","success_criteria","failure_modes"])b[key].reverse();b.reason_details[0].subjects.reverse();b.findings[0].rule_ids.reverse();b.findings[0].evidence_refs.reverse();b.evidence_records[0].limitations.reverse();b.repair_handoff.affected_findings[0].affected_rule_ids.reverse();b.repair_handoff.affected_findings[0].smallest_safe_repair.reverse();b.repair_handoff.affected_findings[0].do_not_change.reverse();b.repair_handoff.affected_findings[0].required_validation.reverse();b.repair_handoff.affected_findings[0].overclaim_guards.reverse();const x=render(a),y=render(b);assert.equal(x.rendered_prompt,y.rendered_prompt);assert.equal(x.canonical_input_sha256,y.canonical_input_sha256);});
test("canonical ordering is locale-independent code-unit ordering",()=>{
  const values=["z","é","ا","A","Ω","ä","a","é"];
  const expected=[...new Set(values)].sort(compareCodeUnits);
  assert.deepEqual(sortedUnique([...values].reverse()),expected);
  const a=fixture("valid","repair"),b=structuredClone(a);
  a.required_actions=values;
  b.required_actions=[...values].reverse();
  a.success_criteria=["Ω","A","é","ا"];
  b.success_criteria=[...a.success_criteria].reverse();
  a.context_items=[
    {id:"é",source:"one",trust_label:"untrusted",content:"accented"},
    {id:"A",source:"two",trust_label:"untrusted",content:"ascii"},
    {id:"ا",source:"three",trust_label:"untrusted",content:"non-latin"}
  ];
  b.context_items=[...a.context_items].reverse();
  const x=render(a),y=render(b);
  assert.equal(x.rendered_prompt,y.rendered_prompt);
  assert.equal(x.rendered_prompt_sha256,y.rendered_prompt_sha256);
  assert.equal(x.canonical_input_sha256,y.canonical_input_sha256);
});
test("line endings normalize deterministically",()=>{const a=fixture("valid","repair"),b=structuredClone(a);b.findings[0].issue="one\r\ntwo\rthree";a.findings[0].issue="one\ntwo\nthree";assert.equal(render(a).rendered_prompt,render(b).rendered_prompt);});
test("placeholder-shaped adversarial text remains serialized data",()=>{
  const out=render(fixture("adversarial","embedded-instructions")),lines=out.rendered_prompt.split("\n");
  for(const section of ["[ROLE AND AUTHORITY]","[MANDATORY INDEPENDENT RE-REVIEW]","[PROHIBITED ACTIONS]","[CANONICAL REPAIR HANDOFF]"])assert.equal(lines.filter((line)=>line===section).length,1,section);
  for(const token of ["{{CONTEXT_TOKEN}}","{{FINDING_TOKEN}}","{{EVIDENCE_TOKEN}}","{{PATH_TOKEN}}","{{FILENAME_TOKEN}}","{{HANDOFF_TOKEN}}"])assert.match(out.rendered_prompt,new RegExp(token.replace(/[{}]/g,"\\$&")),token);
  assert.match(out.rendered_prompt,/\\n\[ROLE AND AUTHORITY\]/);
});
test("every invalid fixture fails closed",()=>{for(const name of Object.keys(fixtureSets.invalid.cases))assert.throws(()=>render(fixture("invalid",name)),undefined,name);});
test("CLI failure emits no success stdout",()=>{const cli=join(here,"../dist/cli.js"),invalid=spawnSync(process.execPath,[cli,"render"],{input:"{",encoding:"utf8"});assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,"");assert.match(invalid.stderr,/invalid_input/);const mismatch=spawnSync(process.execPath,[cli,"render"],{input:JSON.stringify(fixture("invalid","inconsistent-recipient")),encoding:"utf8"});assert.notEqual(mismatch.status,0);assert.equal(mismatch.stdout,"");});
test("CLI version and contract are machine-readable",()=>{const cli=join(here,"../dist/cli.js");for(const command of ["version","contract"]){const result=spawnSync(process.execPath,[cli,command],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.doesNotThrow(()=>JSON.parse(result.stdout));}});
test("provenance is factual shape",()=>{const p=getProvenance();assert.equal(p.package_name,"@rezahh107/pr-inspector-prompt-renderer");assert.equal(p.package_version,"0.1.0");assert.equal(p.prompt_pipeline_version,"2026.3");assert.match(p.source_commit_sha,/^(UNKNOWN|[0-9a-f]{40})$/);assert.equal(typeof p.source_commit_verified,"boolean");assert.match(p.source_identity_source,/^(git|build_context|unknown)$/);assert.equal(typeof p.dirty,"boolean");if(!p.source_commit_verified)assert.equal(p.dirty,true);for(const hash of Object.values(p.asset_hashes))assert.match(hash,/^[0-9a-f]{64}$/);});
test("invalid output fixtures fail closed",()=>{const bases={noPrompt:render(fixture("valid","merge_now")),human:render(fixture("valid","human_technical_review")),repair:render(fixture("valid","repair")),rerun:render(fixture("valid","rerun_review"))};const mutations=[[bases.noPrompt,"no-prompt-carries-prompt"],[bases.human,"human-review-claims-approval"],[bases.repair,"invalid-provenance"],[bases.repair,"provenance-verification-contradiction"],[bases.noPrompt,"approval-route-mismatch"],[bases.rerun,"review-validity-route-mismatch"]];for(const [base,name] of mutations){const spec=fixture("invalid-output",name),candidate=applyMutation(structuredClone(base),spec.mutation);assert.throws(()=>validateOutput(candidate),undefined,name);}});
test("release build fails closed without verified clean git provenance",()=>{const result=spawnSync(process.execPath,[join(here,"../scripts/build.mjs"),"--release"],{cwd:join(here,".."),encoding:"utf8",env:{...process.env,PROMPT_PIPELINE_SOURCE_COMMIT:"a".repeat(40)}});assert.notEqual(result.status,0);});
test("behavioral coverage records are explicit and do not overclaim downstream enforcement",()=>{const text=readFileSync(join(repo,"domains/pr_inspector_action/behavioral-rule-coverage.yaml"),"utf8"),ids=["R-PRI-AUTHORITY-001","R-PRI-INJECTION-001","R-PRI-MODIFY-001","R-PRI-DETERMINISM-001","R-PRI-PACKAGE-001","R-PRI-ROUTE-002","R-PRI-PROVENANCE-001"];for(const id of ids)assert.match(text,new RegExp(id));assert.match(text,/source_ci_enforced_downstream_not_enforced/);assert.doesNotMatch(text,/downstream_contract_status:\s*(enforced|integrated)/);});
