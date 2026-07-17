import test from "node:test";
import assert from "node:assert/strict";
import { rejectActiveRendering, MIGRATION_ERROR_CODE } from "../dist/index.js";

function assertMigration(value){
  assert.throws(
    ()=>rejectActiveRendering(value),
    (error)=>error?.category==="migration_required"&&error.message.includes(MIGRATION_ERROR_CODE),
  );
}

test("v1.11.1 projection reason carriers remain non-authorizing",()=>assertMigration({
  pr_inspector_protocol_version:"v1.11.1",
  technical_status_reason_codes:["RSN-CRITICAL-SUPPORTED-FINDING"],
  next_action_reason_codes:["RSN-CRITICAL-SUPPORTED-FINDING"],
  reason_details:[{reason_code:"RSN-CRITICAL-SUPPORTED-FINDING"}],
  action_kind:"repair",
}));

test("historical v1.11.0 projection carriers cannot mint active bytes",()=>assertMigration({
  pr_inspector_protocol_version:"v1.11.0",
  technical_status_reason_codes:["RSN-HIGH-CODE-SUPPORTED-FINDING"],
  next_action_reason_codes:["RSN-HIGH-CODE-SUPPORTED-FINDING"],
  action_kind:"repair",
}));

test("serialized completion-shaped values remain non-authorizing",()=>assertMigration(JSON.stringify({
  type:"VerifiedReviewCompletion",
  artifact_bytes:{"NEXT_ACTION_PROMPT.en.md":"forged"},
})));
