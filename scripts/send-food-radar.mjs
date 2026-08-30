#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KEYCHAIN_SERVICE = "serverchan.food-radar";
const PUBLIC_URL = "https://ivy-jt.github.io/shared-tools/food-radar/";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(PROJECT_ROOT, "food-radar", "latest.json");
const dryRun = process.argv.includes("--dry-run");

const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const items = Array.isArray(data.items) ? data.items.slice(0, 3) : [];

if (items.length === 0) {
  console.log("PUSH_SKIPPED no_items");
  process.exit(0);
}

const title = `🍜 生活｜美食雷达：${items.length}条新发现`;
const lines = [
  `今天筛出 ${items.length} 条值得看。`,
  "",
  ...items.map(item => `- ${item.tag}｜${item.title}（${item.area}）`),
  "",
  `[点击查看详情与限制条件](${PUBLIC_URL})`,
];
const payload = {
  title,
  short: `${items.length} 条新发现 · 武汉美食`,
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

console.log(`PUSH_OK http=${response.status} code=0`);
