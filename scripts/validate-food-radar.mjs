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
const PURCHASE_SOURCE_STATUSES = new Set(["pending_sync", "ok", "partial", "no_match"]);
const PUBLIC_STORE_SOURCE_STATUSES = new Set(["ok", "partial", "error"]);
const PURCHASE_DEAL_TYPES = new Set(["package", "voucher", "drink", "single_dish", "buffet", "checkin_gift"]);
const PURCHASE_DETAIL_STATUSES = new Set([
  "order_only",
  "official_app_list_verified",
  "official_app_detail_verified",
  "public_store_verified",
  "official_deal_verified",
]);
const WEEKEND_POLICIES = new Set(["weekdays_only", "weekend_available", "weekend_except_saturday", "unknown"]);
const WEEKEND_RULE_SOURCES = new Set(["official_order_title", "official_deal_detail", "official_app", "user_supplied_official_capture"]);
const STORE_KEYS = ["address", "area", "branch", "lat", "lng", "shop", "sourceType"];
const CANDIDATE_STORE_KEYS = [
  "address", "area", "branch", "couponEligibility", "mapSearchUrl", "publicHours",
  "publicInfoSource", "publicInfoUrl", "relationship", "reviewCount", "score", "shop",
];
const PLANNING_LOCATION_KEYS = ["accuracy", "area", "branch", "label", "lat", "lng", "note", "shop", "sourceType", "sourceUrl"];
const PUBLIC_INFO_HOSTS = new Set(["gs.ctrip.com", "m.dianping.com", "maps.apple.com", "uri.amap.com"]);
const MAP_SEARCH_HOSTS = new Set(["maps.apple.com", "uri.amap.com"]);
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
  "sourceId", "title", "area", "platform", "platformLabel", "reason", "validUntil",
  "useWindow", "restrictions", "menuSummary", "verifiedAt", "dealType",
  "detailVerificationStatus", "weekendPolicy",
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

