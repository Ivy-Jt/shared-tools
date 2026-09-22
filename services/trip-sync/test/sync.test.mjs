import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import worker, { sha256, validateState } from '../src/worker.mjs';
import { emptyState, mergeStates, same } from '../../../global-trips/sync-core.mjs';
import { testDatabase } from './database.mjs';

const ownerKey = `jt_${randomBytes(32).toString('base64url')}`;
const ownerHash = await sha256(ownerKey);
function fixture() {
  const DB = testDatabase();
  const env = { DB, OWNER_KEY_HASH: ownerHash, ALLOWED_ORIGINS: 'https://ivy-jt.github.io' };
  const request = (method = 'GET', body, headers = {}) => worker.fetch(new Request('https://test.invalid/v1/trips/2026-maldives-bangkok', {
    method, headers: { Authorization: `Bearer ${ownerKey}`, Origin: 'https://ivy-jt.github.io', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), env);
  return { DB, request };
}

test('private state requires the owner key and exact allowed origin', async () => {
  const { DB, request } = fixture();
  assert.equal((await request('GET', null, { Authorization: '' })).status, 401);
  assert.equal((await request('GET', null, { Authorization: `Bearer jt_${'a'.repeat(43)}` })).status, 401);
  assert.equal((await request('GET', null, { Origin: 'https://evil.invalid' })).status, 403);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://ivy-jt.github.io');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await request('OPTIONS')).status, 204);
  DB.sqlite.close();
});

test('state validation rejects injected fields and preserves blank versus zero', () => {
  const valid = emptyState();
  valid.budgets.flights = 0;
  valid.budgets.bkkhotel = '';
  valid.checks.sun1 = false;
  valid.packingStates.rash = 'not_needed';
  assert.equal(validateState(valid), true);
  assert.equal(validateState({ ...valid, token: 'unexpected' }), false);
  assert.equal(validateState({ ...valid, budgets: { flights: null } }), false);
  assert.equal(validateState({ ...valid, budgets: { flights: -1 } }), false);
  assert.equal(validateState({ ...valid, budgets: { flights: '100' } }), false);
  assert.equal(validateState({ ...valid, checks: { unknown: true } }), false);
  assert.equal(validateState({ ...valid, notes: { food: 'x'.repeat(5001) } }), false);
  assert.equal(validateState(JSON.parse('{"checks":{"__proto__":true},"packingStates":{},"notes":{},"budgets":{}}')), false);
});

test('SQLite revision comparison prevents an old device overwriting newer data', async () => {
  const { DB, request } = fixture();
  const first = await (await request()).json();
  const next = emptyState(); next.checks.sun1 = true;
  const saved = await (await request('PUT', { revision: first.revision, state: next })).json();
  assert.equal(saved.revision, 1);
  const stale = await request('PUT', { revision: 0, state: emptyState() });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).latest.state.checks.sun1, true);
  assert.equal((await (await request()).json()).state.checks.sun1, true);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM trip_history').get().n, 1);
  DB.sqlite.close();
});

test('history is bounded and malformed or oversized requests do not write', async () => {
  const { DB, request } = fixture();
  for (let revision = 0; revision < 35; revision++) assert.equal((await request('PUT', { revision, state: emptyState() })).status, 200);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM trip_history').get().n, 30);
  assert.equal((await request('PUT', { revision: 35, state: { notes: 'invalid' } })).status, 400);
  assert.equal((await request('PUT', { revision: 35, state: emptyState(), junk: 'x'.repeat(65000) })).status, 400);
  assert.equal((await (await request()).json()).revision, 35);
  DB.sqlite.close();
});

test('different edits merge; same-field collisions require a choice', () => {
  const base = emptyState(), a = emptyState(), b = emptyState();
  a.checks.sun1 = true; b.budgets.flights = 0;
  const merged = mergeStates(base, a, b);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.merged.checks.sun1, true);
  assert.equal(merged.merged.budgets.flights, 0);
  a.notes.food = 'phone'; b.notes.food = 'computer';
  const conflict = mergeStates(base, a, b);
  assert.deepEqual(conflict.conflicts, [{ group: 'notes', key: 'food', local: 'phone', remote: 'computer' }]);
  assert.equal(conflict.merged.notes.food, 'phone');
});

test('lost acknowledgement and edits during an upload retain the latest input', () => {
  const base = emptyState(), sent = emptyState(), later = emptyState();
  sent.notes.food = 'first'; later.notes.food = 'second';
  assert.equal(mergeStates(sent, later, sent).merged.notes.food, 'second');
  assert.equal(mergeStates(base, sent, sent).conflicts.length, 0);
  assert.equal(same(mergeStates(base, sent, sent).merged, sent), true);
});
