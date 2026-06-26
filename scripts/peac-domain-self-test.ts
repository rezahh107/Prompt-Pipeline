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

const imageArtifact = generateArtifact({ case: 'domains/image/cases/academic-portrait.yaml', mode: 'ci' }).artifact;
assertIncludes('image prompt has priority order', imageArtifact.rendered_prompt, 'Priority order:');
assertIncludes('image prompt has protected boundary', imageArtifact.rendered_prompt, 'Protected:');
assertIncludes('image prompt has editable boundary', imageArtifact.rendered_prompt, 'Editable:');
assertIncludes('image prompt blocks generated text elements', imageArtifact.rendered_prompt, 'Do not generate any text');

const repoArtifact = generateArtifact({ case: 'domains/repo_review/cases/repository-audit-basic.yaml', mode: 'ci' }).artifact;
assertIncludes('repo prompt has evidence section', repoArtifact.rendered_prompt, '[EVIDENCE AND ACCURACY RULES]');
assertIncludes('repo prompt blocks invented results', repoArtifact.rendered_prompt, 'Do not fabricate test results');

console.log('PEaC domain self tests passed.');
