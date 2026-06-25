#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

interface DomainRoute {
  enabled?: boolean;
  keywords?: string[];
  patterns?: string[];
  confidence_threshold?: number;
}

interface RouterConfig {
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
  const normalized = request.toLowerCase();
  for (const [domain, config] of Object.entries(router.domains)) {
    if (config.enabled === false || domain === 'general') continue;
    const keywordMatch = (config.keywords ?? []).some((keyword) => normalized.includes(keyword.toLowerCase()));
    const patternMatch = (config.patterns ?? []).some((pattern) => new RegExp(pattern, 'i').test(request));
    if (keywordMatch || patternMatch) return domain;
  }
  return 'general';
}

assertEqual('repo audit keyword route', routeRequest('Please run a repository audit for this source tree.'), 'repo_review');
assertEqual('repo audit multiline route', routeRequest('repository\nneeds a strict audit'), 'repo_review');
assertEqual('image keyword route', routeRequest('یک پرامپت تصویر برای پرتره بده'), 'image');
assertEqual('prompt refactor route', routeRequest('improve prompt structure and constraints'), 'prompt_refactor');
assertEqual('prompt audit route', routeRequest('audit prompt structure for risks'), 'prompt_audit');
assertEqual('fallback route', routeRequest('give me a practical decision framework'), 'general');

assertTrue('image domain enabled', router.domains.image.enabled === true);
assertTrue('repo_review confidence threshold is explicit', typeof router.domains.repo_review.confidence_threshold === 'number');

console.log('PEaC router self tests passed.');
