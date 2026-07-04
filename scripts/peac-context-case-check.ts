#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
const p:any=yaml.load(readFileSync('pipeline/context-policy.yaml','utf8'));
const ids=(p.profiles??[]).map((x:any)=>x.id).sort().join(',');
if(ids!=='deep,minimal,standard'){
  console.error(`Unexpected context policies: ${ids}`);
  process.exit(1);
}
console.log('PEaC context case check passed.');
