import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionKind, ApprovalRequirement, PromptKind, Recipient, ReviewValidity, TechnicalStatus } from "./types.js";
export interface Route { recipient: Recipient; may_modify_code: boolean; prompt_required: boolean; prompt_kind: PromptKind; subtype: "model_action" | "human_handoff" | "no_prompt"; template: string; approval_requirement: ApprovalRequirement|null; allowed_technical_statuses:TechnicalStatus[]; allowed_review_validities:ReviewValidity[] }
interface RouteFile { contract:string; consumer_protocol_version:string; routing_mode:string; actions:Record<string,Route> }
const here=dirname(fileURLToPath(import.meta.url));
const routeFile=JSON.parse(readFileSync(join(here,"assets/route.json"),"utf8")) as RouteFile;
if(routeFile.contract!=="pr_inspector_action.v1"||routeFile.consumer_protocol_version!=="v1.10.2"||routeFile.routing_mode!=="explicitly_pinned")throw new Error("invalid packaged route contract");
export const ACTION_ROUTES=routeFile.actions as Record<ActionKind,Route>;
