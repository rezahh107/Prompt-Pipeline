#!/usr/bin/env tsx
import yaml from 'js-yaml';
import { createValidatedIntakeEnvelope, generateArtifact, reviewArtifact, verifyArtifact } from '../src/runtime-authority.js';

const intake = createValidatedIntakeEnvelope({
  request: 'create prompt for medical diagnosis advice',
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
const generated = generateArtifact(intake, 'ci');
const reviewed = reviewArtifact(generated.outputPath, 'approved');
console.log(yaml.dump({ authorization: reviewed.artifact.authorization, verification: verifyArtifact(reviewed.outputPath) }, { lineWidth: 120, noRefs: true }));
