import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateConditionForTest, readYamlFile, type Dict, type PEaCConfig } from './peac.js';

export interface CanonicalSubtypeDefinition {
  id?: string;
  description?: string;
  triggers?: string[];
  is_default?: boolean;
  templates?: { primary?: string };
}

export interface CanonicalDomainRoute {
  domain?: string;
  version?: string;
  subtypes?: CanonicalSubtypeDefinition[];
}

export interface CanonicalSubtypeSelection {
  subtype: string;
  method: 'requested' | 'trigger' | 'default';
  matched_subtypes: string[];
}

export interface CanonicalSubtypeResolution extends CanonicalSubtypeSelection {
  route_path: string;
  template_path: string;
}

function normalizedId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function subtypeInventory(route: CanonicalDomainRoute): CanonicalSubtypeDefinition[] {
  const subtypes = route.subtypes ?? [];
  if (subtypes.length === 0) throw new Error('Domain route must declare at least one Subtype.');
  const ids = subtypes.map((subtype) => normalizedId(subtype.id));
  if (ids.some((id) => id === '')) throw new Error('Every Domain Subtype must have a non-empty id.');
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Duplicate Domain Subtype id: ${[...new Set(duplicates)].join(', ')}`);
  const defaults = subtypes.filter((subtype) => subtype.is_default === true);
  if (defaults.length > 1) throw new Error(`Multiple explicit default Subtypes: ${defaults.map((item) => item.id).join(', ')}`);
  return subtypes;
}

function matchesTriggers(subtype: CanonicalSubtypeDefinition, inputs: Dict): boolean {
  const triggers = (subtype.triggers ?? []).map(String).map((value) => value.trim()).filter(Boolean);
  if (triggers.length === 0) return false;
  try {
    return triggers.every((condition) => evaluateConditionForTest(condition, inputs));
  } catch (error) {
    throw new Error(`Subtype ${String(subtype.id)} trigger evaluation failed: ${(error as Error).message}`);
  }
}

export function resolveSubtypeDefinitionForTest(
  route: CanonicalDomainRoute,
  inputs: Dict,
  requested?: string | null,
): CanonicalSubtypeSelection {
  const subtypes = subtypeInventory(route);
  const requestedId = normalizedId(requested);
  if (requestedId) {
    const selected = subtypes.find((subtype) => subtype.id === requestedId);
    if (!selected) throw new Error(`Requested Subtype does not exist: ${requestedId}`);
    return { subtype: requestedId, method: 'requested', matched_subtypes: [requestedId] };
  }

  const matches = subtypes.filter((subtype) => matchesTriggers(subtype, inputs));
  if (matches.length > 1) throw new Error(`Multiple matching Subtypes: ${matches.map((item) => item.id).join(', ')}`);
  if (matches.length === 1) {
    const subtype = normalizedId(matches[0]?.id);
    return { subtype, method: 'trigger', matched_subtypes: [subtype] };
  }

  const defaults = subtypes.filter((subtype) => subtype.is_default === true);
  if (defaults.length !== 1) throw new Error('No Subtype matched and exactly one explicit default Subtype was not available.');
  const subtype = normalizedId(defaults[0]?.id);
  return { subtype, method: 'default', matched_subtypes: [] };
}

export function templatePathForResolvedSubtype(
  config: PEaCConfig,
  domain: string,
  subtype: string,
): string {
  const routePath = join(config.domains_path, domain, 'route.yaml');
  if (!existsSync(routePath)) throw new Error(`Missing Domain route: ${routePath}`);
  const route = readYamlFile<CanonicalDomainRoute>(routePath) ?? {};
  const subtypes = subtypeInventory(route);
  const definition = subtypes.find((item) => item.id === subtype);
  if (!definition) throw new Error(`Resolved Subtype does not exist in route: ${domain}.${subtype}`);
  const template = normalizedId(definition.templates?.primary);
  if (!template) throw new Error(`Resolved Subtype has no primary template: ${domain}.${subtype}`);
  const templatePath = join(config.domains_path, domain, 'templates', template);
  if (!existsSync(templatePath)) throw new Error(`Resolved Subtype template does not exist: ${templatePath}`);
  return templatePath;
}

export function resolveCanonicalSubtype(
  config: PEaCConfig,
  domain: string,
  inputs: Dict,
  requested?: string | null,
): CanonicalSubtypeResolution {
  const routePath = join(config.domains_path, domain, 'route.yaml');
  if (!existsSync(routePath)) throw new Error(`Missing Domain route: ${routePath}`);
  const route = readYamlFile<CanonicalDomainRoute>(routePath) ?? {};
  const selection = resolveSubtypeDefinitionForTest(route, inputs, requested);
  return {
    ...selection,
    route_path: routePath,
    template_path: templatePathForResolvedSubtype(config, domain, selection.subtype),
  };
}
