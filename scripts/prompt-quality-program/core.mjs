import {readFileSync} from 'node:fs';
import path from 'node:path';

export const R=path.resolve(process.env.PQG_REPO_ROOT||process.cwd());
export const Q='planning/prompt-quality';
export const P=`${Q}/prompt-quality-execution-program.v2.json`;
export const PS=`${Q}/schemas/prompt-quality-execution-program.v2.schema.json`;
export const N='planning/NEXT_WORK.md';
export const REPO='rezahh107/Prompt-Pipeline';
export const PID='PROMPT-QUALITY-MIGRATION-EXECUTION-PROGRAM';
export const MODEL='BALANCED_PERSONAL_REPOSITORY';
export const fp=value=>path.isAbsolute(value)?value:path.join(R,value);
export const txt=value=>readFileSync(fp(value),'utf8');
export const json=value=>JSON.parse(txt(value));
export const uniq=value=>[...new Set(value||[])].sort();
export const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const d=(code,message='',source='repository')=>({code,message,source});

let ajv=null;
const validators=new Map();
export async function schema(schemaPath,value,source){
  try{
    if(!ajv){
      const Ajv=(await import('ajv/dist/2020.js')).default;
      ajv=new Ajv({allErrors:true,strict:true,allowUnionTypes:true});
    }
    let validate=validators.get(schemaPath);
    if(!validate){validate=ajv.compile(json(schemaPath));validators.set(schemaPath,validate)}
    return validate(value)?[]:(validate.errors||[]).map(error=>d('PQG_SCHEMA_INVALID',`${source}${error.instancePath||'/'} ${error.message}`,source));
  }catch(error){
    return[d('PQG_SCHEMA_INVALID',`schema validator unavailable: ${error?.message||error}`,source)];
  }
}
