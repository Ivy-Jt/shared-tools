import trip from '../../../global-trips/trips/2026-maldives-bangkok/trip.json' with { type: 'json' };

const fieldKeys = {
  checks: new Set([...trip.packing, ...trip.todos].flatMap(group => group.items.map(item => item.key))),
  packingStates: new Set(trip.packing.flatMap(group => group.items.filter(item => item.kind !== 'task').map(item => item.key))),
  notes: new Set(trip.memoryPrompts.map(item => item.key)),
  budgets: new Set(trip.budget.items.map(item => item.key))
};
const statuses = new Set(['', 'owned', 'bought', 'to_buy', 'optional', 'not_needed']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateState(state) {
  if (!object(state) || Object.keys(state).some(key => !Object.hasOwn(fieldKeys, key))) return false;
  for (const [group, allowed] of Object.entries(fieldKeys)) {
    if (!object(state[group])) return false;
    for (const [key, value] of Object.entries(state[group])) {
      if (!allowed.has(key)) return false;
      if (group === 'checks' && typeof value !== 'boolean') return false;
      if (group === 'packingStates' && !statuses.has(value)) return false;
      if (group === 'notes' && (typeof value !== 'string' || value.length > 5000)) return false;
      if (group === 'budgets' && value !== '' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000)) return false;
    }
  }
  return true;
}

export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

function snapshot(row) {
  return { tripId: row.trip_id, revision: row.revision, state: JSON.parse(row.state_json), updatedAt: row.updated_at };
}

async function readBody(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('body');
  if (!request.body) throw new Error('body');
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64000) { await reader.cancel(); throw new Error('body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = new Set((env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()));
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !allowed.has(origin)) return respond({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
    }
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return respond({ service: 'jt-global-trips-sync', ready: Boolean(env.DB && /^[a-f0-9]{64}$/.test(env.OWNER_KEY_HASH || '')) });
    if (!env.DB || !/^[a-f0-9]{64}$/.test(env.OWNER_KEY_HASH || '')) return respond({ error: 'not_configured' }, 503);
    const match = /^Bearer (jt_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') || '');
    if (!match) return respond({ error: 'unauthorized' }, 401);
    const hash = await sha256(match[1]);
    let mismatch = 0;
    for (let i = 0; i < 64; i++) mismatch |= hash.charCodeAt(i) ^ env.OWNER_KEY_HASH.charCodeAt(i);
    if (mismatch !== 0) return respond({ error: 'unauthorized' }, 401);
    if (path !== `/v1/trips/${trip.id}`) return respond({ error: 'not_found' }, 404);
    try {
      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT * FROM trip_states WHERE trip_id = ?').bind(trip.id).first();
        return row ? respond(snapshot(row)) : respond({ error: 'not_initialized' }, 503);
      }
      if (request.method !== 'PUT') return respond({ error: 'method_not_allowed' }, 405);
      let body;
      try { body = await readBody(request); } catch { return respond({ error: 'invalid_body' }, 400); }
      if (!object(body) || !Number.isSafeInteger(body.revision) || body.revision < 0 || !validateState(body.state)) return respond({ error: 'invalid_state' }, 400);
      const row = await env.DB.prepare('UPDATE trip_states SET revision = revision + 1, state_json = ?, updated_at = ? WHERE trip_id = ? AND revision = ? RETURNING *')
        .bind(JSON.stringify(body.state), new Date().toISOString(), trip.id, body.revision).first();
      if (row) return respond(snapshot(row));
      const latest = await env.DB.prepare('SELECT * FROM trip_states WHERE trip_id = ?').bind(trip.id).first();
      return latest ? respond({ error: 'conflict', latest: snapshot(latest) }, 409) : respond({ error: 'not_initialized' }, 503);
    } catch {
      return respond({ error: 'storage_unavailable' }, 503);
    }
  }
};
