#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "food-radar", "latest.json");
const data = JSON.parse(await readFile(DATA_PATH, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(data.schemaVersion === 2, "schemaVersion must be 2");
assert(data.city === "武汉", "city must be 武汉");
assert(data.referenceRadiusKm === 3, "referenceRadiusKm must be 3");
assert(Number.isFinite(Date.parse(data.generatedAt)), "generatedAt must be an ISO date");
assert(Array.isArray(data.items), "items must be an array");
assert(data.items.length <= 11, "items exceed the 5 + 3 + 3 publication limit");

const kinds = new Set(["pass_free_trial", "lv_store_gift", "orange_v_paid"]);
const sourceIds = new Set();
const counts = { pass_free_trial: 0, lv_store_gift: 0, orange_v_paid: 0 };

for (const item of data.items) {
  assert(kinds.has(item.kind), `unknown kind: ${item.kind}`);
  assert(item.availability === "available", `unavailable item published: ${item.sourceId}`);
  assert(typeof item.sourceId === "string" && item.sourceId.length > 0, "missing sourceId");
  assert(!sourceIds.has(`${item.kind}:${item.sourceId}`), `duplicate sourceId: ${item.sourceId}`);
  sourceIds.add(`${item.kind}:${item.sourceId}`);
  counts[item.kind] += 1;

  const detailUrl = new URL(item.detailUrl);
  assert(detailUrl.protocol === "https:", `non-HTTPS detailUrl: ${item.sourceId}`);
  assert(Number.isFinite(Date.parse(item.verifiedAt)), `invalid verifiedAt: ${item.sourceId}`);
  if (item.score != null) assert(item.score >= 0 && item.score <= 5, `invalid score: ${item.sourceId}`);

  if (item.kind === "pass_free_trial") {
    assert(item.passSupported === true, `PASS support not verified: ${item.sourceId}`);
    assert(Number.isInteger(item.passRemaining) && item.passRemaining > 0, `no PASS remaining: ${item.sourceId}`);
    assert(Number.isInteger(item.passCapacity) && item.passCapacity >= item.passRemaining, `invalid PASS capacity: ${item.sourceId}`);
  }
  if (item.kind === "lv_store_gift") {
    assert(item.minLevel >= 6, `LV gift below LV6: ${item.sourceId}`);
    assert(item.noThreshold === true, `LV gift has an unverified threshold: ${item.sourceId}`);
    assert(item.claimableVerified === true, `LV gift claimability not verified: ${item.sourceId}`);
  }
  if (item.kind === "orange_v_paid") {
    assert(item.orangeVPriceVerified === true, `Orange V price not verified: ${item.sourceId}`);
    assert(Number.isFinite(item.priceCny) && item.priceCny > 0, `invalid Orange V price: ${item.sourceId}`);
  }
}

assert(counts.pass_free_trial <= 5, "more than 5 PASS items");
assert(counts.lv_store_gift <= 3, "more than 3 LV gifts");
assert(counts.orange_v_paid <= 3, "more than 3 paid Orange V items");

const statuses = new Set(["ok", "login_required", "app_required", "no_match", "error"]);
for (const source of Object.values(data.sources || {})) {
  assert(statuses.has(source.status), `unknown source status: ${source.status}`);
}

const serialized = JSON.stringify(data);
const privatePatterns = [
  /"(?:latitude|longitude|token|cookie|dpid|accountId|userId)"\s*:/i,
  /(?:^|\D)30\.\d{4,}(?:\D|$)/,
  /(?:^|\D)114\.\d{4,}(?:\D|$)/,
];
assert(!privatePatterns.some(pattern => pattern.test(serialized)), "private coordinate or account field detected");

console.log(`RADAR_VALID pass=${counts.pass_free_trial} gift=${counts.lv_store_gift} paid=${counts.orange_v_paid}`);
