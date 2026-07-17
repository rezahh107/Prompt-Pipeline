import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.js";
import { render } from "../dist/render.js";

const projection={pr_inspector_protocol_version:"v1.11.1",action_kind:"repair",rendered_prompt:"forged"};
const plainDictionary={prompt_required:true,rendered_prompt:"forged"};
const capabilityLookalike={artifact_bytes:{"NEXT_ACTION_PROMPT.en.md":"forged"},_reverify(){return this;}};
const serializedCapability=JSON.stringify({type:"VerifiedReviewCompletion",artifact_bytes:{"NEXT_ACTION_PROMPT.en.md":"forged"}});

function assertMigration(fn){
  assert.throws(fn,(error)=>error?.category==="migration_required"&&error.message.includes(api.MIGRATION_ERROR_CODE));
}

test("package root does not export the retired render path",()=>assert.equal("render" in api,false));
test("a v1.11.1 projection alone cannot produce authoritative prompt bytes",()=>assertMigration(()=>api.rejectActiveRendering(projection)));
test("a plain dictionary or serialized capability lookalike is rejected",()=>{assertMigration(()=>api.rejectActiveRendering(plainDictionary));assertMigration(()=>api.rejectActiveRendering(serializedCapability));});
test("a copied VerifiedReviewCompletion-shaped value is rejected",()=>assertMigration(()=>api.rejectActiveRendering(capabilityLookalike)));
test("active-mode output cannot be generated through the old render path",()=>assertMigration(()=>render(projection)));
test("historical v1.11.0 compatibility cannot masquerade as active compatibility",()=>{const c=api.getCompatibility();assert.equal(c.lifecycle,"historical_compatibility_only");assert.equal(c.protocol,"v1.11.0");assert.equal(c.authoritative_output,false);assert.equal(c.may_render_active_prompt,false);assert.equal(c.active_inspector.protocol,"v1.11.1");});
test("unsupported active integration fails closed with deterministic migration metadata",()=>{const lifecycle=api.getLifecycle();assert.equal(lifecycle.active_rendering_supported,false);assert.equal(lifecycle.official_byte_passthrough_supported,false);assert.equal(lifecycle.migration_error_code,api.MIGRATION_ERROR_CODE);assert.deepEqual(lifecycle.active_inspector,{repository:"rezahh107/PR-Inspector",protocol:"v1.11.1",commit:"80bc105d924d7c7dd566e76a9d8d919368655cfa"});});
test("package metadata claims neither publication nor downstream integration",()=>{const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));assert.equal(pkg.private,true);assert.equal(pkg.publishConfig,undefined);assert.equal(pkg.bin,undefined);assert.deepEqual(Object.keys(pkg.exports),["."]);const p=api.getProvenance();assert.equal(p.publication_status,"NOT_PUBLISHED");assert.equal(p.downstream_integration_status,"NOT_INTEGRATED");assert.equal(p.lifecycle_status,"historical_fail_closed_compatibility");});
test("CLI render rejects projection and capability lookalikes without success stdout",()=>{const cli=new URL("../dist/cli.js",import.meta.url);for(const input of [JSON.stringify(projection),serializedCapability]){const result=spawnSync(process.execPath,[cli.pathname,"render"],{input,encoding:"utf8"});assert.notEqual(result.status,0);assert.equal(result.stdout,"");const diagnostic=JSON.parse(result.stderr);assert.equal(diagnostic.category,"migration_required");assert.match(diagnostic.message,new RegExp(api.MIGRATION_ERROR_CODE));}});
test("CLI contract exposes lifecycle only",()=>{const cli=new URL("../dist/cli.js",import.meta.url);const result=spawnSync(process.execPath,[cli.pathname,"contract"],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);const payload=JSON.parse(result.stdout);assert.equal(payload.contract,"pr_inspector_action.historical.v1");assert.equal(payload.lifecycle.active_rendering_supported,false);assert.equal("input_schema" in payload,false);assert.equal("output_schema" in payload,false);});
