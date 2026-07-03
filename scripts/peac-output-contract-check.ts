#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { generateArtifact, loadConfig } from '../src/peac.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

interface OutputContractsFile {
  output_contracts?: {
    rendered_prompt?: {
      required_sections?: string[];
      recommended_sections?: string[];
    };
  };
}

function walkCases(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkCases(path));
    if (entry.isFile() && path.replaceAll('\\', '/').includes('/cases/') && path.endsWith('.yaml')) result.push(path);
  }
  return result.sort();
}

function sectionMarker(section: string): string {
  return `[${section}]`;
}

const config = loadConfig();
const contracts = yaml.load(readFileSync('pipeline/output-contracts.yaml', 'utf8')) as OutputContractsFile | null;
const requiredSections = contracts?.output_contracts?.rendered_prompt?.required_sections ?? [];
if (requiredSections.length === 0) {
  throw new Error('No rendered_prompt.required_sections declared in pipeline/output-contracts.yaml');
}

const failures: string[] = [];
let checked = 0;
for (const caseFile of walkCases(config.domains_path)) {
  let renderedPrompt = '';
  try {
    renderedPrompt = generateArtifact({ case: caseFile, mode: 'ci' }).artifact.rendered_prompt;
  } catch (error) {
    failures.push(`${caseFile}: artifact generation failed before output contract check: ${(error as Error).message}`);
    continue;
  }

  checked += 1;
  for (const section of requiredSections) {
    const marker = sectionMarker(section);
    if (!renderedPrompt.includes(marker)) failures.push(`${caseFile}: missing required output section ${marker}`);
  }
}

if (failures.length > 0) {
  console.error(`PEaC output contract check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PEaC output contract check passed for ${checked} case artifact(s).`);
