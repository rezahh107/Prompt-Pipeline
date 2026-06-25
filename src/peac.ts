import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import nunjucks from 'nunjucks';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

export type ExecutionMode = 'interactive' | 'batch' | 'ci' | 'agent';
export type RiskLevel = 'low' | 'medium' | 'high';
export type Dict = Record<string, unknown>;

export interface PEaCConfig {
  name?: string;
  version?: string;
  kb_path: string;
  policies_path: string;
  domains_path: string;
  pipeline_path: string;
  outputs_path: string;
  default_execution_mode: ExecutionMode;
  artifact: { schema: string; output_dir: string; format: string };
}

interface CaseExpected {
  risk_level?: RiskLevel;
  requires_human_review?: boolean;
  validation?: {
    should_pass?: boolean;
    expected_errors?: string[];
    expected_warnings?: string[];
  };
}

interface CaseFile {
  case_id: string;
  description?: string;
  domain: string;
  subtype?: string;
  version?: string;
  inputs: Dict;
  expected?: CaseExpected;
}

interface RoutingResult {
  domain: string;
  subtype: string | null;
  confidence: number;
  method: string;
}

interface ValidationResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
  checks_run: string[];
}

interface PromptArtifact {
  prompt_id: string;
  generated_at: string;
  domain: string;
  subtype: string | null;
  execution_mode: ExecutionMode;
  provenance: {
    user_request: string;
    case_file: string | null;
    routing_method: string;
    routing_confidence: number;
    template_used: string;
    template_version: string;
    inputs_provided: string[];
    inputs_inferred: string[];
    inputs_defaulted: string[];
  };
  policies_applied: Array<{ id: string; source_ref: string; source_hash: string | null; triggered_by: string }>;
  validation: ValidationResult;
  risk_level: RiskLevel;
  requires_human_review: boolean;
  review_reason: string | null;
  runtime: {
    git_commit_sha: string | null;
    node_version: string;
    package_manager: string | null;
    pipeline_version: string | null;
  };
  hashes: {
    config_hash: string;
    contract_hash: string;
    route_hash: string;
    template_hash: string;
    validators_hash: string;
    policies_hash: string;
    rendered_prompt_hash: string;
  };
  rendered_prompt: string;
}

interface ContractField {
  name: string;
  default?: unknown;
  required_if?: string;
}

interface ContractFields {
  required?: ContractField[];
  optional?: ContractField[];
  inferred?: Array<ContractField & { logic?: string }>;
  forbidden_combinations?: Array<{ fields: string[]; reason?: string; action?: string; severity?: string }>;
}

type ExprValue = string | number | boolean | null | undefined | unknown[];
type TokenType = 'identifier' | 'string' | 'number' | 'boolean' | 'null' | 'operator' | 'paren' | 'dot' | 'eof';
interface Token {
  type: TokenType;
  value: string;
}

let cachedArtifactSchemaPath: string | null = null;
let cachedAjv: Ajv | null = null;
let cachedArtifactValidator: ValidateFunction | null = null;

const EXECUTION_MODES: ExecutionMode[] = ['interactive', 'batch', 'ci', 'agent'];

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      out[key] = rest.join('=');
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[raw] = next;
      i += 1;
    } else {
      out[raw] = true;
    }
  }
  return out;
}

export function readYamlFile<T>(path: string): T | null {
  const loaded = yaml.load(readFileSync(path, 'utf8')) as T | null | undefined;
  return loaded ?? null;
}

function readRequiredYamlFile<T>(path: string): T {
  const loaded = readYamlFile<T>(path);
  if (!loaded) throw new Error(`Required YAML file is empty or invalid: ${path}`);
  return loaded;
}

export function writeYamlFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yaml.dump(value, { lineWidth: 100, noRefs: true }));
}

function parseExecutionMode(value: unknown, fallback: ExecutionMode): ExecutionMode {
  const candidate = String(value ?? fallback);
  if (EXECUTION_MODES.includes(candidate as ExecutionMode)) return candidate as ExecutionMode;
  throw new Error(`Invalid execution mode: ${candidate}. Expected one of: ${EXECUTION_MODES.join(', ')}`);
}

