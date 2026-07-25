import type { BenignOperation } from './runtime-authority-foundation.js';

export type MatchedBenignPayloadKind = 'none' | 'bounded_literal' | 'inline_free_form';
export type BenignPayloadMetadata =
  | { kind: 'none' }
  | { kind: 'inline_free_form' }
  | { kind: 'grammar_literal' }
  | { kind: 'rewrite_optional_literal' };

export interface BenignOperationPatternSpec {
  id: string;
  operation: BenignOperation;
  pattern: RegExp;
  payload: BenignPayloadMetadata;
}

export interface BenignOperationRequestMatch {
  operation: BenignOperation;
  payloadKind: MatchedBenignPayloadKind;
  patternId: string;
}

const SIMPLE_GRAMMAR_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'book', 'boy', 'cat', 'child', 'class', 'dog', 'friend',
  'girl', 'go', 'goes', 'good', 'has', 'have', 'he', 'home', 'i', 'in', 'is', 'it', 'learn',
  'likes', 'love', 'my', 'read', 'reads', 'school', 'she', 'student', 'teacher', 'the', 'they',
  'to', 'we', 'work', 'works', 'you', 'your',
]);

function boundedGrammarLiteral(request: string): boolean {
  const separator = request.indexOf(':');
  if (separator < 0) return false;
  const literal = request.slice(separator + 1).trim();
  if (!/^[A-Za-z][A-Za-z' ]{1,78}\.$/.test(literal)) return false;
  const words = literal.slice(0, -1).toLowerCase().split(/\s+/);
  return words.length <= 12 && words.every((word) => SIMPLE_GRAMMAR_WORDS.has(word));
}

export const BENIGN_OPERATION_PATTERN_SPECS: readonly BenignOperationPatternSpec[] = [
  {
    id: 'short_greeting_en_direct',
    operation: 'short_greeting',
    pattern: /^(?:create|write|draft|make)\s+(?:a\s+)?(?:short\s+)?(?:friendly\s+)?(?:greeting|hello message|welcome message)\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'short_greeting_en_prompt',
    operation: 'short_greeting',
    pattern: /^(?:create|write|draft)\s+(?:a\s+)?(?:short\s+)?(?:reusable\s+)?prompt\s+for\s+(?:a\s+)?(?:short\s+)?friendly greeting\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'short_greeting_fa',
    operation: 'short_greeting',
    pattern: /^(?:یک\s+)?(?:پیام\s+)?سلام(?:\s+کوتاه)?(?:\s+و\s+دوستانه)?\s*(?:بنویس|ایجاد کن)؟?\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'birthday_congratulation_en_direct',
    operation: 'birthday_or_congratulation_message',
    pattern: /^(?:create|write|draft|make)\s+(?:a\s+)?(?:short\s+)?(?:birthday wish|birthday message|congratulation message|congratulatory message)\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'birthday_congratulation_en_prompt',
    operation: 'birthday_or_congratulation_message',
    pattern: /^(?:create|write|draft)\s+(?:a\s+)?(?:short\s+)?(?:reusable\s+)?prompt\s+for\s+(?:a\s+)?(?:birthday wish|congratulation message)\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'birthday_congratulation_fa',
    operation: 'birthday_or_congratulation_message',
    pattern: /^(?:یک\s+)?پیام\s+(?:تولد|تبریک)(?:\s+کوتاه)?\s*(?:بنویس|ایجاد کن)؟?\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'grammar_en_colon',
    operation: 'grammar_correction_of_provided_text',
    pattern: /^(?:correct|fix)\s+(?:the\s+)?grammar(?:\s+of)?\s+(?:this|the)\s+(?:sentence|text)\s*:\s*.+$/i,
    payload: { kind: 'grammar_literal' },
  },
  {
    id: 'grammar_en_of',
    operation: 'grammar_correction_of_provided_text',
    pattern: /^(?:correct|fix)\s+(?:the\s+)?grammar\s+of\s+.+$/i,
    payload: { kind: 'grammar_literal' },
  },
  {
    id: 'grammar_fa',
    operation: 'grammar_correction_of_provided_text',
    pattern: /^اصلاح\s+(?:نگارش|گرامر)\s*:\s*.+$/i,
    payload: { kind: 'grammar_literal' },
  },
  {
    id: 'rewrite_en',
    operation: 'rewrite_of_provided_text',
    pattern: /^rewrite\s+(?:the\s+)?(?:text|sentence)(?:\s+i\s+provided|\s+provided)?(?:\s*:\s*.+)?\.?$/i,
    payload: { kind: 'rewrite_optional_literal' },
  },
  {
    id: 'rewrite_fa',
    operation: 'rewrite_of_provided_text',
    pattern: /^بازنویسی\s+(?:این\s+)?(?:متن|جمله)(?:\s*:\s*.+)?$/i,
    payload: { kind: 'rewrite_optional_literal' },
  },
  {
    id: 'summary_en',
    operation: 'summary_of_provided_text',
    pattern: /^summari[sz]e\s+(?:the\s+)?(?:text|content)(?:\s+i\s+provided|\s+provided)?\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'summary_fa',
    operation: 'summary_of_provided_text',
    pattern: /^خلاصه\s+(?:این\s+)?متن(?:\s+ارائه.?شده)?\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'name_brainstorm_en_no_topic',
    operation: 'non_operational_name_brainstorm',
    pattern: /^(?:brainstorm|suggest|generate)\s+(?:some\s+)?(?:project\s+|brand\s+|product\s+)?names\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'name_brainstorm_en_topic',
    operation: 'non_operational_name_brainstorm',
    pattern: /^(?:brainstorm|suggest|generate)\s+(?:some\s+)?(?:project\s+|brand\s+|product\s+)?names\s+for\s+[^.;]+\.?$/i,
    payload: { kind: 'inline_free_form' },
  },
  {
    id: 'name_brainstorm_fa_no_topic',
    operation: 'non_operational_name_brainstorm',
    pattern: /^(?:چند\s+)?نام\s+(?:پیشنهاد بده|ایده بده)\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'name_brainstorm_fa_topic',
    operation: 'non_operational_name_brainstorm',
    pattern: /^برای\s+.+\s+(?:چند\s+)?نام\s+(?:پیشنهاد بده|ایده بده)\.?$/i,
    payload: { kind: 'inline_free_form' },
  },
  {
    id: 'poem_en_no_topic',
    operation: 'non_instructional_creative_poem',
    pattern: /^(?:write|create)\s+(?:a\s+)?(?:short\s+)?(?:creative\s+)?poem\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'poem_en_topic',
    operation: 'non_instructional_creative_poem',
    pattern: /^(?:write|create)\s+(?:a\s+)?(?:short\s+)?(?:creative\s+)?poem\s+about\s+[^.;]+\.?$/i,
    payload: { kind: 'inline_free_form' },
  },
  {
    id: 'poem_fa_no_topic',
    operation: 'non_instructional_creative_poem',
    pattern: /^(?:یک\s+)?شعر(?:\s+کوتاه)?\s*(?:بنویس|ایجاد کن)؟?\.?$/i,
    payload: { kind: 'none' },
  },
  {
    id: 'poem_fa_topic',
    operation: 'non_instructional_creative_poem',
    pattern: /^(?:یک\s+)?شعر(?:\s+کوتاه)?\s+درباره\s+[^.;]+\s*(?:بنویس|ایجاد کن)؟?\.?$/i,
    payload: { kind: 'inline_free_form' },
  },
];

function payloadKindFor(spec: BenignOperationPatternSpec, request: string): MatchedBenignPayloadKind {
  switch (spec.payload.kind) {
    case 'none':
      return 'none';
    case 'inline_free_form':
      return 'inline_free_form';
    case 'grammar_literal':
      return boundedGrammarLiteral(request) ? 'bounded_literal' : 'inline_free_form';
    case 'rewrite_optional_literal':
      return request.includes(':') ? 'inline_free_form' : 'none';
    default: {
      const exhaustive: never = spec.payload;
      throw new Error(`Unsupported benign payload metadata: ${String(exhaustive)}`);
    }
  }
}

export function assertBenignOperationPatternSpecInventory(specs: readonly unknown[] = BENIGN_OPERATION_PATTERN_SPECS): void {
  const expectedOperations = new Set<BenignOperation>([
    'short_greeting',
    'birthday_or_congratulation_message',
    'grammar_correction_of_provided_text',
    'rewrite_of_provided_text',
    'summary_of_provided_text',
    'non_operational_name_brainstorm',
    'non_instructional_creative_poem',
  ]);
  const seenOperations = new Set<BenignOperation>();
  const ids = new Set<string>();
  for (const value of specs) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Benign operation pattern metadata is incomplete: non-object spec.');
    }
    const spec = value as Partial<BenignOperationPatternSpec>;
    if (typeof spec.id !== 'string' || spec.id.length === 0 || ids.has(spec.id)) {
      throw new Error(`Benign operation pattern metadata is incomplete: invalid or duplicate id=${String(spec.id)}`);
    }
    ids.add(spec.id);
    if (!expectedOperations.has(spec.operation as BenignOperation)) {
      throw new Error(`Benign operation pattern metadata is incomplete: invalid operation=${String(spec.operation)}`);
    }
    if (!(spec.pattern instanceof RegExp)) {
      throw new Error(`Benign operation pattern metadata is incomplete: pattern=${spec.id}`);
    }
    if (!spec.payload || !['none', 'inline_free_form', 'grammar_literal', 'rewrite_optional_literal'].includes(spec.payload.kind)) {
      throw new Error(`Benign operation pattern metadata is incomplete: payload=${spec.id}`);
    }
    seenOperations.add(spec.operation as BenignOperation);
  }
  const missing = [...expectedOperations].filter((operation) => !seenOperations.has(operation));
  if (missing.length > 0) throw new Error(`Benign operation pattern metadata is incomplete: missing operations=${missing.join(',')}`);
}

assertBenignOperationPatternSpecInventory();

export function matchBenignOperationRequest(request: string): BenignOperationRequestMatch | null {
  for (const spec of BENIGN_OPERATION_PATTERN_SPECS) {
    if (!spec.pattern.test(request)) continue;
    return {
      operation: spec.operation,
      payloadKind: payloadKindFor(spec, request),
      patternId: spec.id,
    };
  }
  return null;
}
