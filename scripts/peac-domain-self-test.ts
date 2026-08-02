#!/usr/bin/env tsx
import { readFileSync, rmSync } from 'node:fs';
import yaml from 'js-yaml';
import { type Dict } from '../src/peac.js';
import { createFixtureEnvelope, generateArtifact } from '../src/runtime-authority-api.js';

function assertTrue(name: string, condition: boolean): void {
  if (!condition) throw new Error(`${name}: expected true`);
}

function assertIncludes(name: string, haystack: string, needle: string): void {
  if (!haystack.includes(needle)) throw new Error(`${name}: expected prompt to include ${needle}`);
}

function assertNotIncludes(name: string, haystack: string, needle: string): void {
  if (haystack.includes(needle)) throw new Error(`${name}: expected prompt not to include ${needle}`);
}

function canonicalFixture(casePath: string): Dict {
  const result = generateArtifact(createFixtureEnvelope(casePath), 'ci');
  try {
    const payload = result.artifact.artifact as Dict;
    assertTrue(`${casePath} uses canonical envelope`, result.artifact.schema_id === 'peac.runtime-artifact-envelope');
    assertTrue(`${casePath} remains non-authoritative`, result.artifact.authorization.authority_state === 'non_authoritative_fixture');
    assertTrue(`${casePath} has canonical identity`, payload.canonical_prompt_identity !== null && typeof payload.canonical_prompt_identity === 'object');
    return structuredClone(payload);
  } finally {
    rmSync(result.outputPath, { force: true });
  }
}

const imageRoute = (yaml.load(readFileSync('domains/image/route.yaml', 'utf8')) ?? {}) as { subtypes?: Array<{ id: string }> };
assertTrue('image_qa subtype exists', (imageRoute.subtypes ?? []).some((subtype) => subtype.id === 'image_qa'));

const repoRules = (yaml.load(readFileSync('domains/repo_review/rules.yaml', 'utf8')) ?? {}) as { rules?: Array<{ id: string }> };
for (const ruleId of [
  'repo_review.evidence_first',
  'repo_review.no_unverified_results',
  'repo_review.smallest_safe_patch',
  'repo_review.no_unconfirmed_merge'
]) {
  assertTrue(`repo_review rule exists: ${ruleId}`, (repoRules.rules ?? []).some((rule) => rule.id === ruleId));
}

const codingRoute = (yaml.load(readFileSync('domains/coding_debugging/route.yaml', 'utf8')) ?? {}) as { subtypes?: Array<{ id: string }> };
assertTrue('code_review subtype exists', (codingRoute.subtypes ?? []).some((subtype) => subtype.id === 'code_review'));
assertTrue('debugging subtype exists', (codingRoute.subtypes ?? []).some((subtype) => subtype.id === 'debugging'));

const codingRules = (yaml.load(readFileSync('domains/coding_debugging/rules.yaml', 'utf8')) ?? {}) as { rules?: Array<{ id: string }> };
for (const ruleId of [
  'coding_debugging.evidence_first',
  'coding_debugging.no_unverified_results',
  'coding_debugging.patch_only',
  'coding_debugging.tests_required',
  'coding_debugging.root_cause_uncertainty'
]) {
  assertTrue(`coding_debugging rule exists: ${ruleId}`, (codingRules.rules ?? []).some((rule) => rule.id === ruleId));
}

const imageArtifact = canonicalFixture('domains/image/cases/academic-portrait.yaml');
const imagePrompt = String(imageArtifact.rendered_prompt ?? '');
assertIncludes('image prompt has priority order', imagePrompt, 'Priority order:');
assertIncludes('image prompt has protected boundary', imagePrompt, 'Protected:');
assertIncludes('image prompt has editable boundary', imagePrompt, 'Editable:');
assertIncludes('image prompt blocks generated text elements', imagePrompt, 'Do not generate any text');

const repoArtifact = canonicalFixture('domains/repo_review/cases/repository-audit-basic.yaml');
const repoPrompt = String(repoArtifact.rendered_prompt ?? '');
assertIncludes('repo prompt has evidence section', repoPrompt, '[EVIDENCE AND ACCURACY RULES]');
assertIncludes('repo prompt blocks invented results', repoPrompt, 'Do not fabricate test results');

const codeReviewArtifact = canonicalFixture('domains/coding_debugging/cases/code-review-basic.yaml');
const codeReviewPrompt = String(codeReviewArtifact.rendered_prompt ?? '');
assertIncludes('code review prompt has review focus', codeReviewPrompt, '[REVIEW FOCUS]');
assertIncludes('code review prompt has execution boundary', codeReviewPrompt, '[EXECUTION BOUNDARY]');
assertIncludes('code review prompt has patch protocol', codeReviewPrompt, '[PATCH PROTOCOL]');
assertIncludes('code review prompt has tests', codeReviewPrompt, 'Tests to run');

const noPatchNoTestsArtifact = canonicalFixture('domains/coding_debugging/cases/code-review-no-patch-no-tests.yaml');
const noPatchNoTestsPrompt = String(noPatchNoTestsArtifact.rendered_prompt ?? '');
assertNotIncludes('optional patch protocol is omitted', noPatchNoTestsPrompt, '[PATCH PROTOCOL]');
assertNotIncludes('optional tests section is omitted', noPatchNoTestsPrompt, 'Tests to run');

const debuggingArtifact = canonicalFixture('domains/coding_debugging/cases/debugging-basic.yaml');
const debuggingPrompt = String(debuggingArtifact.rendered_prompt ?? '');
assertIncludes('debugging prompt has protocol', debuggingPrompt, '[DEBUGGING PROTOCOL]');
assertIncludes('debugging prompt has execution boundary', debuggingPrompt, '[EXECUTION BOUNDARY]');
assertIncludes('debugging prompt has root causes', debuggingPrompt, 'Likely root causes');
assertIncludes('debugging prompt has unknowns', debuggingPrompt, 'Remaining unknowns');

console.log('PEaC canonical Domain behavior tests passed.');
