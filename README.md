# 江城图志 · Jiangcheng Atlas

一个以武汉为主题的城市互动地图。沿两江四岸收录地标、湖泊公园、人文艺术、街区、高校与过早地点，并通过可分享的地图坐标讲述城市。

## 第一版功能

- MapLibre 全屏互动地图与地点聚合
- 地点搜索、分类筛选和地图定位
- 地点详情、坐标与分享 URL
- 桌面端与移动端响应式界面
- Cloudflare D1 地点数据库
- Cloudflare R2 媒体对象存储绑定
- OpenNext 部署到 Cloudflare Workers
- D1 未初始化时自动回退到内置首批数据

## 技术栈

- Next.js 16 / React 19 / TypeScript
- MapLibre GL JS / OpenFreeMap
- Cloudflare Workers / D1 / R2
- `@opennextjs/cloudflare` / Wrangler

## 本地开发

```bash
bun install
bun run cf-typegen
bun run db:migrate:local
bun run dev
```

浏览器打开 `http://localhost:3000`。

需要验证真实 Workers 运行时和本地 D1/R2 绑定时：

```bash
bun run preview
```

浏览器打开 `http://localhost:8787`。

## Cloudflare 部署

首次部署前，需要在 Cloudflare 创建同名资源，并把真实的 D1 `database_id` 写入 `wrangler.jsonc`：

```bash
wrangler login
wrangler d1 create jiangcheng-atlas-db
wrangler r2 bucket create jiangcheng-atlas-media
bun run cf-typegen
bun run db:migrate:remote
bun run deploy
```

配置使用 Workers Bindings 直接访问 D1 和 R2，不在代码中保存 Cloudflare 密钥。

## 数据结构

首个迁移文件位于 `migrations/0001_initial.sql`，包含：

- `categories`：地点分类
- `places`：地点正文、坐标、行政区和发布状态
- `place_images`：R2 对象键与地点的关联

公开版本目前只提供读取接口 `GET /api/places`。在登录和权限控制完成前，不开放管理写入接口。
