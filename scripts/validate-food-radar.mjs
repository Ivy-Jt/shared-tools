#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "food-radar", "latest.json");
const data = JSON.parse(await readFile(DATA_PATH, "utf8"));

const SOURCE_BY_KIND = {
  pass_free_trial: "passFreeTrial",
  lv_store_gift: "lvStoreGift",
  orange_v_paid: "orangeVPaid",
};
const SUMMARY_BY_KIND = {
  pass_free_trial: "passFreeTrial",
  lv_store_gift: "lvStoreGift",
  orange_v_paid: "orangeVPaid",
};
const LIMIT_BY_KIND = { pass_free_trial: 5, lv_store_gift: 3, orange_v_paid: 3 };
const SOURCE_KEYS = ["lvStoreGift", "orangeVPaid", "passFreeTrial"];
const SOURCE_STATUSES = new Set(["ok", "login_required", "app_required", "no_match", "error"]);
const SENSITIVE_QUERY_KEYS = new Set([
  "accountid", "cookie", "dpid", "lat", "latitude", "lng", "longitude",
  "encctx", "isshare", "notitlebar", "openid", "session", "sharecampaignid",
  "shareid", "token", "utm_source", "userid",
]);
const REQUIRED_TEXT_FIELDS = [
  "sourceId", "title", "shop", "branch", "area", "distanceLabel", "reason",
  "deadline", "useWindow", "restrictions", "menuSummary", "detailUrl", "verifiedAt",
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
  } else if (item.kind === "lv_store_gift") {
    assert(url.hostname === "pmtmeishi.meituan.com", `unexpected LV gift host: ${item.sourceId}`);
    assert(new RegExp(`^/dp/prefer/list/${item.sourceId}$`).test(url.pathname), `unexpected LV gift path: ${item.sourceId}`);
    assert([...url.searchParams.keys()].length === 0, `LV gift link must be sanitized: ${item.sourceId}`);
  } else {
    assert(["m.dianping.com", "t.dianping.com"].includes(url.hostname), `unexpected Orange V host: ${item.sourceId}`);
    const isActivityPage = url.hostname === "m.dianping.com" && url.pathname === "/app/femember-groupbuyinter-static/main.html";
    if (isActivityPage) {
      assert(/^\d+$/.test(item.sourceId), `Orange V activityId must be numeric: ${item.sourceId}`);
      assert(url.searchParams.get("activityid") === item.sourceId, `Orange V activityId mismatch: ${item.sourceId}`);
      assert([...url.searchParams.keys()].every(key => key === "activityid"), `unexpected Orange V activity query: ${item.sourceId}`);
    } else {
      assert(/^\/(?:shop|deal)\/[A-Za-z0-9_-]+$/.test(url.pathname), `unexpected Orange V path: ${item.sourceId}`);
      assert([...url.searchParams.keys()].length === 0, `Orange V link must be sanitized: ${item.sourceId}`);
    }
  }
}

assert(data.schemaVersion === 2, "schemaVersion must be 2");
assert(data.city === "武汉", "city must be 武汉");
assert(data.referenceRadiusKm === 3, "referenceRadiusKm must be 3");
const generatedAtMs = parseDate(data.generatedAt, "generatedAt");
assert(Date.now() - generatedAtMs <= MAX_SCAN_AGE_MS, "generatedAt is older than 6 hours");
assert(generatedAtMs - Date.now() <= 5 * 60 * 1000, "generatedAt is unexpectedly in the future");
assert(Array.isArray(data.items), "items must be an array");
assert(data.items.length <= 11, "items exceed the 5 + 3 + 3 publication limit");

const actualSourceKeys = Object.keys(data.sources || {}).sort();
assert(JSON.stringify(actualSourceKeys) === JSON.stringify(SOURCE_KEYS), "sources must contain exactly the three radar sources");
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
const counts = { pass_free_trial: 0, lv_store_gift: 0, orange_v_paid: 0 };
const itemsByKind = { pass_free_trial: [], lv_store_gift: [], orange_v_paid: [] };

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
  if (item.kind === "lv_store_gift") {
    assert(item.minLevel >= 6, `LV gift below LV6: ${item.sourceId}`);
    assert(item.noThreshold === true, `LV gift has an unverified threshold: ${item.sourceId}`);
    assert(item.claimableVerified === true, `LV gift claimability not verified: ${item.sourceId}`);
  }
  if (item.kind === "orange_v_paid") {
    assert(item.orangeVExclusive === true, `Orange V label not verified: ${item.sourceId}`);
    assert(item.orangeVPriceVerified === true, `Orange V price not verified: ${item.sourceId}`);
    assert(item.purchasableVerified === true, `Orange V purchase state not verified: ${item.sourceId}`);
    assert(Number.isFinite(item.priceCny) && item.priceCny > 0, `invalid Orange V price: ${item.sourceId}`);
    assert(Number.isFinite(item.comparisonPriceCny) && item.comparisonPriceCny > item.priceCny, `missing same-page comparison price: ${item.sourceId}`);
    assert(Number.isFinite(item.savedCny) && Math.abs(item.savedCny - (item.comparisonPriceCny - item.priceCny)) < 0.01, `invalid Orange V savings: ${item.sourceId}`);
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

const serialized = JSON.stringify(data);
const privatePatterns = [
  /"(?:latitude|longitude|token|cookie|dpid|accountId|userId)"\s*:/i,
  /(?:token|cookie|latitude|longitude|dpid|userid)(?:=|%3d)/i,
  /(?:encctx|isshare|notitlebar|sharecampaignid|shareid|utm_source)(?:=|%3d)/i,
  /(?:^|\D)30\.\d{4,}(?:\D|$)/,
  /(?:^|\D)114\.\d{4,}(?:\D|$)/,
];
assert(!privatePatterns.some(pattern => pattern.test(serialized)), "private coordinate or account data detected");

console.log(`RADAR_VALID pass=${counts.pass_free_trial} gift=${counts.lv_store_gift} paid=${counts.orange_v_paid}`);
