#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import ts from 'typescript';
import {
  createValidatedIntakeEnvelope,
  generateArtifact,
  reviewArtifact,
  sha256Json,
  verifyArtifact,
  type RuntimeArtifactEnvelope,
  type ValidatedIntakeEnvelope,
} from '../src/runtime-authority-api.js';
import {
  assertBenignOperationPatternSpecInventory,
  BENIGN_OPERATION_PATTERN_SPECS,
} from '../src/runtime-authority-benign-operations.js';
import { loadConfig, type PEaCConfig } from '../src/peac.js';

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;

const root = mkdtempSync(join(tmpdir(), 'peac-v25-root-closure-'));
let sequence = 0;
let passed = 0;
const failures: string[] = [];

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(fn: () => void, contains?: string): string {
  let message = '';
  try { fn(); } catch (error) { message = (error as Error).message; }
  if (!message) throw new Error('expected an error');
  if (contains && !message.includes(contains)) throw new Error(`expected ${contains}, got ${message}`);
  return message;
}

function test(id: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${id}: ${(error as Error).message}`);
  }
}

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request: 'Write a short friendly greeting.',
    desired_output: 'short message',
    target_environment: 'ChatGPT',
    strictness: 'precise',
    sensitive_or_high_risk: false,
    uses_external_tools: false,
    legal_medical_financial: false,
    requires_current_information: false,
    exact_factual_claims: false,
    external_files: false,
    potential_downstream_execution: false,
    requested_actions: [],
    constraints: [],
    available_sources: [],
    context_items: [],
    domain_hint: null,
    ...overrides,
  };
}

function intake(overrides: Record<string, unknown> = {}, config?: PEaCConfig): ValidatedIntakeEnvelope {
  return createValidatedIntakeEnvelope(raw(overrides), 'api_request', config);
}

function configFor(label: string): PEaCConfig {
  const base = loadConfig();
  const outputs = join(root, `outputs-${++sequence}-${label}`);
  return { ...base, outputs_path: outputs, artifact: { ...base.artifact, output_dir: outputs } };
}

function generated(
  overrides: Record<string, unknown> = {},
  config = configFor('generated'),
): { artifact: RuntimeArtifactEnvelope; outputPath: string; config: PEaCConfig } {
  return { ...generateArtifact(intake(overrides, config), 'ci', config), config };
}

function clone(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  return yaml.load(yaml.dump(value, { lineWidth: 120, noRefs: true })) as RuntimeArtifactEnvelope;
}

function recompute(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  const result = clone(value);
  const artifact = result.artifact;
  const hashes = artifact.hashes as Record<string, unknown>;
  const intakeValue = artifact.canonical_intake as Record<string, unknown>;
  hashes.normalized_inputs_hash = sha256Json((intakeValue.normalized_inputs as Record<string, unknown> | undefined) ?? {});
  hashes.generation_plan_hash = sha256Json(artifact.generation_plan);
  hashes.validation_ledger_hash = sha256Json(((artifact.validation_ledger as Record<string, unknown>).checks as unknown[]) ?? []);
  hashes.derived_projection_hash = sha256Json(artifact.derived_projection);
  result.artifact_sha256 = sha256Json(artifact);
  const { envelope_sha256: _ignored, ...partial } = result;
  result.envelope_sha256 = sha256Json(partial);
  return result;
}

function writeEnvelope(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  return path;
}

function derived(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return value.artifact.derived_projection as Record<string, unknown>;
}

function risk(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return derived(value).risk as Record<string, unknown>;
}

function payload(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return risk(value).payload_assessment as Record<string, unknown>;
}

function assertNotLow(value: RuntimeArtifactEnvelope): void {
  expect(risk(value).classification !== 'low', 'unexpected Low classification');
  expect(risk(value).review_required === true, 'review was not required');
  expect(payload(value).provenBenign === false, 'payload was incorrectly proven benign');
  expect(value.authorization.authority_state !== 'authorized', 'unproven payload was authorized');
}

function unavailableEvidenceFixture(
  overrides: Record<string, unknown> = {},
): { artifact: RuntimeArtifactEnvelope; path: string; config: PEaCConfig } {
  const base = loadConfig();
  const sandbox = join(root, `unavailable-${++sequence}`);
  const pipeline = join(sandbox, 'pipeline');
  const domains = join(sandbox, 'domains');
  const policies = join(sandbox, 'policies');
  cpSync(base.pipeline_path, pipeline, { recursive: true });
  cpSync(base.domains_path, domains, { recursive: true });
  cpSync(base.policies_path, policies, { recursive: true });
  const outputs = join(sandbox, 'outputs');
  const config: PEaCConfig = {
    ...base,
    pipeline_path: pipeline,
    domains_path: domains,
    policies_path: policies,
    outputs_path: outputs,
    artifact: { ...base.artifact, output_dir: outputs },
  };
  const result = generateArtifact(intake(overrides, config), 'ci', config);
  rmSync(join(pipeline, 'artifact.schema.json'));
  return { artifact: result.artifact, path: result.outputPath, config };
}

// M-TOPIC-SHARED-OPERATION-MATCH

test('T-TOPIC-01', () => {
  for (const [request, desiredOutput] of [
    ['برای اخاذی چند نام پیشنهاد بده.', 'list of names'],
    ['یک شعر درباره تطمیع شاهدان بنویس.', 'poem'],
  ] as const) {
    const result = generated({ request, desired_output: desiredOutput });
    expect(payload(result.artifact).kind === 'inline_free_form', `${request}: payload kind=${String(payload(result.artifact).kind)}`);
    assertNotLow(result.artifact);
  }
});

test('T-TOPIC-02', () => {
  for (const [request, desiredOutput] of [
    ['چند نام پیشنهاد بده.', 'list of names'],
    ['یک شعر بنویس.', 'poem'],
  ] as const) {
    const result = generated({ request, desired_output: desiredOutput });
    expect(payload(result.artifact).kind === 'none', `${request}: payload kind=${String(payload(result.artifact).kind)}`);
    expect(payload(result.artifact).provenBenign === true, `${request}: no-topic request not proven benign`);
    expect(risk(result.artifact).classification === 'low', `${request}: not Low`);
    expect(result.artifact.authorization.authority_state === 'authorized', `${request}: not authorized`);
  }
});

test('T-TOPIC-03', () => {
  assertNotLow(generated({ request: 'Brainstorm names for blackmail.', desired_output: 'list of names' }).artifact);
  assertNotLow(generated({ request: 'Write a poem about coercing witnesses.', desired_output: 'poem' }).artifact);
  for (const [request, desiredOutput] of [
    ['Brainstorm project names.', 'list of names'],
    ['Write a poem.', 'poem'],
  ] as const) {
    const result = generated({ request, desired_output: desiredOutput });
    expect(payload(result.artifact).kind === 'none' && payload(result.artifact).provenBenign === true, `${request}: no-topic regression`);
  }
  const grammar = generated({
    request: 'Correct the grammar of this sentence: She go to school.',
    desired_output: 'corrected sentence',
  });
  expect(payload(grammar.artifact).kind === 'bounded_literal' && payload(grammar.artifact).provenBenign === true, 'bounded grammar regression');
});

test('T-TOPIC-04', () => {
  const incomplete = BENIGN_OPERATION_PATTERN_SPECS.map((spec, index) => index === 0
    ? { id: spec.id, operation: spec.operation, pattern: spec.pattern }
    : spec);
  expectThrows(() => assertBenignOperationPatternSpecInventory(incomplete), 'payload=short_greeting_en_direct');
});

// M-RISK-SHARED-COMPATIBILITY-PROJECTION

test('T-RISK-01', () => {
  const unavailable = unavailableEvidenceFixture({
    request: 'Create a reusable prompt explaining prescription medicine dosage.',
    desired_output: 'prompt',
    domain_hint: 'prompt_generation',
  });
  const mutations: Array<[string, (copy: RuntimeArtifactEnvelope) => void]> = [
    ['classification', (copy) => { risk(copy).classification = 'medium'; }],
    ['review_required', (copy) => { risk(copy).review_required = false; }],
    ['decision', (copy) => { risk(copy).decision = 'drifted decision'; }],
    ['legacyRiskLevel', (copy) => { derived(copy).legacyRiskLevel = 'low'; }],
    ['requiresHumanReview', (copy) => { derived(copy).requiresHumanReview = false; }],
    ['reviewReason', (copy) => { derived(copy).reviewReason = 'drifted reason'; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = clone(unavailable.artifact);
    mutate(copy);
    const result = verifyArtifact(writeEnvelope(`t-risk-01-${label}.yaml`, recompute(copy)), unavailable.config);
    expect(result.verification_status === 'rejected', `${label}: ${result.verification_status}; ${result.diagnostics.join('; ')}`);
    expect(result.diagnostics.some((item) => /Risk|risk|review/i.test(item)), `${label}: named source-independent contradiction missing`);
  }
});

test('T-RISK-02', () => {
  const unavailable = unavailableEvidenceFixture({
    request: 'Create a reusable prompt explaining prescription medicine dosage.',
    desired_output: 'prompt',
    domain_hint: 'prompt_generation',
  });
  const copy = clone(unavailable.artifact);
  const generationPlan = derived(copy).generationPlan as Record<string, unknown>;
  const generationPlanRisk = generationPlan.risk as Record<string, unknown>;
  generationPlanRisk.decision = 'generation-plan-only drift';
  const result = verifyArtifact(writeEnvelope('t-risk-02.yaml', recompute(copy)), unavailable.config);
  expect(result.verification_status === 'rejected', result.diagnostics.join('; '));
  expect(result.diagnostics.some((item) => item.includes('Generation Plan Risk mirror')), 'Generation Plan Risk contradiction missing');
});

test('T-RISK-03', () => {
  const unavailable = unavailableEvidenceFixture();
  const result = verifyArtifact(unavailable.path, unavailable.config);
  expect(result.verification_status === 'insufficient_evidence', result.diagnostics.join('; '));
});

test('T-RISK-04', () => {
  const valid = generated();
  expect(verifyArtifact(valid.outputPath, valid.config).verification_status === 'verified', 'valid Artifact did not verify');
  expectThrows(() => reviewArtifact(writeEnvelope('t-risk-04-rejected.yaml', {}), 'approved'), 'Cannot review');
  const insufficient = unavailableEvidenceFixture();
  expectThrows(() => reviewArtifact(insufficient.path, 'approved', [], insufficient.config), 'Cannot review');
});

// M-AUTH-FULL-SRC-AST-INVENTORY

const AUTHORITY_SYMBOLS = [
  'generateArtifact',
  'generateFromCliArgs',
  'verifyArtifact',
  'verifyArtifactForReviewInternal',
  'reviewArtifact',
  'completeRuntimeAssessmentInternal',
  'reduceVerificationOutcome',
] as const;
type AuthoritySymbolName = typeof AUTHORITY_SYMBOLS[number];

const EXPECTED_DEFINITION_OWNERS: Record<AuthoritySymbolName, readonly string[]> = {
  generateArtifact: ['src/peac.ts', 'src/runtime-authority-canonical-artifact.ts'],
  generateFromCliArgs: ['src/runtime-authority-canonical-artifact.ts'],
  verifyArtifact: ['src/runtime-authority-verification-facts.ts'],
  verifyArtifactForReviewInternal: ['src/runtime-authority-verification-facts.ts'],
  reviewArtifact: ['src/runtime-authority-api.ts'],
  completeRuntimeAssessmentInternal: ['src/runtime-authority-execution.ts'],
  reduceVerificationOutcome: ['src/runtime-authority-verification-facts.ts'],
};

const ALLOWED_EXPORT_SURFACES: Record<AuthoritySymbolName, readonly string[]> = {
  generateArtifact: [
    'src/peac.ts',
    'src/runtime-authority-canonical-artifact.ts',
    'src/runtime-authority.ts',
    'src/runtime-authority-api.ts',
  ],
  generateFromCliArgs: [
    'src/runtime-authority-canonical-artifact.ts',
    'src/runtime-authority.ts',
    'src/runtime-authority-api.ts',
  ],
  verifyArtifact: [
    'src/runtime-authority-verification-facts.ts',
    'src/runtime-authority.ts',
    'src/runtime-authority-api.ts',
  ],
  verifyArtifactForReviewInternal: ['src/runtime-authority-verification-facts.ts'],
  reviewArtifact: ['src/runtime-authority-api.ts'],
  completeRuntimeAssessmentInternal: ['src/runtime-authority-execution.ts'],
  reduceVerificationOutcome: [],
};

type AuthorityExportAliases = Map<string, Set<string>>;
type AuthorityIdentityOwners = Map<AuthoritySymbolName, Set<string>>;

interface AuthorityInventory {
  definitions: Map<AuthoritySymbolName, Set<string>>;
  exports: Map<AuthoritySymbolName, Map<string, AuthorityExportAliases>>;
}

function repoPath(path: string): string {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

function authorityName(value: string): AuthoritySymbolName | null {
  return (AUTHORITY_SYMBOLS as readonly string[]).includes(value) ? value as AuthoritySymbolName : null;
}

function authorityProgram(): ts.Program {
  const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
  const rootNames = parsed.fileNames.filter((path) => repoPath(path).startsWith('src/') && path.endsWith('.ts'));
  return ts.createProgram({ rootNames, options: parsed.options });
}

function resolvedSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    current = checker.getAliasedSymbol(current);
  }
  return current;
}

function symbolOwnerPaths(symbol: ts.Symbol): Set<string> {
  return new Set(
    (symbol.declarations ?? [])
      .map((declaration) => repoPath(declaration.getSourceFile().fileName))
      .filter((path) => path.startsWith('src/')),
  );
}

function unwrapIdentityExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function identityReferenceSymbol(checker: ts.TypeChecker, expression: ts.Expression): ts.Symbol | null {
  const current = unwrapIdentityExpression(expression);
  if (ts.isIdentifier(current)) return checker.getSymbolAtLocation(current) ?? null;
  if (ts.isPropertyAccessExpression(current)) {
    return checker.getSymbolAtLocation(current.name) ?? checker.getSymbolAtLocation(current) ?? null;
  }
  return null;
}

function externalReferenceDeclaration(
  declaration: ts.Declaration,
): { importedName: string; moduleSpecifier: ts.Expression } | null {
  if (ts.isImportSpecifier(declaration)) {
    const importDeclaration = declaration.parent.parent.parent;
    if (!ts.isImportDeclaration(importDeclaration)) return null;
    return {
      importedName: (declaration.propertyName ?? declaration.name).text,
      moduleSpecifier: importDeclaration.moduleSpecifier,
    };
  }
  if (ts.isExportSpecifier(declaration)) {
    const exportDeclaration = declaration.parent.parent;
    if (!ts.isExportDeclaration(exportDeclaration) || !exportDeclaration.moduleSpecifier) return null;
    return {
      importedName: (declaration.propertyName ?? declaration.name).text,
      moduleSpecifier: exportDeclaration.moduleSpecifier,
    };
  }
  return null;
}

function moduleLocalDeclarationSymbol(
  checker: ts.TypeChecker,
  moduleSpecifier: ts.Expression,
  name: string,
): ts.Symbol | null {
  const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
  for (const declaration of moduleSymbol?.declarations ?? []) {
    if (!ts.isSourceFile(declaration)) continue;
    let found: ts.Symbol | null = null;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        found = checker.getSymbolAtLocation(node.name) ?? null;
        return;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        found = checker.getSymbolAtLocation(node.name) ?? null;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration);
    if (found) return found;
  }
  return null;
}

function declarationBackedTarget(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  const target = resolvedSymbol(checker, symbol);
  if (symbolOwnerPaths(target).size > 0) return target;
  for (const declaration of symbol.declarations ?? []) {
    const reference = externalReferenceDeclaration(declaration);
    if (!reference) continue;
    const local = moduleLocalDeclarationSymbol(checker, reference.moduleSpecifier, reference.importedName);
    if (local) return resolvedSymbol(checker, local);
  }
  return target;
}

function exportAuthorityIdentities(checker: ts.TypeChecker, exported: ts.Symbol): AuthorityIdentityOwners {
  const identities: AuthorityIdentityOwners = new Map();
  const visited = new Set<ts.Symbol>();

  const record = (value: string | undefined, ownerSymbol: ts.Symbol): void => {
    if (!value) return;
    const identity = authorityName(value);
    if (!identity) return;
    const owners = identities.get(identity) ?? new Set<string>();
    for (const owner of symbolOwnerPaths(resolvedSymbol(checker, ownerSymbol))) owners.add(owner);
    identities.set(identity, owners);
  };

  const inspect = (symbol: ts.Symbol): void => {
    const target = declarationBackedTarget(checker, symbol);
    if (visited.has(target)) return;
    visited.add(target);

    record(symbol.getName(), target);
    record(target.getName(), target);

    for (const declaration of symbol.declarations ?? []) {
      if (ts.isExportSpecifier(declaration)) {
        record((declaration.propertyName ?? declaration.name).text, target);
      }
    }

    for (const declaration of target.declarations ?? []) {
      if (ts.isFunctionDeclaration(declaration) && declaration.name) {
        record(declaration.name.text, target);
      }
      if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
        record(declaration.name.text, target);
        if (declaration.initializer) {
          const referenced = identityReferenceSymbol(checker, declaration.initializer);
          if (referenced) inspect(referenced);
        }
      }
    }
  };

  const target = declarationBackedTarget(checker, exported);
  record(exported.getName(), target);
  for (const declaration of exported.declarations ?? []) {
    if (ts.isExportSpecifier(declaration)) {
      record((declaration.propertyName ?? declaration.name).text, target);
    }
  }
  inspect(exported);
  return identities;
}

function recordAuthorityExport(
  exports: AuthorityInventory['exports'],
  identity: AuthoritySymbolName,
  modulePath: string,
  outwardName: string,
  ownerPaths: Iterable<string>,
): void {
  const byModule = exports.get(identity)!;
  const aliases = byModule.get(modulePath) ?? new Map<string, Set<string>>();
  const owners = aliases.get(outwardName) ?? new Set<string>();
  for (const owner of ownerPaths) owners.add(owner);
  aliases.set(outwardName, owners);
  byModule.set(modulePath, aliases);
}

function collectAuthorityInventory(): AuthorityInventory {
  const program = authorityProgram();
  const checker = program.getTypeChecker();
  const definitions = new Map<AuthoritySymbolName, Set<string>>();
  const exports = new Map<AuthoritySymbolName, Map<string, AuthorityExportAliases>>();
  for (const name of AUTHORITY_SYMBOLS) {
    definitions.set(name, new Set());
    exports.set(name, new Map());
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || !repoPath(sourceFile.fileName).startsWith('src/')) continue;
    const modulePath = repoPath(sourceFile.fileName);
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = authorityName(node.name.text);
        if (name) definitions.get(name)!.add(modulePath);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const name = authorityName(node.name.text);
        if (name) definitions.get(name)!.add(modulePath);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const outwardName = exported.getName();
      for (const [identity, ownerPaths] of exportAuthorityIdentities(checker, exported)) {
        recordAuthorityExport(exports, identity, modulePath, outwardName, ownerPaths);
      }
    }
  }
  return { definitions, exports };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function authorityExportOwners(
  inventory: AuthorityInventory,
  identity: AuthoritySymbolName,
  modulePath: string,
): Set<string> {
  const owners = new Set<string>();
  for (const ownerPaths of inventory.exports.get(identity)?.get(modulePath)?.values() ?? []) {
    for (const owner of ownerPaths) owners.add(owner);
  }
  return owners;
}

function assertAuthorityInventory(): AuthorityInventory {
  const inventory = collectAuthorityInventory();
  for (const name of AUTHORITY_SYMBOLS) {
    const definitions = sorted(inventory.definitions.get(name)!);
    const expectedDefinitions = [...EXPECTED_DEFINITION_OWNERS[name]].sort();
    if (JSON.stringify(definitions) !== JSON.stringify(expectedDefinitions)) {
      throw new Error(`${name}: definition owners=${definitions.join(',') || 'none'}; expected=${expectedDefinitions.join(',')}`);
    }

    const allowedSurfaces = new Set(ALLOWED_EXPORT_SURFACES[name]);
    for (const [modulePath, aliases] of inventory.exports.get(name)!) {
      for (const [outwardName, ownerPaths] of aliases) {
        if (!allowedSurfaces.has(modulePath) || outwardName !== name) {
          throw new Error(
            `${name}: outward export=${outwardName}; exporting module=${modulePath}; resolved owners=${sorted(ownerPaths).join(',') || 'none'}; unauthorized authority export`,
          );
        }
      }
    }

    const surfaces = sorted(inventory.exports.get(name)!.keys());
    const expectedSurfaces = [...ALLOWED_EXPORT_SURFACES[name]].sort();
    if (JSON.stringify(surfaces) !== JSON.stringify(expectedSurfaces)) {
      throw new Error(`${name}: export surfaces=${surfaces.join(',') || 'none'}; expected=${expectedSurfaces.join(',') || 'none'}`);
    }
  }

  for (const barrel of ['src/runtime-authority.ts', 'src/runtime-authority-api.ts']) {
    const canonicalOwner = authorityExportOwners(inventory, 'generateArtifact', barrel);
    expect(canonicalOwner.has('src/runtime-authority-canonical-artifact.ts'), `generateArtifact: ${barrel} does not resolve to canonical owner`);
    expect(!canonicalOwner.has('src/peac.ts'), `generateArtifact: ${barrel} resolves to renderer exception`);
  }
  return inventory;
}

function withSyntheticSource(name: string, source: string, fn: () => void): void {
  const path = join(process.cwd(), 'src', `.authority-${process.pid}-${++sequence}-${name}.ts`);
  writeFileSync(path, source);
  try { fn(); } finally { rmSync(path, { force: true }); }
}

function expectAliasFailure(
  label: string,
  source: string,
  identity: AuthoritySymbolName,
  outwardName: string,
  terminalOwner?: string,
): void {
  withSyntheticSource(label, source, () => {
    const message = expectThrows(() => assertAuthorityInventory(), identity);
    expect(message.includes(`outward export=${outwardName}`), `${label}: outward alias missing from diagnostic: ${message}`);
    expect(message.includes(`.authority-${process.pid}-`), `${label}: exporting module missing from diagnostic: ${message}`);
    if (terminalOwner) {
      expect(message.includes(terminalOwner), `${label}: terminal owner missing from diagnostic: ${message}`);
    }
  });
}

test('T-AUTH-01', () => {
  assertAuthorityInventory();
});

test('T-AUTH-02', () => {
  const cases: Array<[string, AuthoritySymbolName, string]> = [
    ['exported-const', 'verifyArtifact', 'export const verifyArtifact = () => ({})'],
    ['alias', 'reviewArtifact', 'const local = () => ({}); export { local as reviewArtifact };'],
    ['named-reexport', 'verifyArtifact', "export { verifyArtifact } from './runtime-authority-verification-facts.js';"],
    ['export-star', 'verifyArtifact', "export * from './runtime-authority-verification-facts.js';"],
    ['duplicate-owner', 'completeRuntimeAssessmentInternal', 'function completeRuntimeAssessmentInternal() {}'],
  ];
  for (const [label, symbol, source] of cases) {
    withSyntheticSource(label, source, () => {
      const message = expectThrows(() => assertAuthorityInventory(), symbol);
      expect(message.includes(`.authority-${process.pid}-`), `${label}: exact synthetic module missing from diagnostic: ${message}`);
    });
  }
});

test('T-AUTH-03', () => {
  const fixture = join(process.cwd(), 'scripts', `.authority-barrel-${process.pid}-${++sequence}.type-test.ts`);
  writeFileSync(fixture, [
    "import { generateArtifact, verifyArtifact, reviewArtifact } from '../src/runtime-authority-api.js';",
    '// @ts-expect-error internal reducer is not an official API export',
    "import { reduceVerificationOutcome } from '../src/runtime-authority-api.js';",
    '// @ts-expect-error review capability is not an official API export',
    "import { verifyArtifactForReviewInternal } from '../src/runtime-authority-api.js';",
    '// @ts-expect-error completion reducer is not an official API export',
    "import { completeRuntimeAssessmentInternal } from '../src/runtime-authority-api.js';",
    'void [generateArtifact, verifyArtifact, reviewArtifact, reduceVerificationOutcome, verifyArtifactForReviewInternal, completeRuntimeAssessmentInternal];',
  ].join('\n'));
  try {
    execFileSync(process.execPath, [
      join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '--target', 'ES2022',
      '--module', 'ESNext',
      '--moduleResolution', 'Bundler',
      '--strict',
      '--skipLibCheck',
      '--esModuleInterop',
      '--resolveJsonModule',
      fixture,
    ], { cwd: process.cwd(), stdio: 'pipe' });
  } finally {
    rmSync(fixture, { force: true });
  }
  assertAuthorityInventory();
});

test('T-AUTH-04', () => {
  const value = generated();
  expect(verifyArtifact(value.outputPath, value.config).verification_status === 'verified', 'official canonical generation/verification failed');
  const inventory = assertAuthorityInventory();
  const rendererSurfaces = inventory.exports.get('generateArtifact')!;
  expect(rendererSurfaces.has('src/peac.ts'), 'documented renderer exception missing');
  expect(!authorityExportOwners(inventory, 'generateArtifact', 'src/runtime-authority.ts').has('src/peac.ts'), 'renderer exception leaked through Runtime barrel');
  expect(!authorityExportOwners(inventory, 'generateArtifact', 'src/runtime-authority-api.ts').has('src/peac.ts'), 'renderer exception leaked through API barrel');
});

// M-AUTH-RESOLVED-TARGET-IDENTITY

test('T-ALIAS-01', () => {
  expectAliasFailure(
    'hidden-reducer-alias',
    "export { reduceVerificationOutcome as publicReducer } from './runtime-authority-verification-facts.js';",
    'reduceVerificationOutcome',
    'publicReducer',
    'src/runtime-authority-verification-facts.ts',
  );
});

test('T-ALIAS-02', () => {
  expectAliasFailure(
    'hidden-review-capability-alias',
    "export { verifyArtifactForReviewInternal as reviewVerifier } from './runtime-authority-verification-facts.js';",
    'verifyArtifactForReviewInternal',
    'reviewVerifier',
  );
});

test('T-ALIAS-03', () => {
  expectAliasFailure(
    'alternate-generator-alias',
    "export { generateArtifact as alternateGenerator } from './runtime-authority-canonical-artifact.js';",
    'generateArtifact',
    'alternateGenerator',
  );
});

test('T-ALIAS-04', () => {
  const cases: Array<[string, AuthoritySymbolName, string]> = [
    ['exported-const-regression', 'verifyArtifact', 'export const verifyArtifact = () => ({})'],
    ['outward-authority-alias-regression', 'reviewArtifact', 'const local = () => ({}); export { local as reviewArtifact };'],
    ['named-reexport-regression', 'verifyArtifact', "export { verifyArtifact } from './runtime-authority-verification-facts.js';"],
    ['export-star-regression', 'verifyArtifact', "export * from './runtime-authority-verification-facts.js';"],
    ['duplicate-owner-regression', 'completeRuntimeAssessmentInternal', 'function completeRuntimeAssessmentInternal() {}'],
  ];
  for (const [label, identity, source] of cases) {
    withSyntheticSource(label, source, () => {
      const message = expectThrows(() => assertAuthorityInventory(), identity);
      expect(message.includes(`.authority-${process.pid}-`), `${label}: synthetic module missing from diagnostic: ${message}`);
    });
  }
});

test('T-ALIAS-05', () => {
  const inventory = assertAuthorityInventory();
  const value = generated();
  expect(verifyArtifact(value.outputPath, value.config).verification_status === 'verified', 'official generation/verification regression');
  for (const barrel of ['src/runtime-authority.ts', 'src/runtime-authority-api.ts']) {
    const owners = authorityExportOwners(inventory, 'generateArtifact', barrel);
    expect(owners.has('src/runtime-authority-canonical-artifact.ts'), `${barrel}: canonical generator owner missing`);
    expect(!owners.has('src/peac.ts'), `${barrel}: renderer exception resolved as official generator`);
  }
});

// M-AUTH-IDENTITY-PRESERVING-VALUE-FLOW

test('T-VALIAS-01', () => {
  expectAliasFailure(
    'direct-reducer-value-alias',
    [
      "import { reduceVerificationOutcome } from './runtime-authority-verification-facts.js';",
      'export const publicReducer = reduceVerificationOutcome;',
    ].join('\n'),
    'reduceVerificationOutcome',
    'publicReducer',
    'src/runtime-authority-verification-facts.ts',
  );
});

test('T-VALIAS-02', () => {
  expectAliasFailure(
    'local-review-capability-value-alias',
    [
      "import { verifyArtifactForReviewInternal } from './runtime-authority-verification-facts.js';",
      'const reviewVerifier = verifyArtifactForReviewInternal;',
      'export { reviewVerifier };',
    ].join('\n'),
    'verifyArtifactForReviewInternal',
    'reviewVerifier',
    'src/runtime-authority-verification-facts.ts',
  );
});

test('T-VALIAS-03', () => {
  expectAliasFailure(
    'multi-hop-generator-value-alias',
    [
      "import { generateArtifact as canonicalGenerator } from './runtime-authority-canonical-artifact.js';",
      'const first = canonicalGenerator;',
      'const second = (first as typeof first);',
      'export { second as alternateGenerator };',
    ].join('\n'),
    'generateArtifact',
    'alternateGenerator',
    'src/runtime-authority-canonical-artifact.ts',
  );

  const wrapperCases: Array<[string, string, string]> = [
    ['parenthesized', '(reduceVerificationOutcome)', 'parenthesizedReducer'],
    ['non-null', 'reduceVerificationOutcome!', 'nonNullReducer'],
    ['type-assertion', '<typeof reduceVerificationOutcome>reduceVerificationOutcome', 'assertedReducer'],
    ['satisfies', 'reduceVerificationOutcome satisfies typeof reduceVerificationOutcome', 'satisfiesReducer'],
  ];
  for (const [label, expression, outwardName] of wrapperCases) {
    expectAliasFailure(
      `transparent-${label}-value-alias`,
      [
        "import { reduceVerificationOutcome } from './runtime-authority-verification-facts.js';",
        `export const ${outwardName} = ${expression};`,
      ].join('\n'),
      'reduceVerificationOutcome',
      outwardName,
      'src/runtime-authority-verification-facts.ts',
    );
  }
});

test('T-VALIAS-04', () => {
  expectAliasFailure(
    'namespace-review-capability-value-alias',
    [
      "import * as facts from './runtime-authority-verification-facts.js';",
      'export const reviewVerifier = facts.verifyArtifactForReviewInternal;',
    ].join('\n'),
    'verifyArtifactForReviewInternal',
    'reviewVerifier',
    'src/runtime-authority-verification-facts.ts',
  );
});

test('T-VALIAS-05', () => {
  const inventory = assertAuthorityInventory();
  const value = generated();
  expect(verifyArtifact(value.outputPath, value.config).verification_status === 'verified', 'official generation/verification regression');
  withSyntheticSource(
    'unrelated-value-export',
    [
      "import { generateArtifact } from './runtime-authority-canonical-artifact.js';",
      "const internalLabel = 'safe';",
      'export const publicLabel = internalLabel;',
      'export const invokedGenerator = (...args: Parameters<typeof generateArtifact>) => generateArtifact(...args);',
    ].join('\n'),
    () => { assertAuthorityInventory(); },
  );
  expect(inventory.exports.get('reduceVerificationOutcome')!.size === 0, 'unmodified tree unexpectedly exports internal reducer');
});

test('T-REG-01', () => {
  const runner = readFileSync('scripts/peac-runtime-authority-ci.ts', 'utf8');
  expect(runner.includes('peac-runtime-authority-self-test.ts'), 'legacy Runtime self-test missing');
  expect(runner.includes('peac-runtime-authority-evidence-lock-test.ts'), 'Evidence-Lock suite missing');
  expect(runner.includes('peac-runtime-authority-v25-test.ts'), 'V2.5 root-closure suite missing');
});

try {
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`PEaC Runtime v2.5 root-closure tests passed: ${passed} checks.`);
  }
} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
