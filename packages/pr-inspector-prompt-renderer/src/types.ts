export type ActionKind = "merge_now" | "owner_confirmation" | "human_technical_review" | "specialist_review" | "repair" | "verify" | "repair_and_verify" | "rerun_review" | "blocked_internal_error";
export type PromptKind = null | "implementer_repair_prompt" | "verification_prompt" | "fresh_review_prompt" | "human_review_handoff" | "specialist_review_handoff";
export type Recipient = "none" | "project_owner" | "implementer_model" | "reviewer_model" | "human_technical_reviewer" | "security_or_domain_specialist";
export interface Finding { finding_id: string; severity: string; blocking: boolean; evidence_label: string; issue: string; failure_scenario: string; rule_ids: string[]; recommended_fix: string; recommended_test: string; evidence_refs: string[] }
export interface EvidenceRecord { evidence_id: string; evidence_type: string; source: string; reviewed_head_sha: string; result: string; excerpt: string; reference: string | null; sha256: string | null; redactions: string[]; limitations: string[] }
export interface ContextItem { id: string; source: string; trust_label: "authoritative" | "verified" | "untrusted" | "historical"; content: string }
export interface RendererInput {
  schema_version: "pr_inspector_action.v1"; target_repository: string; pull_request_number: number; reviewed_head_sha: string; base_sha: string;
  pr_inspector_protocol_version: string; canonical_review_package_sha256: string; review_validity: "CURRENT" | "STALE" | "UNKNOWN";
  action_kind: ActionKind; prompt_kind: PromptKind; prompt_required: boolean; recipient: Recipient; may_modify_code: boolean;
  technical_status: string; approval_requirement: string; reason_codes: string[]; reason_details: Array<{reason_code:string; subjects:string[]}>;
  required_actions: string[]; findings: Finding[]; repair_handoff?: Record<string, unknown> | null; evidence_records: EvidenceRecord[];
  evidence_limitations?: string[]; sensitive_domains: string[]; target_environment: string; target_model_profile: "gpt" | "claude" | "gemini" | "local_small";
  context_policy_profile: "minimal" | "standard" | "deep"; context_budget: {max_context_items:number; max_context_tokens:number}; context_items: ContextItem[];
  prompt_language: "en" | "fa"; required_target_output_language: string; success_criteria: string[]; failure_modes: string[]; evaluation_suite_id: "pr_inspector_action.v1";
}
export interface Provenance { package_name:string; package_version:string; prompt_pipeline_version:string; source_commit_sha:string; dirty:boolean; domain:string; contract_version:string; asset_hashes:Record<string,string> }
export interface RendererOutput { schema_version:"pr_inspector_action_output.v1"; prompt_required:boolean; action_kind:ActionKind; prompt_kind:PromptKind; recipient:Recipient; may_modify_code:boolean; rendered_prompt:string|null; rendered_prompt_sha256:string|null; canonical_input_sha256:string; generator:Record<string,unknown>; human_review:{required:boolean; approval_satisfied:false; boundary:string}; risk_metadata:{technical_status:string; sensitive_domains:string[]} }
