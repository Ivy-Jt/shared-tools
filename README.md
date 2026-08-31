# shared-tools

轻量静态工具发布仓库。

## 当前页面

- `chucai-map/`：楚才卡武汉及近郊交互地图
- `food-radar/`：武汉美食优惠雷达，分栏展示 PASS 可兑换免费试与尚未到订单到期日的已购美食套餐

## 公开数据边界

`food-radar/` 只发布商家、套餐、公开活动规则、实际支付价、粗粒度商圈和距离档位。不发布家庭坐标、订单号、券码、支付凭证、平台账号状态、Token、Cookie 或推送密钥。

雷达计划每天 10:01 扫描 PASS 免费试，并在详情页复核仍有剩余。尚未到订单到期日的已购套餐通过独立的 `food-radar/purchases.json` 按需同步，当前支持大众点评，后续可复用同一脱敏结构加入抖音团购。发布前运行 `node scripts/validate-food-radar.mjs`，微信摘要由 `node scripts/send-food-radar.mjs` 生成。

GitHub Pages 建议从 `main` 分支的 `/ (root)` 发布。
