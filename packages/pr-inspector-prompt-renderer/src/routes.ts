import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionKind, PromptKind, Recipient } from "./types.js";
export interface Route { recipient: Recipient; may_modify_code: boolean; prompt_required: boolean; prompt_kind: PromptKind; subtype: "model_action" | "human_handoff" | "no_prompt"; template: string }
interface RouteFile { contract:string; routing_mode:string; actions:Record<string,Route> }
const here=dirname(fileURLToPath(import.meta.url));
const routeFile=JSON.parse(readFileSync(join(here,"assets/route.json"),"utf8")) as RouteFile;
if(routeFile.contract!=="pr_inspector_action.v1"||routeFile.routing_mode!=="explicitly_pinned")throw new Error("invalid packaged route contract");
export const ACTION_ROUTES=routeFile.actions as Record<ActionKind,Route>;
