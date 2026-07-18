import {existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {Q,fp,json,sh,eq,d} from './core.mjs';

export function jsonPaths(relativeDir, suffix='.json') {
  const root=fp(relativeDir);
  if(!existsSync(root)) return [];
  return readdirSync(root,{withFileTypes:true})
    .filter(x=>x.isFile()&&x.name.endsWith(suffix))
    .map(x=>path.posix.join(relativeDir,x.name))
    .sort((a,b)=>a.localeCompare(b));
}

export function loadJsonDirectory(relativeDir, suffix='.json') {
  return jsonPaths(relativeDir,suffix).map(file=>({file,value:json(file)}));
}

export function gitJson(ref,file) {
  if(!ref) return null;
  const raw=sh(['show',`${ref}:${file}`]);
  if(!raw) return null;
  try{return JSON.parse(raw)}catch{return null}
}

export function gitPaths(ref,relativeDir) {
  if(!ref) return [];
  const raw=sh(['ls-tree','-r','--name-only',ref,'--',relativeDir]);
  return raw?raw.split('\n').filter(x=>x.endsWith('.json')).sort((a,b)=>a.localeCompare(b)):[];
}

export function discoverRepositoryState(g) {
  const scopes=loadJsonDirectory(`${Q}/scopes`,'.scope.json');
  const impacts=loadJsonDirectory(`${Q}/impacts`);
  const ledgers=loadJsonDirectory(`${Q}/lifecycle`,'.ledger.json');
  const receipts=loadJsonDirectory(`${Q}/evidence/receipts`);
  const scopeByIdentity=new Map(scopes.map(x=>[`${x.value.task_id}:${x.value.scope_revision}`,x]));
  const baseScopes=new Map();
  const authorizationScopes=new Map();
  for(const item of scopes){
    const prior=gitJson(g.base,item.file);
    if(prior)baseScopes.set(item.file,prior);
    for(const amendment of item.value.amendments||[]){
      const snapshot=gitJson(amendment.authorization_commit_sha,item.file);
      if(snapshot)authorizationScopes.set(`${item.file}:${amendment.authorization_commit_sha}`,snapshot);
    }
  }
  const currentImpactPaths=new Set(impacts.map(x=>x.file));
  const baseImpactPaths=gitPaths(g.base,`${Q}/impacts`);
  let impactHistoryMutated=false;
  for(const file of baseImpactPaths){
    const current=impacts.find(x=>x.file===file)?.value;
    const prior=gitJson(g.base,file);
    if(!current||!prior||!eq(current,prior)){impactHistoryMutated=true;break}
  }
  return {scopes,impacts,ledgers,receipts,scopeByIdentity,baseScopes,authorizationScopes,baseImpactPaths,currentImpactPaths,impactHistoryMutated};
}

export function matchingScope(state,taskId,scopeRevision){
  return state.scopeByIdentity.get(`${taskId}:${scopeRevision}`)||null;
}

export function discoveryDiagnostics(state){
  const z=[];
  for(const item of state.ledgers)if(!matchingScope(state,item.value.task_id,item.value.scope_revision))z.push(d('PQG_LIFECYCLE_SCOPE_STALE',item.file,item.file));
  for(const item of state.impacts)if(!matchingScope(state,item.value.task_id,item.value.scope_revision))z.push(d('PQG_PROGRESS_SCOPE_MISMATCH',item.file,item.file));
  return z;
}
