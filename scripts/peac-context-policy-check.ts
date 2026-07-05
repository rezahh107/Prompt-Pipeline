#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact } from '../src/peac.js';

type Dict = Record<string, unknown>;
interface ContextProfile { id?: string; label?: string; max_context_items?: number; max_context_tokens?: number; required_context_rules?: string[] }
interface ContextPolicy { profiles?: ContextProfile[]; common_rules?: string[] }
interface ContextItem { id?: string; source?: string; purpose?: string; trust_level?: string; estimated_tokens?: number }
const POLICY = 'pipeline/context-policy.yaml';
const WORK_DIR = 'outputs/context-policy-check';
const REQUIRED = new Set(['minimal', 'standard', 'deep']);
function load<T>(path: string): T { return (yaml.load(readFileSync(path, 'utf8')) ?? {}) as T }
function writeCase(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true })) }
function policy(): { profiles: ContextProfile[]; commonRules: string[]; failures: string[] } {
  const failures: string[] = [];
  if (!existsSync(POLICY)) return { profiles: [], commonRules: [], failures: [`missing context policy registry: ${POLICY}`] };
  const data = load<ContextPolicy>(POLICY);
  const profiles = data.profiles ?? [];
  const commonRules = data.common_rules ?? [];
  const seen = new Set<string>();
  for (const required of REQUIRED) if (!profiles.some((profile) => profile.id === required)) failures.push(`missing required context profile: ${required}`);
  for (const profile of profiles) {
    const label = profile.id ?? 'unknown_context_profile';
    if (!profile.id) failures.push('context profile missing id');
    else if (seen.has(profile.id)) failures.push(`duplicate context profile id: ${profile.id}`);
    else seen.add(profile.id);
    if (profile.id && !REQUIRED.has(profile.id)) failures.push(`${label}: unsupported context profile id: ${profile.id}`);
    if (!profile.label) failures.push(`${label}: missing label`);
    if (!Number.isInteger(profile.max_context_items) || Number(profile.max_context_items) < 0) failures.push(`${label}: invalid max_context_items`);
    if (!Number.isInteger(profile.max_context_tokens) || Number(profile.max_context_tokens) < 0) failures.push(`${label}: invalid max_context_tokens`);
    if (!Array.isArray(profile.required_context_rules) || profile.required_context_rules.length === 0) failures.push(`${label}: missing required_context_rules`);
  }
  if (!Array.isArray(commonRules) || commonRules.length === 0) failures.push('missing common context rules');
  return { profiles, commonRules, failures };
}
function itemTokenTotal(items: ContextItem[]): number { return items.reduce((sum, item) => sum + (typeof item.estimated_tokens === 'number' ? item.estimated_tokens : 0), 0) }
function validateCaseContext(label: string, profile: ContextProfile, items: ContextItem[], budget: number): string[] {
  const failures: string[] = [];
  if (items.length > Number(profile.max_context_items)) failures.push(`${label}: context item count exceeds policy maximum`);
  if (budget > Number(profile.max_context_tokens)) failures.push(`${label}: context budget exceeds policy maximum`);
  if (itemTokenTotal(items) > budget) failures.push(`${label}: context item estimated_tokens exceed declared context_budget_tokens`);
  for (const item of items) {
    if (!item.id || !item.source || !item.purpose || !item.trust_level) failures.push(`${label}: context item missing required provenance fields`);
    if (item.trust_level === 'unknown' && !String(item.source ?? '').includes('unknown')) failures.push(`${label}: unknown-trust context item must keep an explicit unknown source label`);
  }
  return failures;
}
function promptCase(profile: ContextProfile): Dict {
  const id = String(profile.id);
  const budget = Math.min(Number(profile.max_context_tokens), id === 'minimal' ? 800 : id === 'standard' ? 2500 : 6000);
  const items: ContextItem[] = [
    { id: 'user_request', source: 'current user message', purpose: 'primary task and constraints', trust_level: 'user_provided', estimated_tokens: 300 },
    { id: 'project_policy', source: 'repository policy file', purpose: 'pipeline governance rules', trust_level: 'trusted', estimated_tokens: 500 }
  ];
  return {
    case_id: `context-policy-${id}`,
    version: '2026.3',
    description: `Context policy check for ${id}.`,
    domain: 'prompt_generation',
    subtype: 'master_prompt',
    inputs: {
      task: `Create a reusable prompt with ${id} context governance.`,
      desired_output: 'A copy-ready prompt with explicit context policy notes.',
      target_environment: 'ChatGPT',
      target_model: 'GPT',
      model_profile: 'gpt',
      context_policy: id,
      context_budget_tokens: budget,
      context_items: items,
      prompt_language: 'English',
      explanation_language: 'Persian',
      target_output_language: 'Persian',
      strictness: 'production-grade',
      requires_current_information: false,
      uses_external_tools: false,
      sensitive_or_high_risk: false,
      requires_structured_output: true,
      success_criteria: ['The rendered prompt includes context policy and budget.'],
      failure_modes: ['The prompt omits context provenance requirements.'],
      eval_suite: ['prompt_generation_quality/context_policy_present'],
      user_constraints: 'Preserve context provenance and budget notes.'
    },
    expected: { risk_level: 'medium', requires_human_review: false, validation: { should_pass: true } }
  };
}
function renderChecks(profile: ContextProfile, commonRules: string[]): string[] {
  const failures: string[] = [];
  const path = join(WORK_DIR, `${profile.id}.case.yaml`);
  const caseData = promptCase(profile);
  const items = ((caseData.inputs as Dict).context_items as ContextItem[]) ?? [];
  failures.push(...validateCaseContext(String(profile.id), profile, items, Number((caseData.inputs as Dict).context_budget_tokens)));
  writeCase(path, caseData);
  const { artifact } = generateArtifact({ case: path, mode: 'ci' });
  const rendered = artifact.rendered_prompt;
  if (!rendered.includes(`Selected context policy: ${profile.id}`)) failures.push(`${profile.id}: rendered prompt missing selected context policy`);
  if (!rendered.includes('Context budget:')) failures.push(`${profile.id}: rendered prompt missing context budget`);
  for (const rule of commonRules) if (!rendered.includes(rule)) failures.push(`${profile.id}: rendered prompt missing common rule: ${rule}`);
  if (!rendered.includes('source=') || !rendered.includes('trust=')) failures.push(`${profile.id}: rendered prompt missing context item provenance labels`);
  return failures;
}
const { profiles, commonRules, failures: policyFailures } = policy();
const failures = [...policyFailures, ...profiles.flatMap((profile) => renderChecks(profile, commonRules))];
if (failures.length > 0) {
  console.error(`PEaC context policy check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC context policy check passed for ${profiles.length} context profile(s).`);
