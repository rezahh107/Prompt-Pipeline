#!/usr/bin/env tsx
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact, loadConfig } from '../src/peac.js';

interface RubricCheck {
  id: string;
  domain?: string;
  subtype?: string;
  required_substrings?: string[];
  forbidden_substrings?: string[];
}

interface RubricFile {
  rubric_id: string;
  checks: RubricCheck[];
}

function walkCases(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkCases(path));
    if (entry.isFile() && path.replaceAll('\\', '/').includes('/cases/') && path.endsWith('.yaml')) result.push(path);
  }
  return result;
}

function loadRubrics(): RubricFile[] {
  try {
    return readdirSync('evals')
      .filter((file) => file.endsWith('.yaml'))
      .sort()
      .map((file) => yaml.load(readFileSync(join('evals', file), 'utf8')) as RubricFile);
  } catch {
    return [];
  }
}

const config = loadConfig();
const rubrics = loadRubrics();
if (rubrics.length === 0) {
  console.log('No PEaC rubrics found. Add evals/*.yaml to enable local rubric checks.');
  process.exit(0);
}

const failures: string[] = [];
let checksRun = 0;
for (const caseFile of walkCases(config.domains_path)) {
  let artifact;
  try {
    artifact = generateArtifact({ case: caseFile, mode: 'ci' }).artifact;
  } catch {
    continue;
  }

  for (const rubric of rubrics) {
    for (const check of rubric.checks ?? []) {
      if (check.domain && check.domain !== artifact.domain) continue;
      if (check.subtype && check.subtype !== artifact.subtype) continue;
      checksRun += 1;
      for (const needle of check.required_substrings ?? []) {
        if (!artifact.rendered_prompt.includes(needle)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} missing ${needle}`);
      }
      for (const needle of check.forbidden_substrings ?? []) {
        if (artifact.rendered_prompt.includes(needle)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} contains forbidden ${needle}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`PEaC rubric evaluation failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PEaC rubric evaluation passed with ${rubrics.length} rubric file(s) and ${checksRun} check application(s).`);
