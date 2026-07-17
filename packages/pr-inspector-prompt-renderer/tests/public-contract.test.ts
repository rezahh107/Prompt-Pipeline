import { validateInput } from "../dist/index.js";
import type { CanonicalReasonCode, RendererInput } from "../dist/index.js";

const schemaValidInput: RendererInput = {
  schema_version: "pr_inspector_action.v2",
  target_repository: "rezahh107/example",
  pull_request_number: 7,
  reviewed_head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  pr_inspector_protocol_version: "v1.11.0",
  canonical_review_package_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  review_validity: "CURRENT",
  inspection_profile: "minimal",
  technical_decision: { status: "GREEN", reason_codes: [] },
  governance_decision: { status: "NOT_REQUESTED", reason_codes: [] },
  overall_recommendation: { technical_ready: true, merge_governance_verified: false },
  governance_follow_up: { kind: "none", may_modify_code: false, prompt_required: false },
  external_review_reconciliation: {
    collection_status: "COMPLETE",
    open_bot_sources_total: 0,
    inspected_total: 0,
    counts: { accepted: 0, resolved: 0, stale: 0, false_positive: 0, duplicate: 0, insufficient_evidence: 0, deferred: 0, out_of_scope: 0 },
    uninspected_source_ids: [],
    valid_blocking_finding_ids: [],
    suggestion_results: [],
  },
  action_kind: "merge_now",
  prompt_kind: null,
  prompt_required: false,
  recipient: "none",
  may_modify_code: false,
  technical_status: "GREEN_TECHNICALLY_READY",
  approval_requirement: "NO_ADDITIONAL_TECHNICAL_APPROVAL",
  technical_status_reason_codes: [],
  next_action_reason_codes: [],
  reason_details: [],
  required_actions: [],
  findings: [],
  repair_handoff: null,
  evidence_records: [],
  evidence_limitations: [],
  sensitive_domains: [],
  target_environment: "ChatGPT Project",
  target_model_profile: "gpt",
  context_policy_profile: "minimal",
  context_budget: { max_context_items: 3, max_context_tokens: 1200 },
  context_items: [],
  prompt_language: "en",
  required_target_output_language: "en",
  success_criteria: ["Remain deterministic."],
  failure_modes: ["Reject incompatible input."],
  evaluation_suite_id: "pr_inspector_action.v2",
};

const validated = validateInput(schemaValidInput);
const statusCodes: CanonicalReasonCode[] = validated.technical_status_reason_codes;
const actionCodes: CanonicalReasonCode[] = validated.next_action_reason_codes;
void statusCodes;
void actionCodes;

const { technical_status_reason_codes: _status, ...withoutStatusCarrier } = schemaValidInput;
// @ts-expect-error active v2 requires technical_status_reason_codes
const missingStatusCarrier: RendererInput = withoutStatusCarrier;
void missingStatusCarrier;

const { next_action_reason_codes: _action, ...withoutActionCarrier } = schemaValidInput;
// @ts-expect-error active v2 requires next_action_reason_codes
const missingActionCarrier: RendererInput = withoutActionCarrier;
void missingActionCarrier;

// @ts-expect-error active v2 forbids the legacy top-level reason_codes alias
const legacyAlias: RendererInput = { ...schemaValidInput, reason_codes: [] };
void legacyAlias;
