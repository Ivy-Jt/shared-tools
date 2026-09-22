# JT & QX’s Global Trips

## 系统分层

- ChatGPT Project / 旅行线程：研究、讨论和形成候选。
- `trip.json`：已确认事实与当前结构化状态，是每趟旅行的唯一可信数据。
- HTML / JavaScript：读取 Trip Data 并提供 Plan、Live、Memory 三阶段界面。
- `localStorage`：当前浏览器里的五态采购标记、已打包勾选、待办、预算草稿和回忆；不代表已确认事实，也不会跨设备同步。

## 线程同步约定

每趟旅行使用稳定 Trip ID，例如 `2026-maldives-bangkok`。在任意相关线程中，当结论已经确认时，使用：

```text
同步到 Trip 001
```

Codex 应从可访问的旅行线程提取本轮已确认变化，整理为最小 Delta，写入对应 `trip.json`；如果数据结构新增字段，同时更新该 Trip 的渲染与校验。运行：

```bash
node scripts/validate-global-trips.mjs
```

验证通过后再单独提交和发布。讨论、候选价格、未确认预订不得自动覆盖确认事实；不得把聊天链接、账号信息、证件号、订单号、确认号、保单号或支付凭证写入公开仓库。

普通 ChatGPT Project 记忆只提供上下文，不是自动同步数据库。ChatGPT 线程不能直接写入 GitHub 时，确认 patch 仍停留在线程或附件里；可由 Codex 读取可访问的线程并提交发布，不需要用户逐条搬运。目前不会监听全部聊天，也没有 JT/QX 跨设备实时编辑；这需要另行设计共享状态层，不能在网页暴露 GitHub Token。
