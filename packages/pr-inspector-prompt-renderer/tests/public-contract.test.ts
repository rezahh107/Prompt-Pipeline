import {
  ACTIVE_INSPECTOR,
  MIGRATION_ERROR_CODE,
  getCompatibility,
  getLifecycle,
  rejectActiveRendering,
} from "../dist/index.js";
import type {
  HistoricalCompatibilityMetadata,
  LifecycleMetadata,
} from "../dist/index.js";
import * as publicApi from "../dist/index.js";

const lifecycle: LifecycleMetadata = getLifecycle();
const compatibility: HistoricalCompatibilityMetadata = getCompatibility();

const protocol: "v1.11.1" = ACTIVE_INSPECTOR.protocol;
const commit: "80bc105d924d7c7dd566e76a9d8d919368655cfa" = ACTIVE_INSPECTOR.commit;
const migrationCode: "PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED" = MIGRATION_ERROR_CODE;
const activeRendering: false = lifecycle.active_rendering_supported;
const passThrough: false = lifecycle.official_byte_passthrough_supported;
const authoritativeOutput: false = compatibility.authoritative_output;

void protocol;
void commit;
void migrationCode;
void activeRendering;
void passThrough;
void authoritativeOutput;
void rejectActiveRendering;

// @ts-expect-error the retired renderer is not part of the public package API
publicApi.render({});
// @ts-expect-error projection validation is not an active public integration API
publicApi.validateInput({});
// @ts-expect-error active route tables are not exported
publicApi.ACTION_ROUTES;
