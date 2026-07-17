import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const sourceRepo=resolve(here,"../../..");
const sourcePackage=join(sourceRepo,"packages/pr-inspector-prompt-renderer");
const sourceDomain=join(sourceRepo,"domains/pr_inspector_action");
const git=(cwd,args)=>execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();

function createFixtureRepo(){
  const repo=mkdtempSync(join(tmpdir(),"pr-inspector-renderer-release-"));
  const pkg=join(repo,"packages/pr-inspector-prompt-renderer");
  mkdirSync(join(repo,"packages"),{recursive:true});
  mkdirSync(join(repo,"domains"),{recursive:true});
  cpSync(sourcePackage,pkg,{recursive:true});
  cpSync(sourceDomain,join(repo,"domains/pr_inspector_action"),{recursive:true});
  cpSync(join(sourceRepo,"peac.config.yaml"),join(repo,"peac.config.yaml"));
  rmSync(join(pkg,"dist"),{recursive:true,force:true});
  for(const name of readdirSync(pkg))if(name.endsWith(".tgz"))rmSync(join(pkg,name),{force:true});
  git(repo,["init"]);
  git(repo,["config","user.email","test@example.invalid"]);
  git(repo,["config","user.name","Renderer Test"]);
  git(repo,["add","."]);
  git(repo,["commit","-m","fixture"]);
  return {repo,pkg,head:git(repo,["rev-parse","HEAD"])};
}
function build({pkg,head},sha=head){
  return spawnSync(process.execPath,[join(pkg,"scripts/build.mjs"),"--release"],{
    cwd:pkg,encoding:"utf8",env:{...process.env,PROMPT_PIPELINE_SOURCE_COMMIT:sha}
  });
}
function expectDirty(mutator){
  const fixture=createFixtureRepo();
  try{
    mutator(fixture);
    const result=build(fixture);
    assert.notEqual(result.status,0,`release build unexpectedly succeeded\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stderr,/clean worktree/);
  }finally{rmSync(fixture.repo,{recursive:true,force:true});}
}

test("release provenance accepts a clean exact-SHA repository",()=>{
  const fixture=createFixtureRepo();
  try{
    const result=build(fixture);
    assert.equal(result.status,0,`stdout=${result.stdout}\nstderr=${result.stderr}`);
  }finally{rmSync(fixture.repo,{recursive:true,force:true});}
});
test("release provenance rejects a modified tracked file",()=>expectDirty(({pkg})=>appendFileSync(join(pkg,"src/canonical.ts"),"\n// modified\n")));
test("release provenance rejects a staged change",()=>expectDirty(({repo,pkg})=>{appendFileSync(join(pkg,"src/canonical.ts"),"\n// staged\n");git(repo,["add","packages/pr-inspector-prompt-renderer/src/canonical.ts"]);}));
test("release provenance rejects a tracked deletion",()=>expectDirty(({pkg})=>unlinkSync(join(pkg,"src/canonical.ts"))));
test("release provenance rejects a rename",()=>expectDirty(({pkg})=>renameSync(join(pkg,"src/canonical.ts"),join(pkg,"src/canonical-renamed.ts"))));
test("release provenance rejects an untracked source or declaration file",()=>expectDirty(({pkg})=>writeFileSync(join(pkg,"src/untracked.d.ts"),"export {};\n")));
test("release provenance rejects a supplied source SHA mismatch",()=>{
  const fixture=createFixtureRepo();
  try{
    const result=build(fixture,"f".repeat(40));
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/does not match Git HEAD/);
  }finally{rmSync(fixture.repo,{recursive:true,force:true});}
});
