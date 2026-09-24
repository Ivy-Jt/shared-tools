import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateState } from '../services/trip-sync/src/worker.mjs';
const file = 'global-trips/trips/2026-maldives-bangkok/trip.json';
const baseline = '97d059b30f3f3ebb6bcfe793a70b6aee318eb319';
const before = JSON.parse(execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }));
const after = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = trip => [...trip.packing, ...trip.todos].flatMap(group => group.items);
for (const old of items(before)) {
  assert.deepEqual(items(after).find(item => item.key === old.key), old, `existing item changed: ${old.key}`);
}
for (const field of ['budget', 'memoryPrompts', 'hotels', 'itinerary', 'sync']) assert.deepEqual(after[field], before[field], field);
assert.equal(after.preparation.timeline.length, 6);
for (const row of after.preparation.timeline) assert.ok(row.date && row.title && row.detail);
for (const source of after.preparation.sources) assert.equal(new URL(source.url).protocol, 'https:');
for (const status of ['', 'owned', 'bought', 'to_buy', 'optional', 'not_needed']) {
  const state = { checks: { sun1: true, 'prep-imuga': false }, packingStates: { rash: status, 'prep-adapter': status }, notes: { food: '用户笔记保留' }, budgets: { flights: 0, bkkhotel: '' } };
  const copy = structuredClone(state);
  assert.equal(validateState(state), true);
  assert.deepEqual(state, copy);
}
console.log('TRIP_PREPARATION_PASS: existing items/defaults unchanged; new keys accepted; five states preserved');
