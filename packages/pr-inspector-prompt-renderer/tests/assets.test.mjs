import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,"../../..");
const hash=(value)=>createHash("sha256").update(value).digest("hex");

for(const name of ["input.schema.json","output.schema.json","route.json","reason-compatibility.v1.11.0.json","consumer-compatibility.v1.11.0.json"]){
  test(`packaged ${name} is byte-identical to authoritative domain asset`,()=>{
    const authoritative=readFileSync(join(repo,"domains/pr_inspector_action",name));
    const packaged=readFileSync(join(here,"../dist/assets",name));
    assert.equal(hash(packaged),hash(authoritative));
  });
}

test("active schema separates complete, status, and action reason carriers",()=>{
  const schema=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/input.schema.json"),"utf8"));
  assert.equal(schema.properties.schema_version.const,"pr_inspector_action.v2");
  assert.equal(schema.properties.pr_inspector_protocol_version.const,"v1.11.0");
  assert.equal(schema.properties.evaluation_suite_id.const,"pr_inspector_action.v2");
  for(const field of ["technical_status_reason_codes","next_action_reason_codes","reason_details"])assert.ok(schema.required.includes(field),field);
  assert.ok(!("reason_codes" in schema.properties));
});

test("reason snapshot is source-derived and pinned for carrier-separation verification",()=>{
  const snapshot=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/reason-compatibility.v1.11.0.json"),"utf8"));
  assert.equal(snapshot.snapshot_schema,"pr_inspector_reason_compatibility.v2");
  assert.equal(snapshot.source_inspector_commit,"f0f74bba89e4c85f4a4b10c706a2be2980d71c25");
  assert.match(snapshot.selected_fields_sha256,/^[0-9a-f]{64}$/);
  for(const source of Object.values(snapshot.sources)){
    assert.match(source.git_blob_sha,/^[0-9a-f]{40}$/);
    assert.match(source.content_sha256,/^[0-9a-f]{64}$/);
  }
  assert.equal(snapshot.canonical_reasons.length,29);
  assert.equal(snapshot.candidate_reason_domains.length,17);
  assert.equal(snapshot.candidate_reason_by_canonical.length,8);
  assert.ok(snapshot.canonical_reasons.every((item)=>!("decision_domain" in item)));
  assert.deepEqual(snapshot.candidate_reason_by_canonical.find((item)=>item.canonical_reason_code==="RSN-COVERAGE-INCOMPLETE"),{canonical_reason_code:"RSN-COVERAGE-INCOMPLETE",candidate_reason_code:"incomplete_technical_scope"});
  for(const key of ["candidate_reason_mapping_block_sha256","governance_decision_block_sha256","governance_follow_up_block_sha256"])assert.match(snapshot.sources.projection[key],/^[0-9a-f]{64}$/);
  assert.match(snapshot.sources.projection_core.technical_status_block_sha256,/^[0-9a-f]{64}$/);
});
