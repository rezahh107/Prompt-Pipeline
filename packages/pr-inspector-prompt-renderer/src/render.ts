import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationRequired } from "./errors.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const ACTIVE_INSPECTOR = Object.freeze({
  repository: "rezahh107/PR-Inspector",
  protocol: "v1.11.1",
  commit: "80bc105d924d7c7dd566e76a9d8d919368655cfa",
} as const);

export const MIGRATION_ERROR_CODE = "PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED";

export interface PackageProvenance {
  package_name: string;
  package_version: string;
  source_commit_sha: string;
  source_commit_verified: boolean;
  source_identity_source: "git" | "build_context" | "unknown";
  dirty: boolean;
  lifecycle_status: "historical_fail_closed_compatibility";
  publication_status: "NOT_PUBLISHED";
  downstream_integration_status: "NOT_INTEGRATED";
  active_inspector_repository: typeof ACTIVE_INSPECTOR.repository;
  active_inspector_protocol: typeof ACTIVE_INSPECTOR.protocol;
  active_inspector_commit: typeof ACTIVE_INSPECTOR.commit;
  asset_hashes: Record<string, string>;
}

export interface LifecycleMetadata {
  architecture: "historical_fail_closed_compatibility";
  active_rendering_supported: false;
  official_byte_passthrough_supported: false;
  historical_protocol: "v1.11.0";
  active_inspector: typeof ACTIVE_INSPECTOR;
  required_official_chain: readonly [
    "review-package.json",
    "official decision projection",
    "official derived outputs",
    "complete validation",
    "VerifiedReviewCompletion",
    "official_owner_delivery",
  ];
  migration_error_code: typeof MIGRATION_ERROR_CODE;
  publication_status: "NOT_PUBLISHED";
  downstream_integration_status: "NOT_INTEGRATED";
}

export interface HistoricalCompatibilityMetadata {
  lifecycle: "historical_compatibility_only";
  protocol: "v1.11.0";
  authoritative_output: false;
  may_render_active_prompt: false;
  active_inspector: typeof ACTIVE_INSPECTOR;
}

const provenance = JSON.parse(
  readFileSync(join(HERE, "provenance.json"), "utf8"),
) as PackageProvenance;

export function getProvenance(): PackageProvenance {
  return structuredClone(provenance);
}

export function getLifecycle(): LifecycleMetadata {
  return {
    architecture: "historical_fail_closed_compatibility",
    active_rendering_supported: false,
    official_byte_passthrough_supported: false,
    historical_protocol: "v1.11.0",
    active_inspector: ACTIVE_INSPECTOR,
    required_official_chain: [
      "review-package.json",
      "official decision projection",
      "official derived outputs",
      "complete validation",
      "VerifiedReviewCompletion",
      "official_owner_delivery",
    ],
    migration_error_code: MIGRATION_ERROR_CODE,
    publication_status: "NOT_PUBLISHED",
    downstream_integration_status: "NOT_INTEGRATED",
  };
}

export function getCompatibility(): HistoricalCompatibilityMetadata {
  return {
    lifecycle: "historical_compatibility_only",
    protocol: "v1.11.0",
    authoritative_output: false,
    may_render_active_prompt: false,
    active_inspector: ACTIVE_INSPECTOR,
  };
}

export function rejectActiveRendering(_value: unknown): never {
  throw migrationRequired(
    `${MIGRATION_ERROR_CODE}: active PR-Inspector output cannot be rendered by Prompt-Pipeline`,
    [
      `active_consumer=${ACTIVE_INSPECTOR.repository}@${ACTIVE_INSPECTOR.commit}`,
      `active_protocol=${ACTIVE_INSPECTOR.protocol}`,
      "required_source=VerifiedReviewCompletion",
      "required_delivery=official_owner_delivery",
      "serialized_or_copied_capabilities_are_not_supported",
    ],
  );
}

/** @deprecated Internal regression hook. Not exported from the package root. */
export function render(value: unknown): never {
  return rejectActiveRendering(value);
}
