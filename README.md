# shared-tools

轻量静态工具发布仓库。

## 当前页面

- `chucai-map/`：楚才卡武汉及近郊交互地图
- `food-radar/`：武汉美食优惠雷达，按 PASS 可兑换免费试、LV6+ 无门槛到店礼、付费橙V专享价分栏展示每日筛选结果与活动限制

## 公开数据边界

`food-radar/` 只发布商家、套餐、公开活动规则、粗粒度商圈和距离档位。不发布家庭坐标、平台账号状态、Token、Cookie 或推送密钥。

雷达计划每天 10:01 扫描。PASS 必须在详情页复核仍有剩余；LV 到店礼和付费橙V专享价只有在账号资格、领取/购买状态及限制均可核验时才会发布。发布前运行 `node scripts/validate-food-radar.mjs`，微信摘要由 `node scripts/send-food-radar.mjs` 生成。

GitHub Pages 建议从 `main` 分支的 `/ (root)` 发布。
