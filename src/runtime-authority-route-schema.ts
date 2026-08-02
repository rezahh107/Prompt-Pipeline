import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { evaluateConditionForTest, loadConfig, readYamlFile, type PEaCConfig } from './peac.js';
import type { ContractField, DomainContract } from './runtime-authority-foundation.js';
import type { CanonicalDomainRoute, CanonicalSubtypeDefinition } from './runtime-authority-subtype.js';

export interface RouteSchemaDiagnostic {
  domain: string;
  route_path: string;
  code: string;
  message: string;
}

export interface RouteSchemaValidationResult {
  domains_checked: number;
  subtypes_checked: number;
  diagnostics: RouteSchemaDiagnostic[];
}

const EXPRESSION_LITERALS = new Set(['true', 'false', 'null', 'undefined']);

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function contractFieldNames(contract: DomainContract): Set<string> {
  const groups: ContractField[][] = [
    contract.fields?.required ?? [],
    contract.fields?.optional ?? [],
    contract.fields?.inferred ?? [],
  ];
  return new Set(groups.flat().map((field) => normalized(field.name)).filter(Boolean));
}

function triggerFields(expression: string): string[] {
  const withoutStrings = expression
    .replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`/g, ' ')
    .replace(/\.length\b/g, ' ');
  const identifiers = withoutStrings.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  return [...new Set(identifiers.filter((identifier) => !EXPRESSION_LITERALS.has(identifier)))].sort();
}

function add(
  diagnostics: RouteSchemaDiagnostic[],
  domain: string,
  routePath: string,
  code: string,
  message: string,
): void {
  diagnostics.push({ domain, route_path: routePath, code, message });
}

function subtypeTriggers(
  subtype: CanonicalSubtypeDefinition,
  diagnostics: RouteSchemaDiagnostic[],
  domain: string,
  routePath: string,
): string[] {
  if (subtype.triggers === undefined) return [];
  if (!Array.isArray(subtype.triggers)) {
    add(diagnostics, domain, routePath, 'ROUTE_TRIGGER_TYPE', `Subtype ${String(subtype.id)} triggers must be an array.`);
    return [];
  }
  const triggers = subtype.triggers.map(String).map((value) => value.trim()).filter(Boolean);
  if (triggers.length !== subtype.triggers.length || triggers.length === 0) {
    add(diagnostics, domain, routePath, 'ROUTE_EMPTY_TRIGGER', `Subtype ${String(subtype.id)} declares an empty trigger list or expression.`);
  }
  return triggers;
}

export function validateActiveDomainRoutes(configOverride?: PEaCConfig): RouteSchemaValidationResult {
  const config = configOverride ?? loadConfig();
  const diagnostics: RouteSchemaDiagnostic[] = [];
  let domainsChecked = 0;
  let subtypesChecked = 0;

  const domainDirectories = readdirSync(config.domains_path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directory of domainDirectories) {
    const routePath = join(config.domains_path, directory, 'route.yaml');
    if (!existsSync(routePath)) continue;
    domainsChecked += 1;
    const contractPath = join(config.domains_path, directory, 'input.contract.yaml');
    const route = readYamlFile<CanonicalDomainRoute>(routePath) ?? {};
    const routeDomain = normalized(route.domain) || directory;

    if (routeDomain !== directory) {
      add(diagnostics, directory, routePath, 'ROUTE_DOMAIN_MISMATCH', `Route declares Domain ${routeDomain}; directory is ${directory}.`);
    }
    if (!existsSync(contractPath)) {
      add(diagnostics, directory, routePath, 'ROUTE_CONTRACT_MISSING', `Missing Domain contract: ${contractPath}`);
      continue;
    }

    const contract = readYamlFile<DomainContract>(contractPath) ?? {};
    const knownFields = contractFieldNames(contract);
    knownFields.add('domain');
    knownFields.add('subtype');
    const subtypes = route.subtypes ?? [];

    if (!Array.isArray(route.subtypes) || subtypes.length === 0) {
      add(diagnostics, directory, routePath, 'ROUTE_SUBTYPES_MISSING', 'Route must declare at least one Subtype.');
      continue;
    }

    subtypesChecked += subtypes.length;
    const ids = subtypes.map((subtype) => normalized(subtype.id));
    const duplicateIds = ids.filter((id, index) => id && ids.indexOf(id) !== index);
    if (ids.some((id) => !id)) add(diagnostics, directory, routePath, 'ROUTE_SUBTYPE_ID_EMPTY', 'Every Subtype must have a non-empty id.');
    if (duplicateIds.length > 0) {
      add(diagnostics, directory, routePath, 'ROUTE_SUBTYPE_ID_DUPLICATE', `Duplicate Subtype id(s): ${[...new Set(duplicateIds)].join(', ')}.`);
    }

    const defaults = subtypes.filter((subtype) => subtype.is_default === true);
    if (defaults.length > 1) {
      add(diagnostics, directory, routePath, 'ROUTE_MULTIPLE_DEFAULTS', `At most one explicit default is allowed; found ${defaults.length}.`);
    }

    for (const subtype of subtypes) {
      const subtypeId = normalized(subtype.id) || '<missing>';
      const triggers = subtypeTriggers(subtype, diagnostics, directory, routePath);
      if (triggers.length === 0 && subtype.is_default !== true) {
        add(diagnostics, directory, routePath, 'ROUTE_UNSELECTABLE_SUBTYPE', `Subtype ${subtypeId} must declare non-empty triggers or be the explicit default.`);
      }

      for (const trigger of triggers) {
        try {
          evaluateConditionForTest(trigger, {});
        } catch (error) {
          add(diagnostics, directory, routePath, 'ROUTE_TRIGGER_SYNTAX', `Subtype ${subtypeId} trigger is invalid: ${(error as Error).message}`);
        }
        for (const field of triggerFields(trigger)) {
          if (!knownFields.has(field)) {
            add(diagnostics, directory, routePath, 'ROUTE_TRIGGER_UNKNOWN_FIELD', `Subtype ${subtypeId} trigger references unknown contract field: ${field}.`);
          }
        }
      }

      const declaredTemplate = normalized(subtype.templates?.primary);
      const templateName = declaredTemplate || `${subtypeId}.j2`;
      const templatePath = join(config.domains_path, directory, 'templates', templateName);
      if (!existsSync(templatePath)) {
        add(
          diagnostics,
          directory,
          routePath,
          'ROUTE_TEMPLATE_MISSING',
          `Subtype ${subtypeId} resolves to missing template ${relative(config.domains_path, templatePath)}.`,
        );
      }
    }
  }

  return {
    domains_checked: domainsChecked,
    subtypes_checked: subtypesChecked,
    diagnostics,
  };
}
