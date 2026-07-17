import { createHash } from "node:crypto";

export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
}
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareCodeUnits)) out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
export function stableJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
export function sha256(value: string): string { return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex"); }
export function finalText(value: string): string { return `${normalizeText(value).trim()}\n`; }
export function sortedUnique(values: string[]): string[] { return [...new Set(values.map(normalizeText))].sort(compareCodeUnits); }
