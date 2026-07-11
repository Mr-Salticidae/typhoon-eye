# 风眼 · Typhoon Eye

> 台风实况信息 + 分级应急预案，一页看懂、照做即可。极简、零依赖的静态单页，与 [蛛网之上](https://github.com/Mr-Salticidae/above-the-web) 同源的纸墨设计体系。

**在线访问：https://mr-salticidae.github.io/typhoon-eye/**

**⚠️ 本站为信息聚合与科普工具，非预警发布渠道。防灾决策请以当地政府与气象部门发布的官方预警为准。**

## 功能

- 🌀 **实况面板** — 台风位置、风力、气压、移向移速、风圈半径（实时数据）
- 🗺️ **路径示意图** — SVG 历史/预报路径，视窗随路径动态扩展，逐点悬停查看强度
- 🚦 **四级预警** — 蓝/黄/橙/红切换，按台风强度预选参考档位，颜色对齐官方预警信号
- ✅ **分级预案** — 递进式可勾选行动清单，进度自动保存
- ☎️ **应急信息** — 求助电话与权威信息源直达
- 🌗 **昼夜双主题** · 多台风并存时可切换 · 无台风时预案常备

## 数据

GitHub Actions 每 15 分钟运行 [`scripts/fetch-typhoon.mjs`](scripts/fetch-typhoon.mjs)（主任务 + 守护任务共 8 个触发点/小时，抵御 GitHub 调度偶发丢班），从[浙江省台风路径实时发布系统](https://typhoon.slt.zj.gov.cn/)抓取活跃台风，生成静态 [`data/typhoon.json`](data/typhoon.json)。客户端并行请求 Pages 与 jsDelivr 多镜像（Actions 更新后主动清理 jsDelivr 缓存），取最新数据；全部失败时依次降级为包内缓存和内置演示数据，并显著标注当前数据状态。

## 使用

无需构建，克隆后直接双击 `index.html`（离线降级演示模式），或本地起静态服务器后访问以加载真实数据：

```bash
npx serve .
```

## 路线图

见 [PLAN.md](PLAN.md)。后续：城市定位与"距我多远"、预案打印版、PWA 离线缓存。

## 许可

MIT
