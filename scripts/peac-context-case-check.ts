#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
type O=Record<string,any>;
const D='prompt'+'_generation';
const T=new Set(['user_provided','official','trusted','untrusted','unknown']);
const R=<T>(p:string):T=>yaml.load(readFileSync(p,'utf8')) as T;
const W=(d:string):string[]=>!existsSync(d)?[]:readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=join(d,e.name);return e.isDirectory()?W(p):/\.ya?ml$/.test(p)?[p]:[]});
export function validateContextCaseFiles(){const fs=[...W('domains/prompt_generation/cases'),...W('tests/context-policy/cases')];const failures:string[]=[];let total=0;for(const f of fs){const c=R<O>(f),i=c.inputs??{};if(c.domain!==D||i.context_items===undefined)continue;total++;const items=Array.isArray(i.context_items)?i.context_items:[];const errs:string[]=[];items.forEach((x:O,n:number)=>{const k=`${f}: context_items[${n}]`;if(typeof x?.id!=='string'||!x.id.trim())errs.push(`${k}.id is required`);if(typeof x?.source!=='string'||!x.source.trim())errs.push(`${k}.source is required`);if(typeof x?.purpose!=='string'||!x.purpose.trim())errs.push(`${k}.purpose is required`);if(typeof x?.trust_level!=='string'||!T.has(x.trust_level))errs.push(`${k}.trust_level is required`)});const should=c.expected?.validation?.should_pass??true;if(should&&errs.length)failures.push(...errs);if(!should&&!errs.length)failures.push(`${f}: expected context item errors`)}return{total,failed:failures.length,failures}}
const r=validateContextCaseFiles();if(r.failed){console.error(`PEaC context case check failed: ${r.failed}`);for(const f of r.failures)console.error(`- ${f}`);process.exit(1)}console.log(`PEaC context case check passed for ${r.total} case(s).`);
