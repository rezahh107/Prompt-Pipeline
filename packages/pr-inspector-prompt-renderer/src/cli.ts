#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RendererError } from "./errors.js";
import { getProvenance, render } from "./render.js";
const HERE=dirname(fileURLToPath(import.meta.url));
function arg(name:string):string|undefined { const index=process.argv.indexOf(name); return index>=0?process.argv[index+1]:undefined; }
function readStdin():string { return readFileSync(0,"utf8"); }
function writeJson(value:unknown):void { process.stdout.write(`${JSON.stringify(value)}
`); }
async function main():Promise<void>{ const command=process.argv[2]??"render"; if(command==="version"||command==="--version"||command==="-v"){writeJson(getProvenance());return;} if(command==="contract"){ const input=JSON.parse(readFileSync(join(HERE,"assets","input.schema.json"),"utf8")); const output=JSON.parse(readFileSync(join(HERE,"assets","output.schema.json"),"utf8")); writeJson({contract:"pr_inspector_action.v1",input_schema:input,output_schema:output}); return;} if(command!=="render") throw new RendererError(`unknown command: ${command}`,3,"unsupported"); const inputPath=arg("--input"); const text=inputPath&&inputPath!=="-"?readFileSync(inputPath,"utf8"):readStdin(); let parsed:unknown; try{parsed=JSON.parse(text);}catch(error){throw new RendererError(`invalid JSON: ${(error as Error).message}`,2,"invalid_input");} const output=render(parsed); writeJson(output); }
main().catch((error:unknown)=>{ const known=error instanceof RendererError; const diagnostic={ok:false,category:known?error.category:"internal_error",message:error instanceof Error?error.message:String(error),details:known?error.details:[]}; process.stderr.write(`${JSON.stringify(diagnostic)}
`); process.exitCode=known?error.exitCode:70; });
