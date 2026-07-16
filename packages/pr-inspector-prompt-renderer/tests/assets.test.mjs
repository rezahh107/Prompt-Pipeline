import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const authoritativePath = join(repo, "domains/pr_inspector_action/input.schema.json");
const packagedPath = join(here, "../dist/assets/input.schema.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("packaged schema is byte-identical to authoritative domain schema", () => {
  const authoritative = readFileSync(authoritativePath);
  const packaged = readFileSync(packagedPath);
  assert.equal(hash(packaged), hash(authoritative));
});

test("authoritative finding schema matches PR-Inspector v1.10.2", () => {
  const schema = JSON.parse(readFileSync(authoritativePath, "utf8"));
  const finding = schema.$defs.finding;
  assert.ok(finding.properties.file_location, "file_location must be a canonical finding field");
  assert.ok(finding.properties.symbol, "symbol must be a canonical finding field");
  assert.ok(finding.properties.relevant_code, "relevant_code must be a canonical finding field");
  assert.ok(finding.properties.severity.enum.includes("HIGH"), "severity HIGH must be supported");
  assert.ok(!finding.properties.severity.enum.includes("High"), "legacy title-case severity must be rejected");
});
