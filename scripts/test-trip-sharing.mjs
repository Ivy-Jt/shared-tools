import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preparationRows, preparationFields } from '../global-trips/sync-core.mjs';
import { validateState } from '../services/trip-sync/src/worker.mjs';
import { emptyState, mergeStates } from '../global-trips/sync-core.mjs';
const trip=JSON.parse(fs.readFileSync('global-trips/trips/2026-maldives-bangkok/trip.json'));
test('personal essentials have separate keys while shared and historical keys stay intact',()=>{
 assert.deepEqual(preparationRows({key:'hat',owner:'JT+QX'}).map(x=>x.key),['hat:JT','hat:QX']);
 assert.equal(preparationRows({key:'sun1',owner:'JT+QX'})[0].key,'sun1');
 assert.equal(preparationRows({key:'future',owner:'JT+QX',preparationMode:'each'}).length,2);
 const state=emptyState();state.checks.hat=true;state.checks['hat:JT']=true;state.checks['hat:QX']=false;state.checks['review:hat:JT']=true;state.notes['owner:sun1']='QX';
 state.packingStates['hat:JT']='owned';state.notes['prep:hat:QX']='周五准备';
 assert.equal(validateState(state),true);
 state.checks['unrelated:JT']=true;assert.equal(validateState(state),false);
});
test('two people editing the same item merge without overwriting one another',()=>{
 const base=emptyState(),jt=emptyState(),qx=emptyState();jt.checks['hat:JT']=true;qx.checks['hat:QX']=true;
 const {merged,conflicts}=mergeStates(base,jt,qx);assert.equal(conflicts.length,0);
 assert.equal(merged.checks['hat:JT'],true);assert.equal(merged.checks['hat:QX'],true);
});
test('every generated field is accepted and bounded by the service allowlist',()=>{
 const state=emptyState();for(const [g,keys] of Object.entries(preparationFields(trip)))for(const key of keys)state[g][key]=g==='checks'?false:g==='packingStates'?'owned':'test';
 assert.equal(validateState(state),true);
});
