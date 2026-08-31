#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "food-radar", "latest.json");
const PURCHASES_PATH = path.join(ROOT, "food-radar", "purchases.json");
const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const purchases = JSON.parse(await readFile(PURCHASES_PATH, "utf8"));

const SOURCE_BY_KIND = {
  pass_free_trial: "passFreeTrial",
};
const SUMMARY_BY_KIND = {
  pass_free_trial: "passFreeTrial",
};
const LIMIT_BY_KIND = { pass_free_trial: 5 };
const SOURCE_KEYS = ["passFreeTrial"];
const SOURCE_STATUSES = new Set(["ok", "login_required", "app_required", "no_match", "error"]);
const PURCHASE_SOURCE_STATUSES = new Set(["pending_sync", "ok", "no_match"]);
const SENSITIVE_QUERY_KEYS = new Set([
  "accountid", "cookie", "dpid", "lat", "latitude", "lng", "longitude",
  "encctx", "isshare", "notitlebar", "openid", "session", "sharecampaignid",
  "shareid", "token", "utm_source", "userid",
]);
const REQUIRED_TEXT_FIELDS = [
  "sourceId", "title", "shop", "branch", "area", "distanceLabel", "reason",
  "deadline", "useWindow", "restrictions", "menuSummary", "detailUrl", "verifiedAt",
];
const REQUIRED_PURCHASE_TEXT_FIELDS = [
  "sourceId", "title", "shop", "branch", "area", "platform", "platformLabel",
  "reason", "validUntil", "useWindow", "restrictions", "menuSummary", "verifiedAt",
];
const MAX_SCAN_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_VERIFICATION_SKEW_MS = 60 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseDate(value, label) {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} must be an ISO date`);
  return parsed;
}

function validateDetailUrl(item) {
  const url = new URL(item.detailUrl);
  assert(url.protocol === "https:", `non-HTTPS detailUrl: ${item.sourceId}`);
  assert(url.username === "" && url.password === "", `credentials in detailUrl: ${item.sourceId}`);
  for (const key of url.searchParams.keys()) {
    assert(!SENSITIVE_QUERY_KEYS.has(key.toLowerCase()), `sensitive query key ${key}: ${item.sourceId}`);
  }

  if (item.kind === "pass_free_trial") {
    assert(url.hostname === "h5.dianping.com", `unexpected PASS host: ${item.sourceId}`);
    assert(url.pathname === "/app/app-community-free-meal/detail.html", `unexpected PASS path: ${item.sourceId}`);
    assert(url.searchParams.get("offlineActivityId") === item.sourceId, `PASS sourceId mismatch: ${item.sourceId}`);
    const allowed = new Set(["offlineActivityId", "busiType"]);
    assert([...url.searchParams.keys()].every(key => allowed.has(key)), `unexpected PASS query: ${item.sourceId}`);
  }
}

function validatePurchaseUrl(item) {
  const url = new URL(item.detailUrl);
  const allowedHosts = item.platform === "dianping"
    ? new Set(["h5.dianping.com", "m.dianping.com", "t.dianping.com", "www.dianping.com"])
    : new Set(["life.douyin.com", "v.douyin.com", "www.douyin.com"]);
  assert(url.protocol === "https:", `non-HTTPS purchase detailUrl: ${item.sourceId}`);
  assert(allowedHosts.has(url.hostname), `unexpected ${item.platform} purchase host: ${item.sourceId}`);
  assert(url.username === "" && url.password === "", `credentials in purchase detailUrl: ${item.sourceId}`);
  assert(!/(?:order|coupon|voucher|ticket|user)/i.test(url.pathname), `account-specific purchase path: ${item.sourceId}`);
  assert([...url.searchParams.keys()].length === 0, `purchase detailUrl must not contain query parameters: ${item.sourceId}`);
}

assert(data.schemaVersion === 3, "schemaVersion must be 3");
assert(data.city === "武汉", "city must be 武汉");
assert(data.referenceRadiusKm === 3, "referenceRadiusKm must be 3");
const generatedAtMs = parseDate(data.generatedAt, "generatedAt");
assert(Date.now() - generatedAtMs <= MAX_SCAN_AGE_MS, "generatedAt is older than 6 hours");
assert(generatedAtMs - Date.now() <= 5 * 60 * 1000, "generatedAt is unexpectedly in the future");
assert(Array.isArray(data.items), "items must be an array");
assert(data.items.length <= 5, "items exceed the PASS publication limit");

const actualSourceKeys = Object.keys(data.sources || {}).sort();
assert(JSON.stringify(actualSourceKeys) === JSON.stringify(SOURCE_KEYS), "sources must contain exactly the PASS radar source");
for (const [sourceKey, source] of Object.entries(data.sources)) {
  assert(SOURCE_STATUSES.has(source.status), `unknown source status: ${source.status}`);
  const sourceCheckedAtMs = parseDate(source.checkedAt, `${sourceKey}.checkedAt`);
  assert(Math.abs(sourceCheckedAtMs - generatedAtMs) <= MAX_VERIFICATION_SKEW_MS, `${sourceKey} check is stale`);
  if (source.status === "ok" || source.status === "no_match") {
    const sourceVerifiedAtMs = parseDate(source.verifiedAt, `${sourceKey}.verifiedAt`);
    assert(Math.abs(sourceVerifiedAtMs - generatedAtMs) <= MAX_VERIFICATION_SKEW_MS, `${sourceKey} verification is stale`);
  } else {
    assert(source.verifiedAt === null, `${sourceKey}.verifiedAt must be null when source is not fully verified`);
  }
}

const sourceIds = new Set();
const counts = { pass_free_trial: 0 };
const itemsByKind = { pass_free_trial: [] };

for (const item of data.items) {
  assert(Object.hasOwn(SOURCE_BY_KIND, item.kind), `unknown kind: ${item.kind}`);
  assert(data.sources[SOURCE_BY_KIND[item.kind]].status === "ok", `item published from non-ok source: ${item.sourceId}`);
  assert(item.availability === "available", `unavailable item published: ${item.sourceId}`);
  for (const field of REQUIRED_TEXT_FIELDS) {
    assert(typeof item[field] === "string" && item[field].trim().length > 0, `missing ${field}: ${item.sourceId || "unknown"}`);
  }
  assert(!sourceIds.has(`${item.kind}:${item.sourceId}`), `duplicate sourceId: ${item.sourceId}`);
  sourceIds.add(`${item.kind}:${item.sourceId}`);
  counts[item.kind] += 1;
  itemsByKind[item.kind].push(item);

  assert(Number.isFinite(item.distanceKm) && item.distanceKm >= 0, `invalid distanceKm: ${item.sourceId}`);
  assert(Number.isInteger(item.priorityRank) && item.priorityRank > 0, `invalid priorityRank: ${item.sourceId}`);
  const itemVerifiedAtMs = parseDate(item.verifiedAt, `${item.sourceId}.verifiedAt`);
  assert(Math.abs(itemVerifiedAtMs - generatedAtMs) <= MAX_VERIFICATION_SKEW_MS, `stale item verification: ${item.sourceId}`);
  assert(Object.hasOwn(item, "score"), `missing score: ${item.sourceId}`);
  if (item.score != null) assert(Number.isFinite(item.score) && item.score >= 0 && item.score <= 5, `invalid score: ${item.sourceId}`);
  assert(item.menuSummary.length <= 180, `menuSummary is too long: ${item.sourceId}`);
  assert(!/[*?？]/.test(item.menuSummary), `masked or uncertain menuSummary: ${item.sourceId}`);
  validateDetailUrl(item);

  if (item.kind === "pass_free_trial") {
    assert(item.passSupported === true, `PASS support not verified: ${item.sourceId}`);
    assert(Number.isInteger(item.passRemaining) && item.passRemaining > 0, `no PASS remaining: ${item.sourceId}`);
    assert(Number.isInteger(item.passCapacity) && item.passCapacity >= item.passRemaining, `invalid PASS capacity: ${item.sourceId}`);
    const deadlineMs = Date.parse(`${item.deadline.replace(" ", "T")}+08:00`);
    assert(Number.isFinite(deadlineMs) && deadlineMs > generatedAtMs, `expired PASS activity: ${item.sourceId}`);
  }
}

for (const kind of Object.keys(counts)) {
  assert(counts[kind] <= LIMIT_BY_KIND[kind], `too many ${kind} items`);
  const sourceStatus = data.sources[SOURCE_BY_KIND[kind]].status;
  if (sourceStatus === "ok") assert(counts[kind] > 0, `ok source has no published items: ${kind}`);
  else assert(counts[kind] === 0, `non-ok source has published items: ${kind}`);
  const expectedCount = data.summary?.counts?.[SUMMARY_BY_KIND[kind]];
  assert(expectedCount === counts[kind], `summary count mismatch for ${kind}`);
  const ranked = itemsByKind[kind].slice().sort((a, b) => a.priorityRank - b.priorityRank);
  assert(ranked.every((item, index) => item.priorityRank === index + 1), `priorityRank must be sequential for ${kind}`);
  let passedNearBand = false;
  for (const item of ranked) {
    if (item.distanceKm > data.referenceRadiusKm) passedNearBand = true;
    else assert(!passedNearBand, `item within ${data.referenceRadiusKm} km ranked after a farther item: ${item.sourceId}`);
  }
}

assert(purchases.schemaVersion === 1, "purchases.schemaVersion must be 1");
parseDate(purchases.updatedAt, "purchases.updatedAt");
const purchaseSourceKeys = Object.keys(purchases.sources || {}).sort();
assert(JSON.stringify(purchaseSourceKeys) === JSON.stringify(["purchasedDeals"]), "purchases must contain exactly purchasedDeals source");
const purchaseSource = purchases.sources.purchasedDeals;
assert(PURCHASE_SOURCE_STATUSES.has(purchaseSource.status), `unknown purchase source status: ${purchaseSource.status}`);
assert(Array.isArray(purchases.items), "purchases.items must be an array");
assert(purchases.items.length <= 50, "purchases.items exceeds the public inventory limit");

if (purchaseSource.status === "pending_sync") {
  assert(purchaseSource.checkedAt === null && purchaseSource.verifiedAt === null, "pending purchase sync must not claim verification");
  assert(purchases.items.length === 0, "pending purchase sync must not publish items");
} else {
  parseDate(purchaseSource.checkedAt, "purchasedDeals.checkedAt");
  parseDate(purchaseSource.verifiedAt, "purchasedDeals.verifiedAt");
  if (purchaseSource.status === "ok") assert(purchases.items.length > 0, "ok purchase source has no items");
  else assert(purchases.items.length === 0, "no_match purchase source has items");
}

const purchaseIds = new Set();
for (const item of purchases.items) {
  assert(item.kind === "purchased_deal", `unknown purchase kind: ${item.kind}`);
  assert(item.availability === "unexpired_order", `purchase is not an unexpired order: ${item.sourceId}`);
  for (const field of REQUIRED_PURCHASE_TEXT_FIELDS) {
    assert(typeof item[field] === "string" && item[field].trim().length > 0, `missing purchase ${field}: ${item.sourceId || "unknown"}`);
  }
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/.test(item.sourceId), `unsafe purchase sourceId: ${item.sourceId}`);
  assert(!purchaseIds.has(item.sourceId), `duplicate purchase sourceId: ${item.sourceId}`);
  purchaseIds.add(item.sourceId);
  assert(["dianping", "douyin"].includes(item.platform), `unknown purchase platform: ${item.sourceId}`);
  assert(Number.isInteger(item.priorityRank) && item.priorityRank > 0, `invalid purchase priorityRank: ${item.sourceId}`);
  assert(Number.isFinite(item.purchasePriceCny) && item.purchasePriceCny > 0, `invalid actual purchase price: ${item.sourceId}`);
  if (item.comparisonPriceCny != null) {
    assert(Number.isFinite(item.comparisonPriceCny) && item.comparisonPriceCny >= item.purchasePriceCny, `invalid purchase comparison price: ${item.sourceId}`);
  }
  if (item.savedCny != null) {
    assert(item.comparisonPriceCny != null, `purchase savings without comparison price: ${item.sourceId}`);
    assert(Number.isFinite(item.savedCny) && Math.abs(item.savedCny - (item.comparisonPriceCny - item.purchasePriceCny)) < 0.01, `invalid purchase savings: ${item.sourceId}`);
  }
  assert(Object.hasOwn(item, "score"), `missing purchase score: ${item.sourceId}`);
  if (item.score != null) assert(Number.isFinite(item.score) && item.score >= 0 && item.score <= 5, `invalid purchase score: ${item.sourceId}`);
  assert(item.menuSummary.length <= 180, `purchase menuSummary is too long: ${item.sourceId}`);
  assert(!/[*?？]/.test(item.menuSummary), `masked or uncertain purchase menuSummary: ${item.sourceId}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(item.validUntil), `purchase validUntil must be YYYY-MM-DD: ${item.sourceId}`);
  const validUntilMs = Date.parse(`${item.validUntil}T23:59:59+08:00`);
  assert(Number.isFinite(validUntilMs), `purchase validUntil must be a valid date: ${item.sourceId}`);
  parseDate(item.verifiedAt, `${item.sourceId}.verifiedAt`);
  if (item.detailUrl != null) {
    assert(typeof item.detailUrl === "string" && item.detailUrl.trim().length > 0, `invalid purchase detailUrl: ${item.sourceId}`);
    validatePurchaseUrl(item);
  }
}
const rankedPurchases = purchases.items.slice().sort((a, b) => a.priorityRank - b.priorityRank);
assert(rankedPurchases.every((item, index) => item.priorityRank === index + 1), "purchase priorityRank must be sequential");
assert(purchases.summary?.count === purchases.items.length, "purchase summary count mismatch");

const serialized = JSON.stringify({ data, purchases });
const privatePatterns = [
  /"(?:latitude|longitude|token|cookie|dpid|accountId|userId|orderId|couponCode|voucherCode|phone|mobile)"\s*:/i,
  /(?:token|cookie|latitude|longitude|dpid|userid)(?:=|%3d)/i,
  /(?:encctx|isshare|notitlebar|sharecampaignid|shareid|utm_source)(?:=|%3d)/i,
  /(?:^|\D)30\.\d{4,}(?:\D|$)/,
  /(?:^|\D)114\.\d{4,}(?:\D|$)/,
];
assert(!privatePatterns.some(pattern => pattern.test(serialized)), "private coordinate or account data detected");

console.log(`RADAR_VALID pass=${counts.pass_free_trial} purchases=${purchases.items.length} purchase_status=${purchaseSource.status}`);
