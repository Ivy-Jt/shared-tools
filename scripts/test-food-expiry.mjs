import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../food-radar/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const purchases = JSON.parse(fs.readFileSync(new URL('../food-radar/purchases.json', import.meta.url)));
// Use representative cards with fixed dates so future data updates do not change this regression.
purchases.items = purchases.items.slice(0, 3).map((item, index) => ({
  ...item, validUntil: index === 0 ? '2026-10-03' : '2026-10-07',
  confirmedStores: item.confirmedStores.slice(0, 1)
}));
const original = JSON.stringify(purchases);

async function harness(instant, withMap = true) {
  let now = Date.parse(instant), serial = 0, created = 0, removed = 0, markers = 0;
  const timers = new Map(), nodes = new Map(), events = {};
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', hidden: false, classList: { add() {} }, querySelector: child => node(`${key} ${child}`) });
    return nodes.get(key);
  };
  const listen = (type, fn) => { events[type] = fn; };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const window = { addEventListener: listen };
  if (withMap) window.L = {
    map() { created++; markers = 0; return { remove() { removed++; markers = 0; }, setView() {}, fitBounds() {} }; },
    tileLayer() { return { addTo() {} }; },
    circleMarker() { markers++; return { addTo() { return this; }, bindPopup() {} }; }
  };
  vm.runInNewContext(script, {
    Date: ClockDate, Intl, URL, window, location: { href: 'https://example.test/food-radar/' },
    document: { hidden: false, querySelector: node, addEventListener: listen },
    fetch: async () => ({ ok: true, json: async () => purchases }),
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  await new Promise(resolve => setImmediate(resolve));
  return {
    node, timers,
    stats: () => ({ created, removed, markers }),
    jump(instant, event) { now = Date.parse(instant); if (event) events[event](); },
    tick() { const [id, timer] = [...timers][0]; timers.delete(id); now = timer.at; timer.fn(); }
  };
}
const page = await harness('2026-10-03T15:59:59Z'); // 23:59:59 in Shanghai, regardless of host timezone.
assert.equal(page.node('#quick-purchase-count').textContent, '（3）');
assert.match(page.node('#purchase-planner').innerHTML, /今天到期/);
assert.equal(page.stats().markers, 3);
page.tick();
assert.equal(page.node('#quick-purchase-count').textContent, '（2）');
assert.equal(page.stats().markers, 2);
assert.deepEqual(page.stats(), { created: 2, removed: 1, markers: 2 });
assert.equal(page.timers.size, 1);
page.jump('2026-10-08T00:00:00+08:00', 'visibilitychange');
assert.equal(page.node('#quick-purchase-count').textContent, '（0）');
assert.equal(page.node('#purchase-planner').hidden, true);
assert.equal(page.node('#purchase-planner').innerHTML, '');
assert.match(page.node('#sections').innerHTML, /当前没有已确认仍可使用/);
assert.equal(page.stats().removed, 2);
for (const event of ['focus', 'pageshow']) {
  const resumed = await harness('2026-10-03T23:59:59+08:00');
  resumed.jump('2026-10-04T00:00:00+08:00', event);
  assert.equal(resumed.node('#quick-purchase-count').textContent, '（2）');
  resumed.jump('2026-10-04T12:00:00+08:00', event);
  assert.equal(resumed.stats().created, 2, 'same-day focus should preserve the map');
  assert.equal(resumed.timers.size, 1);
}
const empty = await harness('2026-10-08T00:00:00+08:00');
assert.equal(empty.node('#quick-purchase-count').textContent, '（0）');
const offlineMap = await harness('2026-10-03T23:59:59+08:00', false);
offlineMap.tick();
assert.equal(offlineMap.node('#quick-purchase-count').textContent, '（2）');
assert.equal(JSON.stringify(purchases), original, 'history must remain intact');
console.log('FOOD_EXPIRY_PASS: Shanghai midnight, inclusive expiry day, resumed tabs, map cleanup, empty state, unavailable map, unchanged history');
