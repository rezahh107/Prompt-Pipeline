#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { generateArtifact } from '../src/peac.js';

function assertTrue(name: string, condition: boolean): void {
  if (!condition) throw new Error(`${name}: expected true`);
}

function assertIncludes(name: string, haystack: string, needle: string): void {
  if (!haystack.includes(needle)) throw new Error(`${name}: expected prompt to include ${needle}`);
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

const imageArtifact = generateArtifact({ case: 'domains/image/cases/academic-portrait.yaml', mode: 'ci' }).artifact;
assertIncludes('image prompt has priority order', imageArtifact.rendered_prompt, 'Priority order:');
assertIncludes('image prompt has protected boundary', imageArtifact.rendered_prompt, 'Protected:');
assertIncludes('image prompt has editable boundary', imageArtifact.rendered_prompt, 'Editable:');
assertIncludes('image prompt blocks generated text elements', imageArtifact.rendered_prompt, 'Do not generate any text');

const repoArtifact = generateArtifact({ case: 'domains/repo_review/cases/repository-audit-basic.yaml', mode: 'ci' }).artifact;
assertIncludes('repo prompt has evidence section', repoArtifact.rendered_prompt, '[EVIDENCE AND ACCURACY RULES]');
assertIncludes('repo prompt blocks invented results', repoArtifact.rendered_prompt, 'Do not fabricate test results');

const codeReviewArtifact = generateArtifact({ case: 'domains/coding_debugging/cases/code-review-basic.yaml', mode: 'ci' }).artifact;
assertIncludes('code review prompt has review focus', codeReviewArtifact.rendered_prompt, '[REVIEW FOCUS]');
assertIncludes('code review prompt has patch protocol', codeReviewArtifact.rendered_prompt, '[PATCH PROTOCOL]');
assertIncludes('code review prompt has tests', codeReviewArtifact.rendered_prompt, 'Tests to run');

const debuggingArtifact = generateArtifact({ case: 'domains/coding_debugging/cases/debugging-basic.yaml', mode: 'ci' }).artifact;
assertIncludes('debugging prompt has protocol', debuggingArtifact.rendered_prompt, '[DEBUGGING PROTOCOL]');
assertIncludes('debugging prompt has root causes', debuggingArtifact.rendered_prompt, 'Likely root causes');
assertIncludes('debugging prompt has unknowns', debuggingArtifact.rendered_prompt, 'Remaining unknowns');

console.log('PEaC domain self tests passed.');
