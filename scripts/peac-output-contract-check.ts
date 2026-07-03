#!/usr/bin/env tsx
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact, loadConfig } from '../src/peac.js';

interface OutputContractsFile {
  output_contracts?: {
    rendered_prompt?: {
      required_sections?: string[];
      recommended_sections?: string[];
    };
  };
}

interface CaseFile {
  expected?: {
    validation?: {
      should_pass?: boolean;
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

function hasSectionHeading(content: string, section: string): boolean {
  const marker = sectionMarker(section);
  return content.split(/\r?\n/).some((line) => line.trim() === marker);
}

function caseShouldPass(caseFile: string): boolean {
  const data = yaml.load(readFileSync(caseFile, 'utf8')) as CaseFile | null;
  return data?.expected?.validation?.should_pass !== false;
}

const config = loadConfig();
const outputContractsPath = join(config.pipeline_path, 'output-contracts.yaml');
const contracts = yaml.load(readFileSync(outputContractsPath, 'utf8')) as OutputContractsFile | null;
const requiredSections = contracts?.output_contracts?.rendered_prompt?.required_sections ?? [];
if (requiredSections.length === 0) {
  throw new Error(`No rendered_prompt.required_sections declared in ${outputContractsPath}`);
}

const failures: string[] = [];
let checked = 0;
let skipped = 0;
for (const caseFile of walkCases(config.domains_path)) {
  if (!caseShouldPass(caseFile)) {
    skipped += 1;
    continue;
  }

  let renderedPrompt = '';
  let templateSource = '';
  let templatePath = '';
  try {
    const artifact = generateArtifact({ case: caseFile, mode: 'ci' }).artifact;
    renderedPrompt = artifact.rendered_prompt;
    templatePath = artifact.provenance.template_used;
    templateSource = readFileSync(templatePath, 'utf8');
  } catch (error) {
    failures.push(`${caseFile}: artifact generation failed before output contract check: ${(error as Error).message}`);
    continue;
  }

  checked += 1;
  for (const section of requiredSections) {
    const marker = sectionMarker(section);
    if (!hasSectionHeading(templateSource, section)) failures.push(`${caseFile}: template ${templatePath} is missing required output section heading ${marker}`);
    if (!hasSectionHeading(renderedPrompt, section)) failures.push(`${caseFile}: rendered artifact is missing required output section heading ${marker}`);
  }
}

if (failures.length > 0) {
  console.error(`PEaC output contract check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PEaC output contract check passed for ${checked} case artifact(s), skipped ${skipped} expected failing fixture(s).`);
