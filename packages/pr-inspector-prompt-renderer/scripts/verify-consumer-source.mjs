import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [currentVersionPath,officialReviewPath,ownerDeliveryPath,enforcementDocPath]=process.argv.slice(2);
if(!currentVersionPath||!officialReviewPath||!ownerDeliveryPath||!enforcementDocPath){
  throw new Error("usage: verify-consumer-source.mjs CURRENT_VERSION OFFICIAL_REVIEW_PY OWNER_DELIVERY_PY CANONICAL_OUTPUT_ENFORCEMENT_MD");
}
const sha=(value)=>createHash("sha256").update(value).digest("hex");
const bytes={
  current_version:readFileSync(currentVersionPath),
  official_review:readFileSync(officialReviewPath),
  owner_delivery:readFileSync(ownerDeliveryPath),
  enforcement_document:readFileSync(enforcementDocPath),
};
const text=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,value.toString("utf8").replace(/\r\n?/g,"\n")]));
if(text.current_version.trim()!=="v1.11.1")throw new Error("active PR-Inspector protocol is not v1.11.1");
for(const required of [
  "VerifiedReviewCompletion",
  "official_owner_delivery",
  "verify_completed_review",
  "complete_review",
])if(!text.official_review.includes(required))throw new Error(`official review boundary missing ${required}`);
for(const required of [
  "is_verified_review_completion",
  "official owner delivery requires verified completion",
  "def official_owner_delivery",
  "prompt-required owner output must use official_owner_delivery",
])if(!text.owner_delivery.includes(required))throw new Error(`owner delivery boundary missing ${required}`);
for(const required of [
  "External integrations must use `VerifiedReviewCompletion` and `official_owner_delivery`",
  "reconstructed prompts",
  "unsupported",
])if(!text.enforcement_document.includes(required))throw new Error(`canonical enforcement document missing ${required}`);
console.log(JSON.stringify({
  ok:true,
  active_protocol:"v1.11.1",
  active_inspector_commit:"80bc105d924d7c7dd566e76a9d8d919368655cfa",
  architecture:"historical_fail_closed_compatibility",
  official_byte_passthrough_supported:false,
  source_content_sha256:Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,sha(value)])),
}));
