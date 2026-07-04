#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact } from '../src/peac.js';

type Dict = Record<string, unknown>;
interface Profile { id?: string; label?: string; target_environments?: string[]; prompt_guidance?: string[] }
interface Registry { profiles?: Profile[] }
const REGISTRY = 'pipeline/model-profiles.yaml';
const WORK_DIR = 'outputs/model-profile-check';
const REQUIRED = new Set(['gpt', 'claude', 'gemini', 'local_small']);
function load<T>(path: string): T { return yaml.load(readFileSync(path, 'utf8')) as T }
function writeCase(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true })) }
function registry(): { profiles: Profile[]; failures: string[] } {
  const failures: string[] = [];
  if (!existsSync(REGISTRY)) return { profiles: [], failures: [`missing model profile registry: ${REGISTRY}`] };
  const data = load<Registry>(REGISTRY);
  const profiles = data.profiles ?? [];
  const seen = new Set<string>();
  for (const required of REQUIRED) if (!profiles.some((profile) => profile.id === required)) failures.push(`missing required model profile: ${required}`);
  for (const profile of profiles) {
    const label = profile.id ?? 'unknown_profile';
    if (!profile.id) failures.push('profile missing id');
    else if (seen.has(profile.id)) failures.push(`duplicate model profile id: ${profile.id}`);
    else seen.add(profile.id);
    if (profile.id && !REQUIRED.has(profile.id)) failures.push(`${label}: unsupported profile id not represented in schema/template: ${profile.id}`);
    if (!profile.label) failures.push(`${label}: missing label`);
    if (!Array.isArray(profile.target_environments) || profile.target_environments.length === 0) failures.push(`${label}: missing target_environments`);
    if (!Array.isArray(profile.prompt_guidance) || profile.prompt_guidance.length === 0) failures.push(`${label}: missing prompt_guidance`);
    for (const guidance of profile.prompt_guidance ?? []) if (typeof guidance !== 'string' || guidance.trim() === '') failures.push(`${label}: prompt_guidance contains an empty or non-string item`);
  }
  return { profiles, failures };
}
function profileCase(profile: Profile): Dict {
  const id = String(profile.id);
  const target = profile.target_environments?.[0] ?? 'ChatGPT';
  return {
    case_id: `model-profile-${id}`,
    version: '2026.3',
    description: `Model profile check for ${id}.`,
    domain: 'prompt_generation',
    subtype: 'master_prompt',
    inputs: {
      task: `Create a reusable prompt adapted for the ${id} model profile.`,
      desired_output: 'A copy-ready prompt with model-specific guidance.',
      target_environment: target,
      target_model: id,
      model_profile: id,
      prompt_language: 'English',
      explanation_language: 'Persian',
      target_output_language: 'Persian',
      strictness: 'production-grade',
      requires_current_information: false,
      uses_external_tools: false,
      sensitive_or_high_risk: false,
      requires_structured_output: true,
      success_criteria: ['The rendered prompt includes the selected model profile.'],
      failure_modes: ['The rendered prompt falls back to a generic profile.'],
      eval_suite: ['prompt_generation_quality/model_profile_present'],
      user_constraints: 'No extra constraints provided.'
    },
    expected: { risk_level: 'medium', requires_human_review: false, validation: { should_pass: true } }
  };
}
function validateRenderedProfiles(profiles: Profile[]): string[] {
  const failures: string[] = [];
  for (const profile of profiles) {
    if (!profile.id) continue;
    const path = join(WORK_DIR, `${profile.id}.case.yaml`);
    writeCase(path, profileCase(profile));
    const { artifact } = generateArtifact({ case: path, mode: 'ci' });
    if (!artifact.rendered_prompt.includes(`Selected model profile: ${profile.id}`)) failures.push(`${profile.id}: rendered prompt did not include selected model profile`);
    for (const guidance of profile.prompt_guidance ?? []) if (!artifact.rendered_prompt.includes(guidance)) failures.push(`${profile.id}: rendered prompt missing registry guidance: ${guidance}`);
  }
  return failures;
}
const { profiles, failures: registryFailures } = registry();
const failures = [...registryFailures, ...validateRenderedProfiles(profiles)];
if (failures.length > 0) {
  console.error(`PEaC model profile check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC model profile check passed for ${profiles.length} profile(s).`);
