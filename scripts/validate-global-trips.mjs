import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'global-trips/data/trips.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.schemaVersion === 1, 'trips.json schemaVersion must be 1');
assert(Array.isArray(manifest.trips) && manifest.trips.length > 0, 'trips.json must contain trips');

const ids = new Set();
const sensitive = /(chatgpt\.com\/|passport\s*(number|no)|身份证号|护照号\s*[:：]\s*[A-Z0-9]{5,}|confirmation\s*(number|no|id)|保单号\s*[:：]\s*[A-Z0-9]{4,}|token\s*[:=]|cookie\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=])/i;

for (const entry of manifest.trips) {
  assert(typeof entry.id === 'string' && entry.id.length > 0, 'trip id is required');
  assert(!ids.has(entry.id), `duplicate trip id: ${entry.id}`);
  ids.add(entry.id);
  assert(entry.path === `./trips/${entry.id}/`, `manifest path mismatch for ${entry.id}`);

  const file = path.join(root, 'global-trips/trips', entry.id, 'trip.json');
  assert(fs.existsSync(file), `missing trip.json for ${entry.id}`);
  const raw = fs.readFileSync(file, 'utf8');
  assert(!sensitive.test(raw), `sensitive or private reference detected in ${entry.id}`);
  const trip = JSON.parse(raw);
  assert(trip.schemaVersion === 1, `${entry.id}: schemaVersion must be 1`);
  assert(trip.id === entry.id, `${entry.id}: id mismatch`);
  assert(['planning', 'live', 'memory'].includes(trip.status), `${entry.id}: invalid status`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(trip.dates?.start || ''), `${entry.id}: invalid start date`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(trip.dates?.end || ''), `${entry.id}: invalid end date`);
  assert(Array.isArray(trip.route) && trip.route.length >= 2, `${entry.id}: route is required`);
  assert(Array.isArray(trip.itinerary) && trip.itinerary.length > 0, `${entry.id}: itinerary is required`);
  assert(Array.isArray(trip.packing) && trip.packing.length > 0, `${entry.id}: packing is required`);
  assert(Array.isArray(trip.todos), `${entry.id}: todos must be an array`);
  assert(Array.isArray(trip.budget?.items), `${entry.id}: budget items are required`);
  assert(Array.isArray(trip.memoryPrompts), `${entry.id}: memory prompts are required`);

  const keys = [
    ...trip.packing.flatMap(group => group.items.map(item => item.key)),
    ...trip.todos.flatMap(group => group.items.map(item => item.key))
  ];
  assert(keys.length === new Set(keys).size, `${entry.id}: duplicate checklist key`);
}

console.log(`GLOBAL_TRIPS_VALID trips=${manifest.trips.length}`);
