import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,"../../..");
const hash=(value)=>createHash("sha256").update(value).digest("hex");
const assets=["input.schema.json","output.schema.json","route.json","reason-compatibility.v1.11.0.json","consumer-compatibility.v1.11.0.json"];

for(const name of assets){
  test(`packaged historical ${name} is byte-identical to the domain snapshot`,()=>{
    const authoritative=readFileSync(join(repo,"domains/pr_inspector_action",name));
    const packaged=readFileSync(join(here,"../dist/assets",name));
    assert.equal(hash(packaged),hash(authoritative));
  });
}

test("route identity is historical and active rendering is disabled",()=>{
  const route=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/route.json"),"utf8"));
  assert.equal(route.lifecycle_status,"historical_fail_closed_compatibility");
  assert.equal(route.active_rendering_supported,false);
  assert.equal(route.authoritative_output,false);
  assert.equal(route.historical_protocol_version,"v1.11.0");
  assert.equal(route.active_consumer_protocol_version,"v1.11.1");
  assert.equal(route.active_consumer_inspector_commit,"80bc105d924d7c7dd566e76a9d8d919368655cfa");
});

test("legacy schemas are retained only as historical v1.11.0 snapshots",()=>{
  const input=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/input.schema.json"),"utf8"));
  const output=JSON.parse(readFileSync(join(repo,"domains/pr_inspector_action/output.schema.json"),"utf8"));
  assert.equal(input.properties.pr_inspector_protocol_version.const,"v1.11.0");
  assert.equal(output.properties.consumer_compatibility.properties.protocol_version.const,"v1.11.0");
});

test("package excludes templates and policy assets that could reconstruct prompts",()=>{
  for(const path of ["templates/model_action.md","templates/human_handoff.md","templates/no_prompt.md","rules.yaml","validators.yaml","evals.yaml"]){
    assert.equal(existsSync(join(here,"../dist/assets",path)),false,path);
  }
});
