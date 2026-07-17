import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export const PR_INSPECTOR_RETIRED_DOMAIN = 'pr_inspector_action';
export const PR_INSPECTOR_MIGRATION_ERROR_CODE = 'PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED';

export function assertActiveDomainAllowed(domain: unknown): void {
  if (String(domain ?? '') !== PR_INSPECTOR_RETIRED_DOMAIN) return;
  throw new Error(
    `${PR_INSPECTOR_MIGRATION_ERROR_CODE}: ${PR_INSPECTOR_RETIRED_DOMAIN} is historical-only and cannot be selected for active Prompt-Pipeline generation. ` +
    'Authoritative owner output must originate from a genuine VerifiedReviewCompletion consumed by official_owner_delivery.',
  );
}

export function assertCaseFileDomainAllowed(caseFile: unknown): void {
  if (typeof caseFile !== 'string' || caseFile.trim() === '') return;
  const loaded = yaml.load(readFileSync(caseFile, 'utf8')) as { domain?: unknown } | null | undefined;
  assertActiveDomainAllowed(loaded?.domain);
}
