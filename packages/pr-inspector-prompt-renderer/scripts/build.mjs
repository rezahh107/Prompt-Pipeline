import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repoDir=resolve(pkgDir,"../..");
const domainDir=join(repoDir,"domains/pr_inspector_action");
const dist=join(pkgDir,"dist");
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:repoDir,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
const hash=(path)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const shaPattern=/^[0-9a-f]{40}$/;
const packageJson=JSON.parse(readFileSync(join(pkgDir,"package.json"),"utf8"));
const suppliedSource=process.env.PROMPT_PIPELINE_SOURCE_COMMIT;
const releaseBuild=process.argv.includes("--release");
let source_commit_sha="UNKNOWN",source_commit_verified=false,source_identity_source="unknown",dirty=true,gitSource=null;
try{gitSource=run("git",["rev-parse","HEAD"]);}catch{}
if(gitSource&&shaPattern.test(gitSource)){
  if(suppliedSource&&suppliedSource!==gitSource)throw new Error(`PROMPT_PIPELINE_SOURCE_COMMIT ${suppliedSource} does not match Git HEAD ${gitSource}`);
  source_commit_sha=gitSource;
  source_commit_verified=true;
  source_identity_source="git";
  dirty=run("git",["status","--porcelain=v1","--untracked-files=all"]).length>0;
}else if(suppliedSource){
  if(!shaPattern.test(suppliedSource))throw new Error("PROMPT_PIPELINE_SOURCE_COMMIT must be a 40-character lowercase Git SHA");
  source_commit_sha=suppliedSource;
  source_identity_source="build_context";
}
if(releaseBuild&&(!source_commit_verified||dirty))throw new Error("release build requires a Git-verified source commit and a clean worktree");

rmSync(dist,{recursive:true,force:true});
const repoTsc=join(repoDir,"node_modules/typescript/bin/tsc");
if(existsSync(repoTsc))execFileSync(process.execPath,[repoTsc,"-p",join(pkgDir,"tsconfig.json")],{cwd:pkgDir,stdio:"inherit"});
else execFileSync("tsc",["-p",join(pkgDir,"tsconfig.json")],{cwd:pkgDir,stdio:"inherit"});
chmodSync(join(dist,"cli.js"),0o755);
mkdirSync(join(dist,"assets"),{recursive:true});

const assetFiles=[
  "input.schema.json",
  "output.schema.json",
  "route.json",
  "reason-compatibility.v1.11.0.json",
  "consumer-compatibility.v1.11.0.json",
];
for(const name of assetFiles)cpSync(join(domainDir,name),join(dist,"assets",name));
const asset_hashes=Object.fromEntries(assetFiles.map((name)=>[name,hash(join(domainDir,name))]));
writeFileSync(join(dist,"provenance.json"),`${JSON.stringify({
  package_name:packageJson.name,
  package_version:packageJson.version,
  source_commit_sha,
  source_commit_verified,
  source_identity_source,
  dirty,
  lifecycle_status:"historical_fail_closed_compatibility",
  publication_status:"NOT_PUBLISHED",
  downstream_integration_status:"NOT_INTEGRATED",
  active_inspector_repository:"rezahh107/PR-Inspector",
  active_inspector_protocol:"v1.11.1",
  active_inspector_commit:"80bc105d924d7c7dd566e76a9d8d919368655cfa",
  historical_protocol:"v1.11.0",
  contract_version:"pr_inspector_action.historical.v1",
  asset_hashes,
},null,2)}\n`);
