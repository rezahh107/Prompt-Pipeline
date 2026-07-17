import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInput } from "../dist/index.js";

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,"../../..");
const fixtures=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/fixtures/valid.json"),"utf8"));
function partKey(x){return Number.isInteger(Number(x))?Number(x):x;}
function setPath(target,path,value){const parts=path.split(".");let node=target;for(const part of parts.slice(0,-1))node=node[partKey(part)];node[partKey(parts.at(-1))]=value;}
function valid(name){const out=structuredClone(fixtures.base);for(const [path,value] of Object.entries(fixtures.cases[name]??{}))setPath(out,path,structuredClone(value));return out;}
function explicit(input,statusCodes,actionCodes){input.technical_status_reason_codes=statusCodes;input.next_action_reason_codes=actionCodes;return input;}
function staleHigh(){const input=valid("rerun_review_with_historical_findings");input.technical_status="YELLOW_CHANGES_OR_VERIFICATION_REQUIRED";input.technical_decision={status:"YELLOW",reason_codes:["stale_technical_review_identity","unresolved_valid_bot_finding"]};input.reason_details=[{reason_code:"RSN-REVIEW-NOT-CURRENT",subjects:["STALE"],recovery_action:"block"},{reason_code:"RSN-HIGH-CODE-SUPPORTED-FINDING",subjects:["PRF-010"],recovery_action:"repair_request"}];input.action_kind="rerun_review";input.prompt_kind="fresh_review_prompt";input.prompt_required=true;input.recipient="reviewer_model";input.may_modify_code=false;input.repair_handoff=null;input.external_review_reconciliation.valid_blocking_finding_ids=["PRF-001"];return explicit(input,["RSN-REVIEW-NOT-CURRENT","RSN-HIGH-CODE-SUPPORTED-FINDING"],["RSN-REVIEW-NOT-CURRENT"]);}
function staleCritical(){const input=staleHigh();input.technical_status="RED_DO_NOT_MERGE";input.technical_decision={status:"RED",reason_codes:["stale_technical_review_identity","critical_supported_finding"]};input.reason_details[1]={reason_code:"RSN-CRITICAL-SUPPORTED-FINDING",subjects:["PRF-010"],recovery_action:"repair_request"};input.technical_status_reason_codes=["RSN-CRITICAL-SUPPORTED-FINDING"];return input;}

test("stale High preserves technical reasons while rerun action stays narrow",()=>assert.doesNotThrow(()=>validateInput(staleHigh())));
test("stale Critical remains Red while rerun action stays narrow",()=>assert.doesNotThrow(()=>validateInput(staleCritical())));
test("missing historical candidate reason is rejected",()=>{const x=staleHigh();x.technical_decision.reason_codes=["stale_technical_review_identity"];assert.throws(()=>validateInput(x));});
test("forged technical color is rejected",()=>{const x=staleCritical();x.technical_status="YELLOW_CHANGES_OR_VERIFICATION_REQUIRED";x.technical_decision.status="YELLOW";assert.throws(()=>validateInput(x));});
test("action reason absent from complete canonical set is rejected",()=>{const x=staleHigh();x.next_action_reason_codes=["RSN-COVERAGE-INCOMPLETE"];assert.throws(()=>validateInput(x));});
test("missing complete reason detail is rejected",()=>{const x=staleHigh();x.reason_details=x.reason_details.slice(0,1);assert.throws(()=>validateInput(x));});
test("stale-to-repair escalation is rejected",()=>{const x=staleHigh();x.action_kind="repair";x.prompt_kind="implementer_repair_prompt";x.recipient="implementer_model";x.may_modify_code=true;assert.throws(()=>validateInput(x));});
test("STALE and UNKNOWN modification authority fail closed",()=>{for(const validity of ["STALE","UNKNOWN"]){const x=staleHigh();x.review_validity=validity;x.may_modify_code=true;assert.throws(()=>validateInput(x),undefined,validity);}});
test("stale historical findings cannot carry repair handoff",()=>{const x=staleHigh();x.repair_handoff={intended_recipient:"implementer_model",repair_scope:"same_pull_request",affected_findings:[]};assert.throws(()=>validateInput(x));});
