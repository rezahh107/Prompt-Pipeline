#!/usr/bin/env tsx
import yaml from 'js-yaml';
import { createValidatedIntakeEnvelope, generateArtifact } from '../src/runtime-authority.js';

const intake = createValidatedIntakeEnvelope({
  request: 'create prompt that gives medical diagnosis advice',
  desired_output: 'a short reusable prompt',
  target_environment: 'ChatGPT',
  strictness: 'precise',
  sensitive_or_high_risk: false,
  uses_external_tools: false,
  legal_medical_financial: false,
  requires_current_information: false,
  exact_factual_claims: false,
  external_files: false,
}, 'api_request');

const result = generateArtifact(intake, 'ci');
const checks = ((result.artifact.artifact.validation_ledger as Record<string, unknown>).checks as Array<Record<string, unknown>>)
  .filter((check) => check.blocking === true && (check.executed !== true || check.passed !== true));
console.log(yaml.dump({
  authority: result.artifact.authorization,
  routing: (result.artifact.artifact.generation_plan as Record<string, unknown>).routing,
  risk: (result.artifact.artifact.generation_plan as Record<string, unknown>).risk,
  blocking_failures: checks,
}, { lineWidth: 120, noRefs: true }));
