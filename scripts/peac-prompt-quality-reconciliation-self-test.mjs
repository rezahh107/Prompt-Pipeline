#!/usr/bin/env node
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {validateOwnerPayloadBytes,decodeOwnerPayloadSource,validateReconciliationComparison,stableMainProjection,evidenceProjectionDigest,carrierLedgerValid} from './prompt-quality-governance/evidence.mjs';
import {validateLifecycle,reLedger} from './prompt-quality-governance/lifecycle.mjs';
import {validateImpactHistory,validateScope} from './prompt-quality-governance/scope-progress.mjs';

const ROOT=process.cwd(),json=p=>JSON.parse(readFileSync(path.join(ROOT,p),'utf8')),clone=structuredClone;
let passed=0;
function expect(name,condition){if(!condition)throw new Error(`reconciliation production mutation failed: ${name}`);passed++;console.log(`reconciliation production mutation PASS: ${name}`)}
const RAW_PATH='planning/prompt-quality/evidence/sources/pr-29-owner-merge.raw.json',raw=decodeOwnerPayloadSource(readFileSync(path.join(ROOT,RAW_PATH))),basePayload=JSON.parse(raw),mutate=fn=>{const x=clone(basePayload);fn(x);return Buffer.from(JSON.stringify(x))};
const valid=bytes=>validateOwnerPayloadBytes(bytes).ok;

expect('1 valid raw owner-Merge REST projection',valid(raw));
expect('2 invalid JSON payload rejected',!valid(Buffer.from('{')));
expect('3 wrong PR number rejected',!valid(mutate(x=>x.number=30)));
expect('4 wrong repository ID rejected',!valid(mutate(x=>x.base.repo.id=1)));
expect('5 wrong repository name rejected',!valid(mutate(x=>x.base.repo.full_name='other/repo')));
expect('6 wrong base SHA rejected',!valid(mutate(x=>x.base.sha='f'.repeat(40))));
expect('7 wrong final PR Head rejected',!valid(mutate(x=>x.head.sha='f'.repeat(40))));
expect('8 wrong Merge commit rejected',!valid(mutate(x=>x.merge_commit_sha='f'.repeat(40))));
expect('9 merged false rejected',!valid(mutate(x=>x.merged=false)));
expect('10 missing merged_by rejected',!valid(mutate(x=>delete x.merged_by)));
expect('11 PR creator cannot substitute for merged_by',!valid(mutate(x=>{delete x.merged_by;x.merge_actor=x.user})));
expect('12 commit author cannot substitute for merged_by',!valid(mutate(x=>x.merged_by={login:'web-flow',id:19864447,type:'User'})));
expect('13 wrong owner login rejected',!valid(mutate(x=>x.merged_by.login='other')));
expect('14 wrong owner ID rejected',!valid(mutate(x=>x.merged_by.id=1)));
expect('15 wrong owner type rejected',!valid(mutate(x=>x.merged_by.type='Bot')));
expect('16 stale PR body Head does not replace live head field',valid(mutate(x=>x.body='current_exact_head: c4bf2ae0250b0caa8eb99e567e966a9fffd2711b')));

const SCOPE_PATH='planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION-POST-MERGE-RECONCILIATION.scope.json',scope=json(SCOPE_PATH),subject='e3f98e007bba01ba02310b01377f617c94ca8b09';
const files=scope.committed_paths.map(filename=>({filename,status:filename===SCOPE_PATH?'added':'modified'}));
const comparison={status:'ahead',ahead_by:3,behind_by:0,merge_base_commit:{sha:subject},files};
expect('17 evidence-carrier main advance remains valid',validateReconciliationComparison(scope,comparison,subject).ok);
expect('18 authorized descendant remains valid',validateReconciliationComparison(scope,{...comparison,ahead_by:9},subject).ok);
expect('19 unauthorized descendant path rejected',!validateReconciliationComparison(scope,{...comparison,files:[...files,{filename:'README.md',status:'modified'}]},subject).ok);
expect('20 deleted carrier path rejected',!validateReconciliationComparison(scope,{...comparison,files:files.map((x,i)=>i?x:{...x,status:'removed'})},subject).ok);
expect('21 renamed carrier path rejected',!validateReconciliationComparison(scope,{...comparison,files:files.map((x,i)=>i?x:{...x,status:'renamed'})},subject).ok);
expect('22 divergent main rejected',!validateReconciliationComparison(scope,{...comparison,status:'diverged',behind_by:1},subject).ok);
expect('23 current main behind immutable subject rejected',!validateReconciliationComparison(scope,{...comparison,status:'behind',behind_by:1},subject).ok);
expect('24 missing activation Merge ancestry rejected',!validateReconciliationComparison(scope,{...comparison,merge_base_commit:{sha:'f'.repeat(40)}},subject).ok);

