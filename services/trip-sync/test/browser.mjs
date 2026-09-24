// Runs only against an in-memory local database and isolated browser profiles.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import worker, { sha256 } from '../src/worker.mjs';
import { testDatabase } from './database.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const results = fileURLToPath(new URL('../test-results/', import.meta.url));
await fs.mkdir(results, { recursive: true });
const key = `jt_${randomBytes(32).toString('base64url')}`;
const DB = testDatabase();
let origin;
const env = { DB, OWNER_KEY_HASH: await sha256(key), ALLOWED_ORIGINS: '' };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/v1/') || url.pathname === '/health') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const reply = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
      res.writeHead(reply.status, Object.fromEntries(reply.headers)); res.end(await reply.text()); return;
    }
    if (url.pathname === '/global-trips/cloud-config.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ apiBase: origin })); return; }
    if (!url.pathname.startsWith('/global-trips/')) { res.writeHead(404); res.end(); return; }
    const file = path.resolve(root, `.${url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname}`);
    if (!file.startsWith(path.join(root, 'global-trips') + path.sep)) { res.writeHead(403); res.end(); return; }
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(500); res.end('test server error'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
env.ALLOWED_ORIGINS = origin;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const url = `${origin}/global-trips/trips/2026-maldives-bangkok/`;
const checks = [];
const errors = [];
const waitSaved = page => page.waitForFunction(() => document.querySelector('#cloudBar').dataset.status === 'saved');
const waitError = page => page.waitForFunction(() => document.querySelector('#cloudBar').dataset.status === 'error');
async function pageIn(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  return { context, page };
}
async function login(page) {
  await page.locator('#cloudLoginPanel summary').click();
  await page.getByLabel('旅行登录码', { exact: true }).fill(key);
  await page.locator('#cloudLogin').click();
  await waitSaved(page);
}
async function panel(page, name) { await page.locator(`.plan-tab[data-panel="${name}"]`).click(); }
try {
  const { page: phone } = await pageIn({ width: 390, height: 844 });
  assert.equal(await phone.locator('select[data-packing-status="sun1"]').isDisabled(), true);
  await login(phone);
  assert.equal(await phone.locator('#prepTimeline .prep-row').count(), 6);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: path.join(results, 'preparation-mobile.png') });
  await panel(phone, 'packing');
  await phone.locator('select[data-packing-status="prep-adapter"]').selectOption('not_needed');
  await phone.locator('input[data-key="prep-imuga"]').check();
  await waitSaved(phone);
  await phone.locator('select[data-packing-status="sun1"]').selectOption('bought');
  await phone.locator('#packingGroups input[data-key="sun1"]').check();
  await waitSaved(phone);
  await panel(phone, 'budget');
  await phone.locator('[data-budget="flights"]').fill('1234.56');
  await waitSaved(phone);
  await panel(phone, 'memories');
  await phone.locator('[data-note="food"]').fill('本地测试：手机记录');
  await waitSaved(phone);
  checks.push('phone edits saved through authenticated API');

  const { page: desktop } = await pageIn({ width: 1280, height: 900 });
  await login(desktop);
  assert.equal(await desktop.locator('select[data-packing-status="prep-adapter"]').inputValue(), 'not_needed');
  assert.equal(await desktop.locator('input[data-key="prep-imuga"]').isChecked(), true);
  checks.push('new preparation keys sync to second device without replacing existing state');
  assert.equal(await desktop.locator('select[data-packing-status="sun1"]').inputValue(), 'bought');
  assert.equal(await desktop.locator('[data-budget="flights"]').inputValue(), '1234.56');
  assert.equal(await desktop.locator('[data-note="food"]').inputValue(), '本地测试：手机记录');
  await desktop.reload(); await waitSaved(desktop);
  assert.equal(await desktop.locator('#packingGroups input[data-key="sun1"]').isChecked(), true);
  checks.push('independent desktop profile and reload read cloud values');

  await phone.route('**/v1/trips/**', route => route.abort());
  await panel(phone, 'packing');
  await phone.locator('select[data-packing-status="sun1"]').selectOption('owned');
  await waitError(phone);
  await panel(desktop, 'packing');
  await desktop.locator('select[data-packing-status="sun1"]').selectOption('optional');
  await waitSaved(desktop);
  await phone.unroute('**/v1/trips/**');
  await phone.locator('#cloudRefresh').click();
  await phone.locator('#cloudConflict').waitFor({ state: 'visible' });
  await phone.reload();
  await phone.locator('#cloudConflict').waitFor({ state: 'visible' });
  await phone.locator('#cloudUseLocal').click();
  await waitSaved(phone);
  await desktop.locator('#cloudRefresh').click(); await waitSaved(desktop);
  assert.equal(await desktop.locator('select[data-packing-status="sun1"]').inputValue(), 'owned');
  checks.push('same-field conflict survives reload and needs explicit resolution');

  await phone.route('**/v1/trips/**', route => route.abort());
  await panel(phone, 'memories');
  await phone.locator('[data-note="food"]').fill('本地测试：断网修改保留');
  await waitError(phone);
  await phone.reload(); await waitError(phone);
  assert.equal(await phone.locator('[data-note="food"]').inputValue(), '本地测试：断网修改保留');
  await phone.unroute('**/v1/trips/**');
  await phone.locator('#cloudRefresh').click(); await waitSaved(phone);
  await desktop.locator('#cloudRefresh').click(); await waitSaved(desktop);
  assert.equal(await desktop.locator('[data-note="food"]').inputValue(), '本地测试：断网修改保留');
  checks.push('offline edit survives reload and reaches second device after retry');

  const legacyContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await legacyContext.addInitScript(() => localStorage.setItem('jtqx-global-trips-v01', JSON.stringify({ checks: { sun1: true }, budgets: { flights: 888 }, notes: { food: '本地测试：旧浏览器记录' } })));
  const legacy = await legacyContext.newPage();
  await legacy.goto(url); await login(legacy);
  let importPrompt = '';
  legacy.on('dialog', async dialog => { importPrompt = dialog.message(); await dialog.accept(); });
  await legacy.locator('#cloudImport').click(); await waitSaved(legacy);
  assert.match(importPrompt, /替换云端内容/);
  assert.equal(await legacy.locator('[data-budget="flights"]').inputValue(), '888');
  assert.equal(await legacy.locator('[data-note="food"]').inputValue(), '本地测试：旧浏览器记录');
  checks.push('legacy import previews overwrites and persists only after confirmation');

  await panel(phone, 'packing');
  await phone.locator('.mobile-nav [data-panel="packing"]').click();
  await phone.screenshot({ path: path.join(results, 'mobile.png') });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await panel(desktop, 'budget');
  await desktop.screenshot({ path: path.join(results, 'desktop.png') });
  assert.deepEqual(errors, []);
  checks.push('390px mobile layout and desktop render without page errors');
  await fs.writeFile(path.join(results, 'browser-result.json'), JSON.stringify({ passed: checks, pageErrors: errors }, null, 2));
  console.log(`TRIP_CLOUD_BROWSER_PASS ${checks.length} scenarios`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  DB.sqlite.close();
}
