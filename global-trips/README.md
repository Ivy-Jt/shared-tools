# JT & QX’s Global Trips

## 系统分层

- ChatGPT Project / 旅行线程：研究、讨论和形成候选。
- `trip.json`：已确认事实与当前结构化状态，是每趟旅行的唯一可信数据。
- HTML / JavaScript：读取 Trip Data 并提供 Plan、Live、Memory 三阶段界面。
- `localStorage`：当前浏览器里的试选、勾选、预算草稿和回忆，不代表已确认事实，也不会跨设备同步。

## 线程同步约定

每趟旅行使用稳定 Trip ID，例如 `2026-maldives-bangkok`。在任意相关线程中，当结论已经确认时，使用：

```text
同步到 Trip 001
```

Codex 应把本轮已确认变化整理为最小 Delta，只修改对应 `trip.json`，运行：

```bash
node scripts/validate-global-trips.mjs
```

验证通过后再单独提交和发布。讨论、候选价格、未确认预订不得自动覆盖确认事实；不得把聊天链接、账号信息、证件号、订单号、确认号、保单号或支付凭证写入公开仓库。

普通 ChatGPT Project 记忆只提供上下文，不是自动同步数据库。目前不会监听全部聊天；没有 Codex 时，结构化 Trip Update 留在项目中，后续由总控线程或 Codex 收口。
