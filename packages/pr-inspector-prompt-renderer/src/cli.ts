#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { RendererError, unsupported } from "./errors.js";
import {
  getCompatibility,
  getLifecycle,
  getProvenance,
  render,
} from "./render.js";

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "render";
  if (["version", "--version", "-v"].includes(command)) {
    writeJson(getProvenance());
    return;
  }
  if (command === "contract" || command === "lifecycle") {
    writeJson({
      contract: "pr_inspector_action.historical.v1",
      lifecycle: getLifecycle(),
      compatibility: getCompatibility(),
    });
    return;
  }
  if (command === "render") {
    const inputPathIndex = process.argv.indexOf("--input");
    const inputPath = inputPathIndex >= 0 ? process.argv[inputPathIndex + 1] : undefined;
    const raw = inputPath && inputPath !== "-" ? readFileSync(inputPath, "utf8") : readFileSync(0, "utf8");
    render(raw);
  }
  throw unsupported(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const known = error instanceof RendererError;
  const diagnostic = {
    ok: false,
    category: known ? error.category : "internal_error",
    message: error instanceof Error ? error.message : String(error),
    details: known ? error.details : [],
  };
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exitCode = known ? error.exitCode : 70;
});
