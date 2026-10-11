# Trip 001 · V11 接入

来源：2026-10-11 的 `Trip001_Git接入包_20261011.zip`。

现有旅程 URL、Plan / Live / Memory、清单、登录和私人相册继续使用。`trip.json` 的 `journal` 字段指向完整游记和逐笔账本；完整游记位于“旅行回忆”，账本位于“预算”。原行前预算及其同步数据保留在独立折叠区，不与逐笔费用重复求和。

- `journal.html`：八天完整正文、69 张图文照片和小记忆。逐日正文与包内原文一致。
- `assets/photos/`：69 张源图片保持字节一致，另有从包内 CSS 提取的封面照片，共 70 个文件。
- `ledger.json`：56 条记录，默认 46 条计入，按 1 THB = 0.20 CNY 合计 ¥67,087.19，含估算；未知金额不按已确认零消费处理。
- `ledger.html` 与共用 `journal-ledger.mjs`：金额、币种、依据、计入开关、汇率、名称及备注编辑、新增、JSON / CSV 导出和恢复初始值。

账本沿用原包的浏览器存储键，仅在当前浏览器保存，不接入云端共享状态。静态图文和账本种子将随网站发布被访问；本次只在现有仓库本地提交，未发布或推送。

验证：`node scripts/validate-global-trips.mjs`，`node --test scripts/test-trip-journal.mjs services/trip-sync/test/sync.test.mjs services/trip-sync/test/photos.test.mjs`。另已实际检查桌面与 390px 手机布局、大图浏览、金额与汇率重算、刷新保存、JSON / CSV 导出。

现有 `scripts/test-trip-preparation.mjs` 绑定早期历史提交，因早已更新的酒店文案与旧快照不同而失败；本次未修改酒店字段。
