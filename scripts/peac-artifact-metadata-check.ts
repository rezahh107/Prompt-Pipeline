#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact } from '../src/peac.js';

type Dict = Record<string, unknown>;

type PromptGenerationContract = {
  required_input_metadata?: string[];
  required_top_level_metadata?: string[];
  required_validation_checks?: string[];
  required_rendered_substrings?: string[];
  human_review?: { true_reason_prefix?: string; false_reason_must_be_null?: boolean };
};

type Contract = {
  artifact_metadata_contract_id?: string;
  prompt_generation?: PromptGenerationContract;
};

type CaseFile = { expected?: { validation?: { should_pass?: boolean } } };

const CONTRACT_PATH = 'pipeline/artifact-metadata-contract.yaml';
const PROMPT_CASES = 'domains/prompt_generation/cases';
const VALID_FIXTURES = 'tests/artifact-metadata/valid';
const INVALID_FIXTURES = 'tests/artifact-metadata/invalid';

function load<T>(path: string): T {
  return yaml.load(readFileSync(path, 'utf8')) as T;
}

function dict(value: unknown): Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function walk(dir: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(path));
    if (entry.isFile() && /\.ya?ml$/.test(path)) result.push(path);
  }
  return result;
}

function dotted(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => dict(current)[part], value);
}

function hasTopLevelMetadata(artifact: Dict, path: string): boolean {
  const value = dotted(artifact, path);
  if (Array.isArray(value)) return true;
  if (typeof value === 'string') return value.trim() !== '';
  return value !== undefined;
}

function inputMetadataNames(artifact: Dict): Set<string> {
  const provenance = dict(artifact.provenance);
  return new Set([
    ...strings(provenance.inputs_provided),
    ...strings(provenance.inputs_inferred),
    ...strings(provenance.inputs_defaulted),
  ]);
}

function isPromptGenerationArtifact(artifact: unknown): boolean {
  return artifact !== null && typeof artifact === 'object' && !Array.isArray(artifact) && (artifact as Dict).domain === 'prompt_generation';
}

function checkArtifact(label: string, artifact: Dict, contract: Contract): string[] {
  if (!isPromptGenerationArtifact(artifact)) return [];
  const config: PromptGenerationContract = contract.prompt_generation ?? {};
  const failures: string[] = [];
  const inputNames = inputMetadataNames(artifact);
  for (const name of config.required_input_metadata ?? []) {
    if (!inputNames.has(name)) failures.push(`${label}: missing input metadata ${name}`);
  }
  for (const path of config.required_top_level_metadata ?? []) {
    if (!hasTopLevelMetadata(artifact, path)) failures.push(`${label}: missing top-level metadata ${path}`);
  }
  const validation = dict(artifact.validation);
  const checksRun = new Set(strings(validation.checks_run));
  for (const check of config.required_validation_checks ?? []) {
    if (!checksRun.has(check)) failures.push(`${label}: metadata validation check was not run: ${check}`);
  }
  const renderedPrompt = typeof artifact.rendered_prompt === 'string' ? artifact.rendered_prompt : '';
  for (const text of config.required_rendered_substrings ?? []) {
    if (!renderedPrompt.includes(text)) failures.push(`${label}: rendered prompt metadata is missing ${text}`);
  }
  const humanReview = config.human_review ?? {};
  if (artifact.requires_human_review === true) {
    const reason = typeof artifact.review_reason === 'string' ? artifact.review_reason : '';
    const prefix = humanReview.true_reason_prefix ?? 'Human review required:';
    if (!reason.startsWith(prefix)) failures.push(`${label}: human review reason must start with ${prefix}`);
  }
  if (artifact.requires_human_review === false && humanReview.false_reason_must_be_null === true && artifact.review_reason !== null) {
    failures.push(`${label}: review_reason must be null when human review is not required`);
  }
  return failures;
}

function shouldPass(caseFile: string): boolean {
  const data = load<CaseFile | null>(caseFile);
  return data?.expected?.validation?.should_pass !== false;
}

function checkGeneratedArtifacts(contract: Contract): { checked: number; failures: string[] } {
  const failures: string[] = [];
  let checked = 0;
  for (const caseFile of walk(PROMPT_CASES)) {
    if (!shouldPass(caseFile)) continue;
    try {
      const artifact = generateArtifact({ case: caseFile, mode: 'ci' }).artifact as unknown as Dict;
      failures.push(...checkArtifact(caseFile, artifact, contract));
      checked += 1;
    } catch (error) {
      failures.push(`${caseFile}: generation failed: ${(error as Error).message}`);
    }
  }
  return { checked, failures };
}

function checkFixtureDirectory(contract: Contract, dir: string, expectPass: boolean): { checked: number; failures: string[] } {
  const failures: string[] = [];
  let checked = 0;
  for (const file of walk(dir)) {
    checked += 1;
    const errors = checkArtifact(file, load<Dict>(file), contract);
    if (expectPass && errors.length > 0) failures.push(...errors);
    if (!expectPass && errors.length === 0) failures.push(`${file}: expected artifact metadata fixture to fail, but it passed`);
  }
  return { checked, failures };
}

const contract = load<Contract>(CONTRACT_PATH);
const failures: string[] = [];
if (contract.artifact_metadata_contract_id !== 'artifact_metadata_contract_v1') failures.push(`${CONTRACT_PATH}: unexpected contract id`);
const generated = checkGeneratedArtifacts(contract);
const valid = checkFixtureDirectory(contract, VALID_FIXTURES, true);
const invalid = checkFixtureDirectory(contract, INVALID_FIXTURES, false);
failures.push(...generated.failures, ...valid.failures, ...invalid.failures);
if (failures.length > 0) {
  console.error(`PEaC artifact metadata check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC artifact metadata check passed for ${generated.checked} generated artifact(s), ${valid.checked} valid fixture(s), and ${invalid.checked} invalid fixture(s).`);