function validateDateKey(value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  assert(match, `${label} must be YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  assert(
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day,
    `${label} must be a real calendar date`,
  );
  return Date.UTC(year, month - 1, day);
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

function validatePublicStoreUrl(value, label, allowedHosts) {
  const url = new URL(value);
  assert(url.protocol === "https:", `non-HTTPS ${label}`);
  assert(allowedHosts.has(url.hostname), `unexpected ${label} host: ${url.hostname}`);
  assert(url.username === "" && url.password === "", `credentials in ${label}`);
  assert(url.hash === "", `fragment in ${label}`);
  for (const key of url.searchParams.keys()) {
    assert(!SENSITIVE_QUERY_KEYS.has(key.toLowerCase()), `sensitive query key ${key} in ${label}`);
  }
  const queryKeys = [...url.searchParams.keys()].sort();
  if (url.hostname === "uri.amap.com") {
    assert(url.pathname === "/search", `unexpected Amap path in ${label}`);
    assert(JSON.stringify(queryKeys) === JSON.stringify(["callnative", "city", "keyword", "src", "view"]), `unexpected Amap query in ${label}`);
    assert(url.searchParams.get("keyword")?.trim().length > 0, `missing Amap keyword in ${label}`);
    assert(url.searchParams.get("city") === "420100", `unexpected Amap city in ${label}`);
    assert(url.searchParams.get("view") === "map" && url.searchParams.get("src") === "food-radar" && url.searchParams.get("callnative") === "0", `unexpected Amap options in ${label}`);
  } else if (url.hostname === "maps.apple.com") {
    assert(url.pathname === "/place", `unexpected Apple Maps path in ${label}`);
    assert(JSON.stringify(queryKeys) === JSON.stringify(["_provider", "place-id"]), `unexpected Apple Maps query in ${label}`);
    assert(url.searchParams.get("_provider") === "57879" && /^H[A-Z0-9]+$/.test(url.searchParams.get("place-id") || ""), `invalid Apple Maps place in ${label}`);
  } else if (url.hostname === "m.dianping.com") {
    assert(/^\/shop\/\d+$/.test(url.pathname) && queryKeys.length === 0, `unexpected Dianping store URL in ${label}`);
  } else if (url.hostname === "gs.ctrip.com") {
    assert(/^\/html5\/you\/foods\/fooddetail\/\d+\/\d+\.html$/.test(url.pathname) && queryKeys.length === 0, `unexpected Ctrip store URL in ${label}`);
  }
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

assert(purchases.schemaVersion === 2, "purchases.schemaVersion must be 2");
parseDate(purchases.updatedAt, "purchases.updatedAt");
const purchaseSourceKeys = Object.keys(purchases.sources || {}).sort();
assert(JSON.stringify(purchaseSourceKeys) === JSON.stringify(["publicStores", "purchasedDeals"]), "purchases must contain purchasedDeals and publicStores sources");
const purchaseSource = purchases.sources.purchasedDeals;
assert(PURCHASE_SOURCE_STATUSES.has(purchaseSource.status), `unknown purchase source status: ${purchaseSource.status}`);
assert(typeof purchaseSource.note === "string" && purchaseSource.note.trim().length > 0, "purchasedDeals.note is required");
const publicStoreSource = purchases.sources.publicStores;
assert(PUBLIC_STORE_SOURCE_STATUSES.has(publicStoreSource.status), `unknown public store source status: ${publicStoreSource.status}`);
parseDate(publicStoreSource.checkedAt, "publicStores.checkedAt");
assert(typeof publicStoreSource.note === "string" && publicStoreSource.note.trim().length > 0, "publicStores.note is required");
if (publicStoreSource.status === "ok") parseDate(publicStoreSource.verifiedAt, "publicStores.verifiedAt");
else assert(publicStoreSource.verifiedAt === null, "non-ok publicStores.verifiedAt must be null");
assert(Array.isArray(purchases.items), "purchases.items must be an array");
assert(purchases.items.length <= 50, "purchases.items exceeds the public inventory limit");

if (purchaseSource.status === "pending_sync") {
  assert(purchaseSource.checkedAt === null && purchaseSource.verifiedAt === null, "pending purchase sync must not claim verification");
  assert(purchases.items.length === 0, "pending purchase sync must not publish items");
} else {
  parseDate(purchaseSource.checkedAt, "purchasedDeals.checkedAt");
  if (purchaseSource.status === "partial") {
    assert(purchaseSource.verifiedAt === null, "partial purchase source must not claim complete verification");
    assert(purchases.items.length > 0, "partial purchase source has no items");
  } else {
    parseDate(purchaseSource.verifiedAt, "purchasedDeals.verifiedAt");
    if (purchaseSource.status === "ok") assert(purchases.items.length > 0, "ok purchase source has no items");
    else assert(purchases.items.length === 0, "no_match purchase source has items");
  }
}

const purchaseIds = new Set();
let mappedPurchaseCount = 0;
let verifiedDetailCount = 0;
let publicCandidateStoreCount = 0;
let planningLocationCount = 0;
for (const item of purchases.items) {
  assert(item.kind === "purchased_deal", `unknown purchase kind: ${item.kind}`);
  assert(item.availability === "usable_coupon", `purchase is not verified as a usable coupon: ${item.sourceId}`);
  for (const field of REQUIRED_PURCHASE_TEXT_FIELDS) {
    assert(typeof item[field] === "string" && item[field].trim().length > 0, `missing purchase ${field}: ${item.sourceId || "unknown"}`);
  }
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/.test(item.sourceId), `unsafe purchase sourceId: ${item.sourceId}`);
  assert(!purchaseIds.has(item.sourceId), `duplicate purchase sourceId: ${item.sourceId}`);
  purchaseIds.add(item.sourceId);
  assert(["dianping", "douyin"].includes(item.platform), `unknown purchase platform: ${item.sourceId}`);
  assert(Number.isInteger(item.priorityRank) && item.priorityRank > 0, `invalid purchase priorityRank: ${item.sourceId}`);
  assert(Number.isFinite(item.purchasePriceCny) && item.purchasePriceCny > 0, `invalid actual purchase price: ${item.sourceId}`);
  assert(Number.isInteger(item.quantity) && item.quantity > 0, `invalid purchase quantity: ${item.sourceId}`);
  assert(PURCHASE_DEAL_TYPES.has(item.dealType), `unknown purchase dealType: ${item.sourceId}`);
  assert(PURCHASE_DETAIL_STATUSES.has(item.detailVerificationStatus), `unknown detailVerificationStatus: ${item.sourceId}`);
  assert(WEEKEND_POLICIES.has(item.weekendPolicy), `unknown weekendPolicy: ${item.sourceId}`);
  for (const field of ["shop", "branch"]) {
    assert(item[field] === null || (typeof item[field] === "string" && item[field].trim().length > 0), `invalid purchase ${field}: ${item.sourceId}`);
    if (typeof item[field] === "string") assert(!/(?:未公开|待补充|未知|待核验)/.test(item[field]), `placeholder purchase ${field}: ${item.sourceId}`);
  }
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
  const validUntilMs = validateDateKey(item.validUntil, `${item.sourceId}.validUntil`);
  parseDate(item.verifiedAt, `${item.sourceId}.verifiedAt`);
  const verifiedDateKey = item.verifiedAt.slice(0, 10);
  assert(validUntilMs >= validateDateKey(verifiedDateKey, `${item.sourceId}.verifiedDate`), `purchase was already expired when verified: ${item.sourceId}`);

  assert(item.weekendRuleEvidence === null || (typeof item.weekendRuleEvidence === "string" && item.weekendRuleEvidence.trim().length > 0 && item.weekendRuleEvidence.length <= 160), `invalid weekendRuleEvidence: ${item.sourceId}`);
  if (item.weekendPolicy === "unknown") {
    assert(item.weekendRuleEvidence === null, `unknown weekend policy must not claim evidence: ${item.sourceId}`);
    assert(item.weekendRuleSource == null, `unknown weekend policy must not claim a source: ${item.sourceId}`);
  } else {
    assert(typeof item.weekendRuleEvidence === "string", `verified weekend policy needs evidence: ${item.sourceId}`);
    assert(WEEKEND_RULE_SOURCES.has(item.weekendRuleSource), `invalid weekendRuleSource: ${item.sourceId}`);
  }

  assert(Array.isArray(item.eligibleStores), `eligibleStores must be an array: ${item.sourceId}`);
  assert(item.eligibleStores.length <= 30, `too many eligible stores: ${item.sourceId}`);
  const storeIds = new Set();
  for (const [index, store] of item.eligibleStores.entries()) {
    assert(store && typeof store === "object" && !Array.isArray(store), `invalid eligible store ${index}: ${item.sourceId}`);
    assert(JSON.stringify(Object.keys(store).sort()) === JSON.stringify(STORE_KEYS), `unexpected eligible store fields ${index}: ${item.sourceId}`);
    for (const field of ["shop", "branch", "area", "address"]) {
      assert(typeof store[field] === "string" && store[field].trim().length > 0, `missing store ${field}: ${item.sourceId}`);
      assert(!/(?:未公开|待补充|未知|待核验)/.test(store[field]), `placeholder store ${field}: ${item.sourceId}`);
    }
    assert(store.sourceType === "public_store", `invalid store sourceType: ${item.sourceId}`);
    assert(Number.isFinite(store.lat) && store.lat >= 29.9 && store.lat <= 31.4, `store latitude outside Wuhan boundary: ${item.sourceId}`);
    assert(Number.isFinite(store.lng) && store.lng >= 113.6 && store.lng <= 115.1, `store longitude outside Wuhan boundary: ${item.sourceId}`);
    const storeId = `${store.lat.toFixed(6)},${store.lng.toFixed(6)}`;
    assert(!storeIds.has(storeId), `duplicate eligible store: ${item.sourceId}`);
    storeIds.add(storeId);
  }
  assert(Array.isArray(item.planningLocations), `planningLocations must be an array: ${item.sourceId}`);
  assert(item.planningLocations.length <= 3, `too many planning locations: ${item.sourceId}`);
  for (const [index, location] of item.planningLocations.entries()) {
    assert(location && typeof location === "object" && !Array.isArray(location), `invalid planning location ${index}: ${item.sourceId}`);
    assert(JSON.stringify(Object.keys(location).sort()) === JSON.stringify(PLANNING_LOCATION_KEYS), `unexpected planning location fields ${index}: ${item.sourceId}`);
    assert(location.accuracy === "intersection", `planning location must be an explicit approximation: ${item.sourceId}`);
    for (const field of ["shop", "branch", "area", "label", "note"]) {
      assert(typeof location[field] === "string" && location[field].trim().length > 0, `missing planning location ${field}: ${item.sourceId}`);
    }
    assert(location.note.includes("非门店中心点"), `planning location must disclose its accuracy: ${item.sourceId}`);
    assert(location.sourceType === "openstreetmap", `invalid planning location source: ${item.sourceId}`);
    assert(Number.isFinite(location.lat) && location.lat >= 29.9 && location.lat <= 31.4, `planning latitude outside Wuhan boundary: ${item.sourceId}`);
    assert(Number.isFinite(location.lng) && location.lng >= 113.6 && location.lng <= 115.1, `planning longitude outside Wuhan boundary: ${item.sourceId}`);
    const sourceUrl = new URL(location.sourceUrl);
    assert(sourceUrl.protocol === "https:" && sourceUrl.hostname === "www.openstreetmap.org", `unexpected planning source URL: ${item.sourceId}`);
    assert(sourceUrl.username === "" && sourceUrl.password === "" && sourceUrl.hash === "", `credentials or fragment in planning source URL: ${item.sourceId}`);
    assert(/^\/node\/\d+$/.test(sourceUrl.pathname) && [...sourceUrl.searchParams.keys()].length === 0, `invalid OSM planning source URL: ${item.sourceId}`);
    assert(item.detailVerificationStatus === "official_app_detail_verified", `planning location needs an App-confirmed branch: ${item.sourceId}`);
    assert(location.shop === item.shop && location.branch === item.branch && location.area === item.area, `planning location must match the App-confirmed store: ${item.sourceId}`);
    planningLocationCount += 1;
  }
  assert(item.eligibleStores.length === 0 || item.planningLocations.length === 0, `exact and approximate locations must not coexist: ${item.sourceId}`);
  assert(Array.isArray(item.candidateStores), `candidateStores must be an array: ${item.sourceId}`);
  assert(item.candidateStores.length <= 8, `too many candidate stores: ${item.sourceId}`);
  const candidateBranches = new Set();
  for (const [index, store] of item.candidateStores.entries()) {
    assert(store && typeof store === "object" && !Array.isArray(store), `invalid candidate store ${index}: ${item.sourceId}`);
    assert(JSON.stringify(Object.keys(store).sort()) === JSON.stringify(CANDIDATE_STORE_KEYS), `unexpected candidate store fields ${index}: ${item.sourceId}`);
    assert(store.relationship === "public_branch_candidate", `invalid candidate relationship: ${item.sourceId}`);
    assert(store.couponEligibility === "unverified", `candidate store must not claim coupon eligibility: ${item.sourceId}`);
    for (const field of ["shop", "branch", "area", "publicInfoSource"]) {
      assert(typeof store[field] === "string" && store[field].trim().length > 0, `missing candidate ${field}: ${item.sourceId}`);
    }
    assert(store.address === null || (typeof store.address === "string" && store.address.trim().length > 0), `invalid candidate address: ${item.sourceId}`);
    assert(store.score === null || (Number.isFinite(store.score) && store.score >= 0 && store.score <= 5), `invalid candidate score: ${item.sourceId}`);
    assert(store.reviewCount === null || (Number.isInteger(store.reviewCount) && store.reviewCount >= 0), `invalid candidate reviewCount: ${item.sourceId}`);
    assert(store.publicHours === null || (typeof store.publicHours === "string" && store.publicHours.trim().length > 0 && store.publicHours.length <= 180), `invalid candidate publicHours: ${item.sourceId}`);
    validatePublicStoreUrl(store.publicInfoUrl, `candidate publicInfoUrl: ${item.sourceId}`, PUBLIC_INFO_HOSTS);
    validatePublicStoreUrl(store.mapSearchUrl, `candidate mapSearchUrl: ${item.sourceId}`, MAP_SEARCH_HOSTS);
    const branchId = `${store.shop}:${store.branch}`;
    assert(!candidateBranches.has(branchId), `duplicate candidate branch: ${item.sourceId}`);
    candidateBranches.add(branchId);
    publicCandidateStoreCount += 1;
  }
  if (item.candidateStores.length > 0) {
    assert(item.branch === null, `candidate stores must remain separate from a confirmed branch: ${item.sourceId}`);
    assert(item.score === null, `candidate score must not become the purchase score: ${item.sourceId}`);
    assert(item.weekendPolicy === "unknown", `public hours must not become a coupon weekend rule: ${item.sourceId}`);
  }
  if (item.mapSearchUrl != null) {
    assert(item.detailVerificationStatus === "official_app_detail_verified", `item mapSearchUrl needs an App-confirmed branch: ${item.sourceId}`);
    assert(typeof item.branch === "string" && typeof item.address === "string", `item mapSearchUrl needs a confirmed branch and address: ${item.sourceId}`);
    validatePublicStoreUrl(item.mapSearchUrl, `item mapSearchUrl: ${item.sourceId}`, MAP_SEARCH_HOSTS);
  }
  if (item.detailVerificationStatus === "order_only") {
    assert(item.eligibleStores.length === 0 && item.shop === null && item.branch === null, `order-only item must not claim a store: ${item.sourceId}`);
  } else if (["official_app_list_verified", "official_app_detail_verified"].includes(item.detailVerificationStatus)) {
    assert(typeof item.shop === "string", `App-verified item needs a shop: ${item.sourceId}`);
    if (item.detailVerificationStatus === "official_app_detail_verified") {
      assert(typeof item.address === "string" && item.address.trim().length > 0, `App detail verification needs an address: ${item.sourceId}`);
      assert(!/(?:未公开|待补充|未知|待核验)/.test(item.address), `placeholder purchase address: ${item.sourceId}`);
      verifiedDetailCount += 1;
    }
  } else {
    assert(item.eligibleStores.length > 0 && typeof item.shop === "string", `store-verified item needs a public store: ${item.sourceId}`);
    verifiedDetailCount += 1;
  }
  if (item.detailVerificationStatus === "official_deal_verified") {
    assert(item.weekendPolicy !== "unknown", `official deal verification needs a weekend policy: ${item.sourceId}`);
  }
  if (item.eligibleStores.length > 0) mappedPurchaseCount += 1;
  if (item.detailUrl != null) {
    assert(typeof item.detailUrl === "string" && item.detailUrl.trim().length > 0, `invalid purchase detailUrl: ${item.sourceId}`);
    validatePurchaseUrl(item);
  }
}
const rankedPurchases = purchases.items.slice().sort((a, b) => a.priorityRank - b.priorityRank);
assert(rankedPurchases.every((item, index) => item.priorityRank === index + 1), "purchase priorityRank must be sequential");
assert(purchases.summary?.count === purchases.items.length, "purchase summary count mismatch");
assert(purchases.summary?.mappedStoreCount === mappedPurchaseCount, "purchase mappedStoreCount mismatch");
assert(purchases.summary?.planningLocationCount === planningLocationCount, "purchase planningLocationCount mismatch");
assert(purchases.summary?.verifiedDetailCount === verifiedDetailCount, "purchase verifiedDetailCount mismatch");
assert(purchases.summary?.publicCandidateStoreCount === publicCandidateStoreCount, "purchase publicCandidateStoreCount mismatch");
if (publicStoreSource.status === "partial") assert(publicCandidateStoreCount > 0, "partial publicStores source has no candidate stores");
if (publicStoreSource.status === "error") assert(publicCandidateStoreCount === 0 && planningLocationCount === 0, "failed publicStores source must not publish locations");
if (purchaseSource.status === "ok") {
  assert(verifiedDetailCount === purchases.items.length, "ok purchase source still has unverified details");
  assert(purchases.items.every(item => item.weekendPolicy !== "unknown"), "ok purchase source still has unknown weekend rules");
}

const purchasesWithoutPublicStoreCoordinates = JSON.parse(JSON.stringify(purchases));
for (const item of purchasesWithoutPublicStoreCoordinates.items || []) {
  for (const store of item.eligibleStores || []) {
    delete store.lat;
    delete store.lng;
  }
  for (const location of item.planningLocations || []) {
    delete location.lat;
    delete location.lng;
  }
}
const serialized = JSON.stringify({ data, purchases: purchasesWithoutPublicStoreCoordinates });
const privatePatterns = [
  /"(?:lat|lng|latitude|longitude|token|cookie|dpid|accountId|userId|orderId|couponCode|voucherCode|phone|mobile)"\s*:/i,
  /(?:token|cookie|latitude|longitude|dpid|userid)(?:=|%3d)/i,
  /(?:encctx|isshare|notitlebar|sharecampaignid|shareid|utm_source)(?:=|%3d)/i,
  /(?:^|\D)30\.\d{4,}(?:\D|$)/,
  /(?:^|\D)114\.\d{4,}(?:\D|$)/,
];
assert(!privatePatterns.some(pattern => pattern.test(serialized)), "private coordinate or account data detected");

console.log(`RADAR_VALID pass=${counts.pass_free_trial} purchases=${purchases.items.length} purchase_status=${purchaseSource.status}`);