const ledgerPath='planning/prompt-quality/lifecycle/PROMPT-QUALITY-PROGRAM-ACTIVATION.ledger.json',currentLedger=json(ledgerPath),baseLedger=clone(currentLedger);baseLedger.events=baseLedger.events.slice(0,5);baseLedger.pull_request=null;baseLedger.scope_revision=baseLedger.events.at(-1).scope_revision;baseLedger.branch_kind='feature';baseLedger.completion_claim=false;baseLedger.next_required_event='exact_head_validated';
const receipts=readdirSync(path.join(ROOT,'planning/prompt-quality/evidence/receipts')).filter(x=>x.endsWith('.json')).map(file=>({file:`planning/prompt-quality/evidence/receipts/${file}`,value:json(`planning/prompt-quality/evidence/receipts/${file}`)}));
expect('25 append-only lifecycle carrier accepted',carrierLedgerValid(baseLedger,currentLedger,receipts));
const historicalMutation=clone(currentLedger);historicalMutation.events[0].occurred_at='2026-07-18T12:25:09Z';expect('26 historical lifecycle event mutation rejected',!carrierLedgerValid(baseLedger,historicalMutation,receipts));

const historicalScope=json('planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION.scope.json'),scopeByIdentity=new Map([[`${historicalScope.task_id}:${historicalScope.scope_revision}`,{file:'planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION.scope.json',value:historicalScope}],[`${scope.task_id}:${scope.scope_revision}`,{file:SCOPE_PATH,value:scope}]]);
const replay=clone(currentLedger);replay.events[6].event_id=replay.events[5].event_id;reLedger(replay);let diagnostics=await validateLifecycle(replay,scope,{source:ledgerPath,scopeByIdentity});expect('27 lifecycle replay rejected',diagnostics.some(x=>x.code==='PQG_LIFECYCLE_EVENT_REPLAY'));
const evidenceReplay=clone(currentLedger);evidenceReplay.events[6].evidence[0].sha256=evidenceReplay.events[5].evidence[0].sha256;reLedger(evidenceReplay);diagnostics=await validateLifecycle(evidenceReplay,scope,{source:ledgerPath,scopeByIdentity});expect('28 receipt or evidence replay rejected',diagnostics.some(x=>x.code==='PQG_LIFECYCLE_EVIDENCE_REPLAY'));
const impacts=[json('planning/prompt-quality/impacts/0001-PROMPT-QUALITY-PROGRAM-ACTIVATION.json'),json('planning/prompt-quality/impacts/0002-PROMPT-QUALITY-PROGRAM-ACTIVATION-RECONCILIATION.json')];expect('29 historical impact mutation rejected',validateImpactHistory(impacts,{mutated:true,source:'planning/prompt-quality/impacts'}).some(x=>x.code==='PQG_IMPACT_HISTORY_MUTATED'));
diagnostics=await validateScope(scope,{source:SCOPE_PATH,task:scope.task_id,base:scope.base_sha,actual:scope.committed_paths,deleted:[],retroactive:true,requireHistoryEvidence:true});expect('30 retroactive Scope authorization rejected',diagnostics.some(x=>x.code==='PQG_SCOPE_RETROACTIVE_AMENDMENT'));
const incomplete=clone(currentLedger);incomplete.events=incomplete.events.slice(0,-1);incomplete.completion_claim=true;incomplete.next_required_event=null;reLedger(incomplete);diagnostics=await validateLifecycle(incomplete,scope,{source:ledgerPath,scopeByIdentity});expect('31 completion without durable exact-main evidence rejected',diagnostics.some(x=>['PQG_FEATURE_BRANCH_COMPLETION_FORBIDDEN','PQG_LIFECYCLE_SEQUENCE_INVALID','PQG_EXACT_MAIN_EVIDENCE_MISSING'].includes(x.code)));
expect('32 substantive PPQR path smuggling rejected',!validateReconciliationComparison(scope,{...comparison,files:[...files.slice(0,-1),{filename:'planning/prompt-quality/scopes/PPQR-001.scope.json',status:'added'}]},subject).ok);
const merge=subject,stableA=stableMainProjection(subject,merge,null),stableB=stableMainProjection(subject,merge,{status:'ahead',behind_by:0,merge_base_commit:{sha:merge}});expect('33 mutable current-Head does not enter stable exact-main digest',evidenceProjectionDigest(stableA)===evidenceProjectionDigest(stableB));
if(passed<33)throw new Error(`expected 33 reconciliation mutations, observed ${passed}`);
console.log(`Prompt Quality reconciliation production-path mutation suite passed. cases=${passed}`);
