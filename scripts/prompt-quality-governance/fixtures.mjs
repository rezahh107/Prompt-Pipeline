import {F,json,uniq,eq,d} from './core.mjs';
import {validateProgram} from './program.mjs';
import {validateScope,validateImpact} from './scope-progress.mjs';
import {validateLifecycle} from './lifecycle.mjs';
import {PROGRAM_SCOPE,runProgramScope} from './fixtures-program-scope.mjs';
import {PROGRESS_LIFECYCLE,runProgressLifecycle} from './fixtures-progress-lifecycle.mjs';
async function runScenario(c,a){if(c==='full_activation'){const z=[...await validateProgram(a.p),...await validateScope(a.s),...await validateImpact(a.i,a.p,a.s,{derived:a.i.completed_obligation_ids}),...await validateLifecycle(a.l,a.s)];return uniq(z.map(x=>x.code))}if(PROGRAM_SCOPE.has(c))return runProgramScope(c,a);if(PROGRESS_LIFECYCLE.has(c))return runProgressLifecycle(c,a);return['PQG_FIXTURE_EXPECTATION_MISMATCH']}
export async function validateFixtures(a,selected){const docs=['valid.json','invalid.json','adversarial.json'].map(x=>json(`${F}/${x}`)),z=[],results=[];for(const doc of docs)for(const f of doc.fixtures||[]){if(selected&&selected!==f.fixture_id&&selected!==f.scenario)continue;const observed=await runScenario(f.scenario,a),expected=uniq(f.expected_diagnostics||[]),ok=eq(observed,expected);results.push({fixture_id:f.fixture_id,observed,expected,ok});if(!ok)z.push(d('PQG_FIXTURE_EXPECTATION_MISMATCH',`${f.fixture_id}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,f.fixture_id))}if(selected&&!results.length)z.push(d('PQG_FIXTURE_EXPECTATION_MISMATCH',`No fixture ${selected}`,F));return{docs,z,results}}
