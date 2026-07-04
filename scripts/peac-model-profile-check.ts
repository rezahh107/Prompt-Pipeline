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
const REQUIRED = ['gpt', 'claude', 'gemini', 'local_small'];
function load<T>(path: string): T { return yaml.load(readFileSync(path, 'utf8')) as T }
function writeCase(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true })) }
function validateRegistry(): string[] {
  const failures: string[] = [];
  if (!existsSync(REGISTRY)) return [`missing model profile registry: ${REGISTRY}`];
  const data = load<Registry>(REGISTRY);
  const profiles = data.profiles ?? [];
  const ids = new Set(profiles.map((p) => p.id));
  for (const required of REQUIRED) if (!ids.has(required)) failures.push(`missing required model profile: ${required}`);
  for (const profile of profiles) {
    const label = profile.id ?? 'unknown_profile';
    if (!profile.id) failures.push('profile missing id');
    if (!profile.label) failures.push(`${label}: missing label`);
    if (!Array.isArray(profile.target_environments) || profile.target_environments.length === 0) failures.push(`${label}: missing target_environments`);
    if (!Array.isArray(profile.prompt_guidance) || profile.prompt_guidance.length === 0) failures.push(`${label}: missing prompt_guidance`);
  }
  return failures;
}
function profileCase(profile: string): Dict {
  return {
    case_id: `model-profile-${profile}`,
    version: '2026.3',
    description: `Model profile check for ${profile}.`,
    domain: 'prompt_generation',
    subtype: 'master_prompt',
    inputs: {
      task: `Create a reusable prompt adapted for the ${profile} model profile.`,
      desired_output: 'A copy-ready prompt with model-specific guidance.',
      target_environment: profile === 'claude' ? 'Claude' : profile === 'gemini' ? 'Gemini' : profile === 'local_small' ? 'Local' : 'ChatGPT',
      target_model: profile,
      model_profile: profile,
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
function validateRenderedProfiles(): string[] {
  const failures: string[] = [];
  for (const profile of REQUIRED) {
    const path = join(WORK_DIR, `${profile}.case.yaml`);
    writeCase(path, profileCase(profile));
    const { artifact } = generateArtifact({ case: path, mode: 'ci' });
    if (!artifact.rendered_prompt.includes(`Selected model profile: ${profile}`)) failures.push(`${profile}: rendered prompt did not include selected model profile`);
    if (profile === 'claude' && !artifact.rendered_prompt.includes('Use XML-style tags')) failures.push('claude: missing XML-style guidance');
    if (profile === 'gemini' && !artifact.rendered_prompt.includes('Use direct task framing')) failures.push('gemini: missing direct task framing guidance');
    if (profile === 'local_small' && !artifact.rendered_prompt.includes('Use shorter instructions')) failures.push('local_small: missing short-instruction guidance');
    if (profile === 'gpt' && !artifact.rendered_prompt.includes('Use clear section headers')) failures.push('gpt: missing GPT section guidance');
  }
  return failures;
}
const failures = [...validateRegistry(), ...validateRenderedProfiles()];
if (failures.length > 0) {
  console.error(`PEaC model profile check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC model profile check passed for ${REQUIRED.length} profile(s).`);
