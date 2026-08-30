#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KEYCHAIN_SERVICE = "serverchan.food-radar";
const PUBLIC_URL = "https://ivy-jt.github.io/shared-tools/food-radar/";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(PROJECT_ROOT, "food-radar", "latest.json");
const STATE_PATH = path.join(PROJECT_ROOT, "food-radar", ".push-state.json");
const VALIDATOR_PATH = path.join(PROJECT_ROOT, "scripts", "validate-food-radar.mjs");
const dryRun = process.argv.includes("--dry-run");

try {
  execFileSync(process.execPath, [VALIDATOR_PATH], { stdio: "ignore" });
} catch {
  console.error("PUSH_FAILED invalid_or_stale_data");
  process.exit(1);
}

const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const sourceKeyByKind = {
  pass_free_trial: "passFreeTrial",
  lv_store_gift: "lvStoreGift",
  orange_v_paid: "orangeVPaid",
};
const items = Array.isArray(data.items)
  ? data.items
    .filter(item => item.availability === "available" && data.sources?.[sourceKeyByKind[item.kind]]?.status === "ok")
    .sort((a, b) => a.priorityRank - b.priorityRank)
  : [];
const passItems = items.filter(item => item.kind === "pass_free_trial").slice(0, 5);
const giftItems = items.filter(item => item.kind === "lv_store_gift").slice(0, 3);
const paidItems = items.filter(item => item.kind === "orange_v_paid").slice(0, 3);
const selected = [...passItems, ...giftItems, ...paidItems];
const giftStatus = data.sources?.lvStoreGift?.status;
const paidStatus = data.sources?.orangeVPaid?.status;
const scanDate = String(data.generatedAt || "").slice(0, 10);

if (selected.length === 0) {
  console.log("PUSH_SKIPPED no_items");
  process.exit(0);
}

const fingerprintInput = {
  scanDate,
  items: selected.map(item => ({
    sourceId: item.sourceId,
    kind: item.kind,
    priorityRank: item.priorityRank,
    title: item.title,
    detailUrl: item.detailUrl,
    distanceKm: item.distanceKm,
    referenceValueCny: item.referenceValueCny,
    score: item.score,
    priceCny: item.priceCny,
    savedCny: item.savedCny,
    deadline: item.deadline,
    useWindow: item.useWindow,
    restrictions: item.restrictions,
  })),
};
const fingerprint = createHash("sha256")
  .update(JSON.stringify(fingerprintInput))
  .digest("hex");

if (!dryRun) {
  try {
    const previous = JSON.parse(await readFile(STATE_PATH, "utf8"));
    if (previous.scanDate === scanDate) {
      console.log("PUSH_SKIPPED already_sent_today");
      process.exit(0);
    }
  } catch {}
}

const statusCount = (items, status) => items.length || (status === "app_required" ? "待App核验" : 0);
const title = `🍜 生活｜雷达：P${passItems.length}·礼${statusCount(giftItems, giftStatus)}·橙V${statusCount(paidItems, paidStatus)}`;
const sectionLines = [];
if (passItems.length) {
  sectionLines.push("**PASS 可兑换**", ...passItems.map(item =>
    `- 余${item.passRemaining}｜${item.title}（${item.area}${item.distanceLabel ? `，${item.distanceLabel}` : ""}）`
  ), "");
}
if (giftItems.length) {
  sectionLines.push("**LV6+ 到店礼**", ...giftItems.map(item =>
    `- ${item.title}（${item.area}${item.distanceLabel ? `，${item.distanceLabel}` : ""}）`
  ), "");
} else if (giftStatus === "app_required") {
  sectionLines.push("**LV6+ 到店礼**", "- 本轮仍需 App 内核验，不发送未确认候选。", "");
}
if (paidItems.length) {
  sectionLines.push("**付费橙V专享价**", ...paidItems.map(item =>
    `- ¥${item.priceCny}｜${item.title}（${item.area}）`
  ), "");
} else if (paidStatus === "app_required") {
  sectionLines.push("**付费橙V专享价**", "- 本轮仍需 App 内核验，不发送普通团购冒充的候选。", "");
}
const lines = [
  `今天筛出 ${selected.length} 条已核验结果。`,
  "",
  ...sectionLines,
  `[点击查看详情与限制条件](${PUBLIC_URL})`,
];
const payload = {
  title,
  short: `PASS ${passItems.length} · 到店礼 ${statusCount(giftItems, giftStatus)} · 橙V价 ${statusCount(paidItems, paidStatus)}`,
  desp: lines.join("\n"),
  noip: "1",
};

if (dryRun) {
  console.log(JSON.stringify({
    endpoint: "https://sctapi.ftqq.com/<redacted>.send",
    payload,
  }, null, 2));
  process.exit(0);
}

let sendKey;
try {
  sendKey = execFileSync("/usr/bin/security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-w",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  console.error(`PUSH_FAILED missing_keychain_item service=${KEYCHAIN_SERVICE}`);
  process.exit(2);
}

if (!/^SCT[A-Za-z0-9_-]+$/.test(sendKey)) {
  console.error("PUSH_FAILED invalid_sendkey_format");
  process.exit(2);
}

let response;
try {
  response = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(payload),
    signal: AbortSignal.timeout(20000),
  });
} catch {
  console.error("PUSH_FAILED network_error");
  process.exit(3);
}

let result;
try {
  result = await response.json();
} catch {
  console.error(`PUSH_FAILED http=${response.status} invalid_json`);
  process.exit(4);
}

if (!response.ok || result.code !== 0) {
  console.error(`PUSH_FAILED http=${response.status} code=${String(result.code ?? "unknown")}`);
  process.exit(5);
}

await writeFile(STATE_PATH, `${JSON.stringify({ fingerprint, scanDate, sentAt: new Date().toISOString() }, null, 2)}\n`, {
  mode: 0o600,
});
console.log(`PUSH_OK http=${response.status} code=0`);