function tokenizeExpression(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (type: TokenType, value: string) => tokens.push({ type, value });
  const isIdentifierStart = (char: string) => /[A-Za-z_$]/.test(char);
  const isIdentifierPart = (char: string) => /[A-Za-z0-9_$]/.test(char);

  while (i < expr.length) {
    const char = expr[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      push('paren', char);
      i += 1;
      continue;
    }

    if (char === '.') {
      push('dot', char);
      i += 1;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      const quote = char;
      let value = '';
      i += 1;
      while (i < expr.length) {
        const current = expr[i];
        if (current === '\\') {
          const next = expr[i + 1];
          if (next === undefined) throw new Error(`Unterminated escape in expression: ${expr}`);
          value += next;
          i += 2;
          continue;
        }
        if (current === quote) {
          i += 1;
          push('string', value);
          value = '';
          break;
        }
        value += current;
        i += 1;
      }
      if (value !== '') throw new Error(`Unterminated string literal in expression: ${expr}`);
      continue;
    }

    if (/[0-9]/.test(char)) {
      let value = char;
      i += 1;
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        value += expr[i];
        i += 1;
      }
      if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid number literal in expression: ${value}`);
      push('number', value);
      continue;
    }

    const three = expr.slice(i, i + 3);
    const two = expr.slice(i, i + 2);
    if (three === '===' || three === '!==') {
      push('operator', three);
      i += 3;
      continue;
    }
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
      push('operator', two);
      i += 2;
      continue;
    }
    if (['>', '<', '!'].includes(char)) {
      push('operator', char);
      i += 1;
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = char;
      i += 1;
      while (i < expr.length && isIdentifierPart(expr[i])) {
        value += expr[i];
        i += 1;
      }
      if (value === 'true' || value === 'false') push('boolean', value);
      else if (value === 'null') push('null', value);
      else push('identifier', value);
      continue;
    }

    throw new Error(`Unsupported token "${char}" in expression: ${expr}`);
  }

  push('eof', '');
  return tokens;
}

class ExpressionParser {
  private position = 0;

  constructor(private readonly tokens: Token[], private readonly inputs: Dict) {}

  parse(): boolean {
    const value = this.parseOr();
    this.expect('eof');
    return Boolean(value);
  }

  private current(): Token {
    return this.tokens[this.position] ?? { type: 'eof', value: '' };
  }

  private consume(): Token {
    const token = this.current();
    this.position += 1;
    return token;
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current();
    if (token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    this.position += 1;
    return true;
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (!this.match(type, value)) {
      const expected = value ? `${type}:${value}` : type;
      throw new Error(`Expected ${expected}, got ${token.type}:${token.value}`);
    }
    return token;
  }

  private parseOr(): ExprValue {
    let left = this.parseAnd();
    while (this.match('operator', '||')) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): ExprValue {
    let left = this.parseEquality();
    while (this.match('operator', '&&')) {
      const right = this.parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(): ExprValue {
    let left = this.parseComparison();
    while (true) {
      if (this.match('operator', '==') || this.match('operator', '===')) {
        const right = this.parseComparison();
        left = left === right;
        continue;
      }
      if (this.match('operator', '!=') || this.match('operator', '!==')) {
        const right = this.parseComparison();
        left = left !== right;
        continue;
      }
      return left;
    }
  }

  private parseComparison(): ExprValue {
    let left = this.parseUnary();
    while (true) {
      if (this.match('operator', '>')) {
        const right = this.parseUnary();
        left = Number(left) > Number(right);
        continue;
      }
      if (this.match('operator', '>=')) {
        const right = this.parseUnary();
        left = Number(left) >= Number(right);
        continue;
      }
      if (this.match('operator', '<')) {
        const right = this.parseUnary();
        left = Number(left) < Number(right);
        continue;
      }
      if (this.match('operator', '<=')) {
        const right = this.parseUnary();
        left = Number(left) <= Number(right);
        continue;
      }
      return left;
    }
  }

  private parseUnary(): ExprValue {
    if (this.match('operator', '!')) return !Boolean(this.parseUnary());
    return this.parsePrimary();
  }

  private parsePrimary(): ExprValue {
    const token = this.current();
    if (this.match('paren', '(')) {
      const value = this.parseOr();
      this.expect('paren', ')');
      return value;
    }
    if (token.type === 'string') {
      this.consume();
      return token.value;
    }
    if (token.type === 'number') {
      this.consume();
      return Number(token.value);
    }
    if (token.type === 'boolean') {
      this.consume();
      return token.value === 'true';
    }
    if (token.type === 'null') {
      this.consume();
      return null;
    }
    if (token.type === 'identifier') {
      this.consume();
      let value: ExprValue = this.inputs[token.value] as ExprValue;
      while (this.match('dot')) {
        const property = this.expect('identifier').value;
        if (property !== 'length') throw new Error(`Unsupported property access .${property}`);
        if (Array.isArray(value) || typeof value === 'string') value = value.length;
        else if (value === undefined || value === null) value = 0;
        else throw new Error(`Property .length is supported only for arrays and strings`);
      }
      return value;
    }
    throw new Error(`Unexpected token ${token.type}:${token.value}`);
  }
}

function evalCondition(expr: string | undefined, inputs: Dict): boolean {
  if (!expr || expr.trim() === '') return true;
  try {
    return new ExpressionParser(tokenizeExpression(expr), inputs).parse();
  } catch (error) {
    throw new Error(`Failed to evaluate condition "${expr}": ${(error as Error).message}`);
  }
}

export function evaluateConditionForTest(expr: string, inputs: Dict): boolean {
  return evalCondition(expr, inputs);
}

function checkOutputExpression(expr: string, renderedPrompt: string, inputs: Dict): boolean {
  const containsMatch = expr.match(/^rendered_prompt\s+contains\s+['"](.+)['"]$/);
  if (containsMatch) {
    const needle = containsMatch[1];
    return typeof needle === 'string' && renderedPrompt.includes(needle);
  }
  const jsExpr = expr.replaceAll('len(rendered_prompt)', String(renderedPrompt.length));
  return evalCondition(jsExpr, { ...inputs, rendered_prompt: renderedPrompt });
}

function contractFields(contract: Dict): ContractFields {
  return (contract.fields as ContractFields | undefined) ?? {};
}

function valueIsMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function getMissingRequiredFields(contract: Dict, inputs: Dict): string[] {
  const fields = contractFields(contract);
  const missing = new Set<string>();

  for (const field of fields.required ?? []) {
    if (valueIsMissing(inputs[field.name])) missing.add(field.name);
  }

  for (const field of fields.optional ?? []) {
    if (field.required_if && evalCondition(field.required_if, inputs) && valueIsMissing(inputs[field.name])) {
      missing.add(field.name);
    }
  }

  return [...missing].sort();
}

function enforceMissingInputs(missing: string[], mode: ExecutionMode): void {
  if (missing.length === 0) return;
  const list = missing.join(', ');
  if (mode === 'interactive') {
    throw new Error(`Missing required input(s): ${list}. Interactive questioning is not implemented in the CLI yet; provide a case file or explicit inputs.`);
  }
  if (mode === 'agent') {
    throw new Error(`Missing required input(s): ${list}. Agent mode may default only optional fields; required inputs must be supplied.`);
  }
  throw new Error(`Missing required input(s): ${list}`);
}

function inputIsActive(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

function severityForCombination(combo: { action?: string; severity?: string }): string {
  if (combo.severity) return combo.severity;
  if (combo.action === 'error' || combo.action === 'fail' || combo.action === 'fail_fast') return 'error';
  return 'warning';
}

function getForbiddenCombinationViolations(contract: Dict, inputs: Dict): Array<{ message: string; severity: string }> {
  const fields = contractFields(contract);
  const violations: Array<{ message: string; severity: string }> = [];
  for (const combo of fields.forbidden_combinations ?? []) {
    if (combo.fields.length === 0) continue;
    const active = combo.fields.every((fieldName) => inputIsActive(inputs[fieldName]));
    if (active) {
      const reason = combo.reason ? ` — ${combo.reason}` : '';
      violations.push({ message: `${combo.fields.join(' + ')}${reason}`, severity: severityForCombination(combo) });
    }
  }
  return violations;
}

function applyOptionalDefaults(contract: Dict, inputs: Dict): { inputs: Dict; defaulted: string[] } {
  const copy = { ...inputs };
  const defaulted: string[] = [];
  for (const field of contractFields(contract).optional ?? []) {
    if (copy[field.name] === undefined && Object.prototype.hasOwnProperty.call(field, 'default')) {
      copy[field.name] = field.default;
      defaulted.push(field.name);
    }
  }
  return { inputs: copy, defaulted };
}

function applyInferences(contract: Dict, inputs: Dict): { inputs: Dict; inferred: string[] } {
  const copy = { ...inputs };
  const inferred: string[] = [];
  for (const field of contractFields(contract).inferred ?? []) {
    if (field.name === 'risk_level') continue;
    if (copy[field.name] !== undefined) continue;
    if (field.logic) {
      copy[field.name] = evalCondition(field.logic, copy);
      inferred.push(field.name);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(field, 'default')) {
      copy[field.name] = field.default;
      inferred.push(field.name);
    }
  }
  return { inputs: copy, inferred };
}

function assessRisk(route: Dict, inputs: Dict): RiskLevel {
  const overrides = route.risk_overrides as Array<{ condition: string; risk: RiskLevel }> | undefined;
  for (const override of overrides ?? []) {
    if (evalCondition(override.condition, inputs)) return override.risk;
  }

  const domain = String(inputs.domain ?? '');
  if (inputs.legal_medical_financial === true) return 'high';
  if (domain === 'agents' && inputs.tool_actions === true) return 'high';
  if (domain === 'image' && inputs.minors_or_students === true && inputs.needs_overlay === true) return 'high';
  if (domain === 'image' && inputs.subject_identity === true && inputs.exact_factual_claims === true) return 'high';
  if (domain === 'image' && inputs.subject_identity === true) return 'medium';
  if (domain === 'image' && Number(inputs.subject_count ?? 0) > 0) return 'medium';
  if (inputs.exact_factual_claims === true || inputs.official_information === true) return 'medium';
  return 'low';
}

function selectSubtype(route: Dict, inputs: Dict, requested?: string): string {
  if (requested) return requested;
  const subtypes = (route.subtypes as Array<{ id: string; triggers?: string[] }> | undefined) ?? [];
  for (const subtype of subtypes) {
    if ((subtype.triggers ?? []).every((condition) => evalCondition(condition, inputs))) return subtype.id;
  }
  return subtypes[0]?.id ?? 'default';
}

function selectTemplate(route: Dict, subtype: string): string {
  const subtypes = (route.subtypes as Array<{ id: string; templates?: { primary?: string } }> | undefined) ?? [];
  return subtypes.find((item) => item.id === subtype)?.templates?.primary ?? `${subtype}.j2`;
}

function routeRequest(request: string, config: PEaCConfig): RoutingResult {
  const router = readYamlFile<{ domains: Record<string, { enabled?: boolean; keywords?: string[]; patterns?: string[]; confidence_threshold?: number }> }>(join(config.pipeline_path, 'router.yaml')) ?? { domains: {} };
  const normalized = request.toLowerCase();
  for (const [domain, domainConfig] of Object.entries(router.domains)) {
    if (domainConfig.enabled === false || domain === 'general') continue;
    const keywordMatch = (domainConfig.keywords ?? []).some((keyword) => normalized.includes(keyword.toLowerCase()));
    const patternMatch = (domainConfig.patterns ?? []).some((pattern) => new RegExp(pattern, 'i').test(request));
    if (keywordMatch || patternMatch) {
      return { domain, subtype: null, confidence: domainConfig.confidence_threshold ?? 0.8, method: 'keyword_match' };
    }
  }
  return { domain: 'general', subtype: 'default', confidence: 0.5, method: 'fallback_general_low_risk' };
}

function loadPolicies(config: PEaCConfig, inputs: Dict): Array<{ id: string; source_ref: string; source_hash: string | null; triggered_by: string }> {
  if (!existsSync(config.policies_path)) return [];
  const result: Array<{ id: string; source_ref: string; source_hash: string | null; triggered_by: string }> = [];
  for (const file of readdirSync(config.policies_path).filter((item) => item.endsWith('.yaml'))) {
    const policy = readYamlFile<{ policy_id: string; source_ref: string; source_hash?: string | null; applies_when?: string[] }>(join(config.policies_path, file));
    if (!policy?.policy_id || !policy.source_ref) continue;
    const conditions = policy.applies_when ?? ['true'];
    if (conditions.some((condition) => evalCondition(condition, inputs))) {
      result.push({ id: policy.policy_id, source_ref: policy.source_ref, source_hash: policy.source_hash ?? null, triggered_by: conditions.join(' OR ') });
    }
  }
  return result;
}

function renderTemplate(templatePath: string, inputs: Dict): string {
  const env = new nunjucks.Environment(undefined, { autoescape: false, throwOnUndefined: false });
  return `${env.renderString(readFileSync(templatePath, 'utf8'), inputs).trim()}\n`;
}

function runStaticValidation(renderedPrompt: string, validatorsPath: string, contract: Dict, inputs: Dict, policiesApplied: string[]): ValidationResult {
  const validation: ValidationResult = { passed: true, warnings: [], errors: [], checks_run: [] };
  const validators = readYamlFile<{ static_checks?: Array<Dict> }>(validatorsPath) ?? {};
  const add = (severity: string, message: string) => {
    if (severity === 'error') {
      validation.errors.push(message);
      validation.passed = false;
    } else {
      validation.warnings.push(message);
    }
  };

  for (const check of validators.static_checks ?? []) {
    const id = String(check.id ?? 'unnamed_check');
    validation.checks_run.push(id);
    if (!evalCondition(check.applies_when as string | undefined, { ...inputs, rendered_prompt: renderedPrompt })) continue;
    const severity = String(check.severity ?? 'warning');

    if (check.type === 'contract_check') {
      const missing = getMissingRequiredFields(contract, inputs);
      if (missing.length > 0) add(severity, `Missing required fields: ${missing.join(', ')}`);
    }
    if (check.type === 'rule_presence') {
      const required = String(check.required_policy_id ?? '');
      if (required && !policiesApplied.includes(required)) add(severity, String(check.message ?? `Required policy not applied: ${required}`));
    }
    if (check.type === 'forbidden_instruction') {
      for (const pattern of (check.forbidden_patterns as string[] | undefined) ?? []) {
        if (renderedPrompt.toLowerCase().includes(pattern.toLowerCase())) add(severity, `Forbidden instruction found: ${pattern}`);
      }
    }
    if (check.type === 'field_check' && !evalCondition(check.check as string | undefined, inputs)) {
      add(severity, String(check.message ?? `Field check failed: ${id}`));
    }
    if (check.type === 'output_check' && !checkOutputExpression(String(check.check ?? ''), renderedPrompt, inputs)) {
      add(severity, String(check.message ?? `Output check failed: ${id}`));
    }
    if (check.type === 'forbidden_combination') {
      for (const violation of getForbiddenCombinationViolations(contract, inputs)) {
        add(violation.severity || severity, `Forbidden input combination: ${violation.message}`);
      }
    }
  }
  return validation;
}

function hashText(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hashFile(path: string): string {
  return hashText(readFileSync(path, 'utf8'));
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value, Object.keys(value as object).sort()));
}

function readPackageManager(): string | null {
  try {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string };
    return packageJson.packageManager ?? null;
  } catch {
    return null;
  }
}

function buildArtifactHashes(paths: { contractPath: string; routePath: string; templatePath: string; validatorsPath: string }, policies: unknown[], renderedPrompt: string): PromptArtifact['hashes'] {
  return {
    config_hash: hashFile('peac.config.yaml'),
    contract_hash: hashFile(paths.contractPath),
    route_hash: hashFile(paths.routePath),
    template_hash: hashFile(paths.templatePath),
    validators_hash: hashFile(paths.validatorsPath),
    policies_hash: hashJson(policies),
    rendered_prompt_hash: hashText(renderedPrompt)
  };
}

function validateArtifactSchema(config: PEaCConfig, artifact: PromptArtifact): void {
  if (!cachedAjv || !cachedArtifactValidator || cachedArtifactSchemaPath !== config.artifact.schema) {
    const schema = JSON.parse(readFileSync(config.artifact.schema, 'utf8')) as object;
    cachedAjv = new Ajv({ allErrors: true, strict: false });
    addFormats(cachedAjv);
    cachedArtifactValidator = cachedAjv.compile(schema);
    cachedArtifactSchemaPath = config.artifact.schema;
  }

  const ajv = cachedAjv;
  const validate = cachedArtifactValidator;
  if (!ajv || !validate) throw new Error('Artifact schema validator was not initialized.');

  if (!validate(artifact)) {
    throw new Error(`Artifact schema validation failed: ${ajv.errorsText(validate.errors)}`);
  }
}

export function loadConfig(): PEaCConfig {
  return readRequiredYamlFile<PEaCConfig>('peac.config.yaml');
}

export function generateArtifact(args: Record<string, string | boolean>): { artifact: PromptArtifact; outputPath: string } {
  const config = loadConfig();
  const mode = parseExecutionMode(args.mode, config.default_execution_mode);
  const caseFile = typeof args.case === 'string' ? args.case : null;
  const userRequest = typeof args.request === 'string' ? args.request : '';

  let routing: RoutingResult;
  let caseData: CaseFile | null = null;
  let providedInputs: Dict;

  if (caseFile) {
    caseData = readRequiredYamlFile<CaseFile>(caseFile);
    routing = { domain: caseData.domain, subtype: caseData.subtype ?? null, confidence: 1, method: 'case_file' };
    providedInputs = { ...caseData.inputs };
  } else {
    routing = routeRequest(userRequest, config);
    providedInputs = { task: userRequest };
  }

  providedInputs.domain = routing.domain;
  const contractPath = join(config.domains_path, routing.domain, 'input.contract.yaml');
  const routePath = join(config.domains_path, routing.domain, 'route.yaml');
  const validatorsPath = join(config.domains_path, routing.domain, 'validators.yaml');
  const contract = readRequiredYamlFile<Dict>(contractPath);
  const route = readRequiredYamlFile<Dict>(routePath);

  const withDefaults = applyOptionalDefaults(contract, providedInputs);
  const withInferences = applyInferences(contract, withDefaults.inputs);
  const inputs = withInferences.inputs;
  enforceMissingInputs(getMissingRequiredFields(contract, inputs), mode);

  const subtype = selectSubtype(route, inputs, routing.subtype ?? undefined);
  inputs.subtype = subtype;
  inputs.risk_level = assessRisk(route, inputs);
  const riskLevel = inputs.risk_level as RiskLevel;

  const templateName = selectTemplate(route, subtype);
  const templatePath = join(config.domains_path, routing.domain, 'templates', templateName);
  const policies = loadPolicies(config, inputs);
  const renderedPrompt = renderTemplate(templatePath, inputs);
  const validation = runStaticValidation(renderedPrompt, validatorsPath, contract, inputs, policies.map((policy) => policy.id));

  const artifact: PromptArtifact = {
    prompt_id: `${routing.domain}.${subtype}.v1`,
    generated_at: new Date().toISOString(),
    domain: routing.domain,
    subtype,
    execution_mode: mode,
    provenance: {
      user_request: userRequest || caseData?.description || '',
      case_file: caseFile,
      routing_method: routing.method,
      routing_confidence: routing.confidence,
      template_used: templatePath,
      template_version: String(caseData?.version ?? '2026.3'),
      inputs_provided: Object.keys(providedInputs).filter((key) => key !== 'domain'),
      inputs_inferred: [...new Set([...withInferences.inferred, 'risk_level'])].sort(),
      inputs_defaulted: withDefaults.defaulted.sort()
    },
    policies_applied: policies,
    validation,
    risk_level: riskLevel,
    requires_human_review: riskLevel === 'high',
    review_reason: riskLevel === 'high' ? 'High-risk prompt artifact requires human review before use.' : null,
    runtime: {
      git_commit_sha: process.env.GITHUB_SHA ?? null,
      node_version: process.version,
      package_manager: readPackageManager(),
      pipeline_version: config.version ?? null
    },
    hashes: buildArtifactHashes({ contractPath, routePath, templatePath, validatorsPath }, policies, renderedPrompt),
    rendered_prompt: renderedPrompt
  };

  validateArtifactSchema(config, artifact);
  const outputPath = join(config.outputs_path, `${artifact.prompt_id.replaceAll('.', '-')}-${Date.now()}.yaml`);
  writeYamlFile(outputPath, artifact);
  return { artifact, outputPath };
}

function walkFiles(dir: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    if (entry.isFile()) result.push(path);
  }
  return result;
}

function includesAll(haystack: string[], needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const joined = haystack.join('\n');
  return needles.every((needle) => joined.includes(needle));
}

export function validateAllCases(): { total: number; passed: number; failed: number; failures: string[] } {
  const config = loadConfig();
  const caseFiles = walkFiles(config.domains_path).filter((file) => file.replaceAll('\\', '/').includes('/cases/') && file.endsWith('.yaml'));
  const failures: string[] = [];

  for (const file of caseFiles) {
    const caseData = readRequiredYamlFile<CaseFile>(file);
    const shouldPass = caseData.expected?.validation?.should_pass ?? true;
    const expectedErrors = caseData.expected?.validation?.expected_errors;
    const expectedWarnings = caseData.expected?.validation?.expected_warnings;

    try {
      const { artifact } = generateArtifact({ case: file, mode: 'ci' });
      if (shouldPass && !artifact.validation.passed) {
        failures.push(`${file}: expected pass, got validation errors: ${artifact.validation.errors.join('; ')}`);
        continue;
      }
      if (!shouldPass && artifact.validation.passed) {
        failures.push(`${file}: expected failure, but validation passed`);
        continue;
      }
      if (caseData.expected?.risk_level && artifact.risk_level !== caseData.expected.risk_level) {
        failures.push(`${file}: expected risk ${caseData.expected.risk_level}, got ${artifact.risk_level}`);
      }
      if (caseData.expected?.requires_human_review !== undefined && artifact.requires_human_review !== caseData.expected.requires_human_review) {
        failures.push(`${file}: expected requires_human_review=${caseData.expected.requires_human_review}, got ${artifact.requires_human_review}`);
      }
      if (!includesAll(artifact.validation.errors, expectedErrors)) {
        failures.push(`${file}: expected validation errors not found: ${(expectedErrors ?? []).join('; ')}`);
      }
      if (!includesAll(artifact.validation.warnings, expectedWarnings)) {
        failures.push(`${file}: expected validation warnings not found: ${(expectedWarnings ?? []).join('; ')}`);
      }
    } catch (error) {
      const message = (error as Error).message;
      if (shouldPass) {
        failures.push(`${file}: expected pass, got error: ${message}`);
        continue;
      }
      if (!includesAll([message], expectedErrors)) {
        failures.push(`${file}: expected failure, but error did not match expected_errors. Got: ${message}`);
      }
    }
  }

  return { total: caseFiles.length, passed: caseFiles.length - failures.length, failed: failures.length, failures };
}

export function extractRuleBlocks(kbRoot: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const pattern = /<!--\s*peac-rule-id:\s*([^\s]+)\s*-->([\s\S]*?)<!--\s*\/peac-rule-id\s*-->/g;
  for (const file of walkFiles(kbRoot).filter((path) => path.endsWith('.md'))) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(pattern)) {
      const ruleId = match[1];
      const ruleBody = match[2];
      if (!ruleId || !ruleBody) continue;
      blocks.set(ruleId, ruleBody.trim());
    }
  }
  return blocks;
}

export function hashRuleBlock(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
}

export function syncRuleHashes(checkOnly: boolean): { drifted: string[]; updated: string[]; missing: string[]; orphaned: string[] } {
  const config = loadConfig();
  const blocks = extractRuleBlocks(config.kb_path);
  const referencedRuleIds = new Set<string>();
  const yamlFiles = [
    ...walkFiles(config.policies_path).filter((file) => file.endsWith('.yaml')),
    ...walkFiles(config.domains_path).filter((file) => file.endsWith('rules.yaml'))
  ];
  const drifted: string[] = [];
  const updated: string[] = [];
  const missing: string[] = [];

  for (const file of yamlFiles) {
    const data = readYamlFile<Dict>(file);
    if (!data || typeof data !== 'object') continue;
    const entries = Array.isArray(data.rules) ? (data.rules as Dict[]) : [data];
    let changed = false;
    for (const entry of entries) {
      const ruleId = entry.peac_rule_id as string | undefined;
      if (!ruleId) continue;
      referencedRuleIds.add(ruleId);
      if (!blocks.has(ruleId)) {
        missing.push(`${file}#${ruleId}`);
        continue;
      }
      const hash = hashRuleBlock(blocks.get(ruleId)!);
      if (entry.source_hash !== hash) {
        drifted.push(`${file}#${ruleId}`);
        if (!checkOnly) {
          entry.source_hash = hash;
          entry.last_synced = new Date().toISOString().slice(0, 10);
          changed = true;
        }
      }
    }
    if (changed) {
      writeYamlFile(file, data);
      updated.push(file);
    }
  }

  const orphaned = [...blocks.keys()].filter((ruleId) => !referencedRuleIds.has(ruleId)).sort();
  return { drifted, updated, missing, orphaned };
}
