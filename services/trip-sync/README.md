# Global Trips 云端编辑

独立 Worker `jt-global-trips-sync` 与 D1 `jt-global-trips`，只服务 Trip 001。GitHub Pages 保留现有地址；页面读取公开的行程基线，登录后通过 API 读写私人编辑记录。

## 首版范围

- 同步五态采购状态、打包和待办勾选、预算、旅行笔记。
- 单一所有者使用随机生成的专用旅行登录码；用户可以选择是否让设备记住登录。
- 服务端仅保存登录码 SHA-256，凭据不放在 Git、页面脚本或 URL 中。
- 云端记录需认证才能读取和修改。无登录访客只看到公开基线。
- 修改自动保存；断网草稿留在本机，恢复网络后重试。
- 同字段冲突需选择保留内容，不同字段可合并。D1 保留最近 30 次修改前的快照。
- 本机旧记录须预览并确认后导入，不会自动覆盖云端。
- ChatGPT 直接写入、QX 独立账号、公开分享私人编辑不在本版范围。

## 部署

使用 Cloudflare Workers 免费计划，不自动升级套餐。额度与账号内其他 Workers/D1 共享。

1. 以账号读取、Worker 脚本和 D1 权限登录 Wrangler。
2. 确认目标资源名不存在；创建独立 D1，并将返回的数据库 ID 填入 `wrangler.jsonc`。
3. `wrangler d1 migrations apply jt-global-trips --remote`。
4. `node scripts/init-owner.mjs`，在本机忽略目录 `.local/` 创建私有登录码和 Worker secret 文件。
5. `wrangler deploy`，再以 `wrangler secret bulk .local/worker-secrets.json` 设置 `OWNER_KEY_HASH`；未配置时所有数据接口返回 503。
6. 将实际 Worker HTTPS 地址写入 `global-trips/cloud-config.json`。
7. 核验生产接口：匿名请求 401，认证后可读取；再发布旅行页并核验线上文件。

`wrangler.jsonc` 中仅允许 `https://ivy-jt.github.io` 跨域访问。扩展来源需要明确修改配置。登录码丢失可轮换 Worker secret，D1 内容不受影响。

## 验收

Node 24：`node --test test/sync.test.mjs`。SQLite 测试使用内存数据库。

浏览器验收：安装 Playwright 后运行 `node test/browser.mjs`。也可通过 `PLAYWRIGHT_MODULE` 指定现有 Playwright 模块，`CHROME_PATH` 指定本机 Chrome。脚本使用隔离浏览器、内存数据库和随机测试登录码，覆盖跨设备读取、刷新持久化、冲突后刷新、断网恢复和旧记录导入。结果放在忽略目录 `test-results/`。

只有代码测试通过、Worker/D1 正式部署、线上读写验收和 Pages 内容核对完成后，才可称为已上线；用户手机上的实际验收单独记录。
