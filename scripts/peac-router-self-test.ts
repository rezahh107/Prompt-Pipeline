#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { routeRequestForTest } from '../src/peac.js';

interface DomainRoute {
  enabled?: boolean;
  priority?: number;
  keywords?: string[];
  patterns?: string[];
  negative_keywords?: string[];
  confidence_threshold?: number;
}

interface RouterConfig {
  routing_strategy?: { primary?: string; tiebreak?: string };
  domains: Record<string, DomainRoute>;
}

function assertEqual(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`${name}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertTrue(name: string, condition: boolean): void {
  if (!condition) throw new Error(`${name}: expected true`);
}

const router = yaml.load(readFileSync('pipeline/router.yaml', 'utf8')) as RouterConfig;

function routeRequest(request: string): string {
  return routeRequestForTest(request).domain;
}

assertEqual('repo audit keyword route', routeRequest('Please run a repository audit for this source tree.'), 'repo_review');
assertEqual('repo audit multiline route', routeRequest('repository\nneeds a strict audit'), 'repo_review');
assertEqual('image keyword route', routeRequest('یک پرامپت تصویر برای پرتره بده'), 'image');
assertEqual('multimodal exact text logo route', routeRequest('Create an image prompt with exact text and logo fidelity.'), 'multimodal');
assertEqual('prompt generation beats coding when user asks for a prompt', routeRequest('Create a prompt to review code for correctness and tests.'), 'prompt_generation');
assertEqual('prompt refactor route', routeRequest('improve prompt structure and constraints'), 'prompt_refactor');
assertEqual('prompt audit route', routeRequest('audit prompt structure for risks'), 'prompt_audit');
assertEqual('code review route', routeRequest('review code for correctness and tests'), 'coding_debugging');
assertEqual('debugging route', routeRequest('debug code after a runtime error'), 'coding_debugging');
assertEqual('fallback route', routeRequest('give me a practical decision framework'), 'general');

const multimodal = routeRequestForTest('Create an image prompt with exact text and logo fidelity.');
assertEqual('weighted router method is used', multimodal.method, 'weighted_score');
assertTrue('multimodal confidence passes threshold', multimodal.confidence >= (router.domains.multimodal.confidence_threshold ?? 0.82));
assertTrue('router strategy is weighted_score', router.routing_strategy?.primary === 'weighted_score');
assertTrue('image domain enabled', router.domains.image.enabled === true);
assertTrue('image has negative keywords', (router.domains.image.negative_keywords ?? []).length > 0);
assertTrue('repo_review priority is explicit', typeof router.domains.repo_review.priority === 'number');
assertTrue('coding_debugging priority is explicit', typeof router.domains.coding_debugging.priority === 'number');

console.log('PEaC router self tests passed.');
