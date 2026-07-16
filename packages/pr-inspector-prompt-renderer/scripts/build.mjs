import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(pkgDir, "../..");
const domainDir = join(repoDir, "domains/pr_inspector_action");
const dist = join(pkgDir, "dist");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const shaPattern = /^[0-9a-f]{40}$/;

rmSync(dist, { recursive: true, force: true });
const repoTsc = join(repoDir, "node_modules/typescript/bin/tsc");
if (existsSync(repoTsc)) execFileSync(process.execPath, [repoTsc, "-p", join(pkgDir, "tsconfig.json")], { cwd: pkgDir, stdio: "inherit" });
else execFileSync("tsc", ["-p", join(pkgDir, "tsconfig.json")], { cwd: pkgDir, stdio: "inherit" });
chmodSync(join(dist, "cli.js"), 0o755);
mkdirSync(join(dist, "assets", "templates"), { recursive: true });

const packageJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const peac = readFileSync(join(repoDir, "peac.config.yaml"), "utf8");
const pipelineVersion = /^version:\s*["']?([^"'\n]+)["']?/m.exec(peac)?.[1]?.trim() ?? "UNKNOWN";
const suppliedSource = process.env.PROMPT_PIPELINE_SOURCE_COMMIT;
let source_commit_sha = "UNKNOWN";
let source_commit_verified = false;
let source_identity_source = "unknown";
let dirty = true;
let gitSource = null;
try { gitSource = run("git", ["rev-parse", "HEAD"]); } catch {}
if (gitSource && shaPattern.test(gitSource)) {
  if (suppliedSource && suppliedSource !== gitSource) throw new Error(`PROMPT_PIPELINE_SOURCE_COMMIT ${suppliedSource} does not match Git HEAD ${gitSource}`);
  source_commit_sha = gitSource;
  source_commit_verified = true;
  source_identity_source = "git";
  dirty = run("git", ["status", "--porcelain", "--untracked-files=no"]).length > 0;
} else if (suppliedSource) {
  if (!shaPattern.test(suppliedSource)) throw new Error("PROMPT_PIPELINE_SOURCE_COMMIT must be a 40-character lowercase Git SHA");
  source_commit_sha = suppliedSource;
  source_identity_source = "build_context";
  source_commit_verified = false;
  dirty = true;
}
const releaseBuild = process.argv.includes("--release");
if (releaseBuild && (!source_commit_verified || dirty)) throw new Error("release build requires a Git-verified source commit and a clean worktree");

const assetFiles = ["input.schema.json", "output.schema.json", "route.json", "rules.yaml", "validators.yaml", "evals.yaml", "templates/model_action.md", "templates/human_handoff.md", "templates/no_prompt.md"];
for (const name of assetFiles) { const target = join(dist, "assets", name); mkdirSync(dirname(target), { recursive: true }); cpSync(join(domainDir, name), target); }
const asset_hashes = Object.fromEntries(assetFiles.map((name) => [name, hash(join(domainDir, name))]));
writeFileSync(join(dist, "provenance.json"), `${JSON.stringify({ package_name: packageJson.name, package_version: packageJson.version, prompt_pipeline_version: pipelineVersion, source_commit_sha, source_commit_verified, source_identity_source, dirty, domain: "pr_inspector_action", contract_version: "pr_inspector_action.v1", asset_hashes }, null, 2)}\n`);
