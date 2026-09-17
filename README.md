# shared-tools

轻量静态工具发布仓库。

## 当前页面

- `chucai-map/`：楚才卡武汉及近郊交互地图
- `food-radar/`：武汉美食优惠雷达，分栏展示 PASS 可兑换免费试与尚未到订单到期日的已购美食套餐
- `global-trips/`：JT & QX 的长期旅行入口；Trip 001 是 2026 马尔代夫 × 曼谷旅行工作台

## 公开数据边界

`food-radar/` 只发布商家、套餐、公开活动规则、实际支付价、粗粒度商圈和距离档位。不发布家庭坐标、订单号、券码、支付凭证、平台账号状态、Token、Cookie 或推送密钥。

`global-trips/` 只发布城市、航班时间、酒店与房型、普通预算、公开地点和旅行清单，不发布证件号、确认号、保单号、精确家庭地址、联系方式、账号信息或支付凭证。Trip 内的勾选、选择与笔记当前只保存在访问设备的浏览器中，不跨设备同步。

雷达计划每天 10:01 扫描 PASS 免费试，并在详情页复核仍有剩余。尚未到订单到期日的已购套餐通过独立的 `food-radar/purchases.json` 按需同步，当前支持大众点评，后续可复用同一脱敏结构加入抖音团购。发布前运行 `node scripts/validate-food-radar.mjs`，微信摘要由 `node scripts/send-food-radar.mjs` 生成。

GitHub Pages 建议从 `main` 分支的 `/ (root)` 发布。
