import { createHash } from "node:crypto";
import { readFileSync,rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cwd=new URL("..",import.meta.url);
const packageJson=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
if(packageJson.private!==true||packageJson.publishConfig!==undefined||packageJson.bin!==undefined){
  throw new Error("historical compatibility package must remain private, unpublished, and without a public CLI bin");
}
if(Object.keys(packageJson.exports??{}).some((key)=>key!=="."))throw new Error("historical compatibility package exposes an unsupported subpath");

const result=spawnSync("npm",["pack","--json","--ignore-scripts"],{cwd,encoding:"utf8"});
if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status??1);}
const payload=JSON.parse(result.stdout)[0];
const paths=payload.files.map((item)=>item.path).sort();
const allowed=[
  "README.md","package.json",
  "dist/canonical.d.ts","dist/canonical.js",
  "dist/cli.d.ts","dist/cli.js",
  "dist/errors.d.ts","dist/errors.js",
  "dist/index.d.ts","dist/index.js",
  "dist/provenance.json",
  "dist/render.d.ts","dist/render.js",
  "dist/routes.d.ts","dist/routes.js",
  "dist/schema.d.ts","dist/schema.js",
  "dist/types.d.ts","dist/types.js",
  "dist/validate-semantics.d.ts","dist/validate-semantics.js",
  "dist/validate.d.ts","dist/validate.js",
  "dist/assets/consumer-compatibility.v1.11.0.json",
  "dist/assets/input.schema.json",
  "dist/assets/output.schema.json",
  "dist/assets/reason-compatibility.v1.11.0.json",
  "dist/assets/route.json",
].sort();
const unexpected=paths.filter((path)=>!allowed.includes(path));
const missing=allowed.filter((path)=>!paths.includes(path));
const forbidden=paths.filter((path)=>path.includes("templates/")||/rules\.yaml$|validators\.yaml$|evals\.yaml$/.test(path));
const archivePath=new URL(`../${payload.filename}`,import.meta.url);
const archiveList=spawnSync("tar",["-tzf",archivePath.pathname],{encoding:"utf8"});
if(archiveList.status!==0){process.stderr.write(archiveList.stderr);rmSync(archivePath,{force:true});process.exit(1);}
const archivedPaths=archiveList.stdout.trim().split("\n").filter(Boolean).map((path)=>path.replace(/^package\//,"")).sort();
const archiveMismatch=JSON.stringify(archivedPaths)!==JSON.stringify(paths);
const sha256=createHash("sha256").update(readFileSync(archivePath)).digest("hex");
if(unexpected.length||missing.length||forbidden.length||archiveMismatch){
  console.error(JSON.stringify({unexpected,missing,forbidden,archive_mismatch:archiveMismatch,paths,archived_paths:archivedPaths},null,2));
  rmSync(archivePath,{force:true});
  process.exit(1);
}
console.log(JSON.stringify({
  ok:true,
  lifecycle_status:"historical_fail_closed_compatibility",
  publication_status:"NOT_PUBLISHED",
  downstream_integration_status:"NOT_INTEGRATED",
  filename:payload.filename,
  file_count:paths.length,
  package_size:payload.size,
  unpacked_size:payload.unpackedSize,
  shasum:payload.shasum,
  sha256,
  integrity:payload.integrity,
  files:paths,
},null,2));
rmSync(archivePath,{force:true});
