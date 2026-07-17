#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import yaml from 'js-yaml';

interface PEaCConfig { version?: string }
interface ZipEntry { name: string; data: Buffer }

const INCLUDED_ROOTS = ['README.md', 'peac.config.yaml', 'docs', 'kb', 'policies', 'pipeline', 'domains', 'evals'];
const INCLUDED_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.json', '.j2']);
const PORTABLE_BUNDLE_EXCLUDED_PREFIXES = ['domains/pr_inspector_action/'] as const;

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isPortableBundlePath(path: string): boolean {
  const normalized = normalizePath(path);
  return !PORTABLE_BUNDLE_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...walk(child));
    if (entry.isFile() && INCLUDED_EXTENSIONS.has(extensionOf(child))) files.push(child);
  }
  return files;
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function localHeader(name: Buffer, data: Buffer, crc: number, stamp: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(name: Buffer, data: Buffer, crc: number, offset: number, stamp: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0x81a40000, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const stamp = dosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(normalizePath(entry.name), 'utf8');
    const crc = crc32(entry.data);
    const local = localHeader(name, entry.data, crc, stamp);
    localParts.push(local, entry.data);
    centralParts.push(centralHeader(name, entry.data, crc, offset, stamp));
    offset += local.length + entry.data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = endOfCentralDirectory(entries.length, central.length, centralOffset);
  return Buffer.concat([...localParts, central, end]);
}

const config = yaml.load(readFileSync('peac.config.yaml', 'utf8')) as PEaCConfig | null;
const version = config?.version ?? 'dev';
const files = [...new Set(INCLUDED_ROOTS.flatMap(walk))]
  .map(normalizePath)
  .filter(isPortableBundlePath)
  .sort();
const forbidden = files.filter((file) => !isPortableBundlePath(file));
if (forbidden.length > 0) throw new Error(`Portable bundle denylist failure: ${forbidden.join(', ')}`);
const entries = files.map((file) => ({ name: file, data: readFileSync(file) }));
const outputPath = join('dist', `Prompt-Pipeline-KB-Bundle-v${version}.zip`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buildZip(entries));
console.log(`Built ${outputPath} with ${entries.length} file(s).`);
console.log(`Portable bundle exclusions: ${PORTABLE_BUNDLE_EXCLUDED_PREFIXES.join(', ')}`);
