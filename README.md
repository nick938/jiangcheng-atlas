# 江城图志 · Jiangcheng Atlas

一个以武汉为主题的城市互动地图与线下活动社区。地图收录地标、自然、人文、街区、高校和美食地点，用户可以在地图上创建活动、报名、留言和接收变更通知。

## 已有能力

- MapLibre 全屏地图、武汉城区范围、2D/3D 视角和分类图例
- D1 地点资料、详情图片、分享链接与管理后台
- 每个地点与活动都有服务端渲染的独立页面（`/place/<slug>`、`/event/<id>`），带分享卡片元数据与 JSON-LD
- `sitemap.xml`、`robots.txt` 与品牌分享图，便于搜索引擎收录和微信预览
- 活动日历导出：`/api/activities/<id>/calendar` 输出 `.ics`，可直接加入系统日历
- 用户名密码登录、可配置的微信开放平台扫码登录
- 创建、编辑、报名、退出、完成和取消活动，支持时间段与 R2 封面
- 活动留言、站内消息、用户举报和社区治理后台
- 社区发帖：话题筛选、帖子详情、评论、可选封面图，登录后发帖；帖子/评论可被举报与管理员隐藏
- 用户资料修改、退出登录和账号注销
- 管理员活动下架、留言隐藏、账号停用、举报处理和审计日志
- 图片经 R2 自定义域 `media.atlas.sololeveling.top` 直出（`lib/media.ts`，可回退 `/media` 路由）
- ISR 增量缓存（R2 + D1 tag cache + DO 队列）：地点 300s / 活动 120s / 帖子 60s
- Cloudflare Rate Limiting、同源校验、HttpOnly 会话、PBKDF2 密码派生
- 健康检查、Bun 单元测试、GitHub Actions 与 D1/R2 备份脚本

## 技术栈

- Next.js 16 / React 19 / TypeScript
- MapLibre GL JS / OpenFreeMap
- Cloudflare Workers / D1 / R2 / Rate Limiting
- OpenNext / Wrangler / Bun

## 本地开发

```bash
bun install
bun run cf-typegen
bun run db:migrate:local
bun run dev
```

浏览器打开 `http://localhost:3000`，管理入口为 `http://localhost:3000/admin`。

`.dev.vars` 至少需要：

```dotenv
ADMIN_PASSWORD=至少十二位的管理密码
ADMIN_SESSION_SECRET=随机长字符串
USER_AUTH_SECRET=随机长字符串
```

本地开发建议再加一行，把生产 CDN 关掉、图片走 Worker 的 `/media` 路由（上传后立即可见）：

```dotenv
MEDIA_PUBLIC_BASE=
```

微信登录为可选能力，获得审核通过的网站应用后再增加：

```dotenv
WECHAT_APP_ID=微信开放平台网站应用ID
WECHAT_APP_SECRET=微信开放平台网站应用密钥
```

## 验证

## 本地验证（端到端）

```bash
bun run dev                                        # 或 bun run preview（贴近 Workers 运行时）
node scripts/e2e-local.mjs                         # API 流程：注册/活动/报名/评论/举报/治理/媒体/社区发帖
node scripts/e2e-browser.mjs --base http://localhost:3000   # 浏览器流程：地图、深链、滚动、社区页面
BASE_URL=http://localhost:3000 bash scripts/smoke.sh         # 发布冒烟检查
```

```bash
bun run lint
bunx next typegen
bunx tsc --noEmit
bun test
bunx opennextjs-cloudflare build   # 或 bun run preview（构建 + 本地 wrangler dev）
```

## Cloudflare 发布

```bash
bunx wrangler login
bunx wrangler secret put ADMIN_PASSWORD
bunx wrangler secret put ADMIN_SESSION_SECRET
bunx wrangler secret put USER_AUTH_SECRET
bunx wrangler secret list                      # 确认上面 3 个（以及微信 2 个）名字都在
bunx wrangler r2 bucket create jiangcheng-atlas-next-cache   # 首次：ISR 增量缓存桶
bun run db:migrate:remote                     # 含 migration 0012：自动创建 revalidations（tag 缓存）表
bun run deploy
bunx wrangler secret list > /dev/null && bash scripts/smoke.sh   # 或 BASE_URL=https://atlas.sololeveling.top
```

`bun run deploy` 内部已包含 `opennextjs-cloudflare build`，不需要再单独 `bun run build`。回滚用 `bunx wrangler versions list` + `bunx wrangler rollback <version-id>`；缓存、R2 图片直出、CSP/HSTS、备份恢复与监控告警的完整步骤见 [OPERATIONS.md](./OPERATIONS.md)。

微信登录的 AppID 与 AppSecret 也通过 `wrangler secret put` 配置，不能写入仓库。详细发布、备份、恢复和监控步骤见 [OPERATIONS.md](./OPERATIONS.md)。

## 数据结构

迁移文件位于 `migrations/`，目前包含：

- 地点分类、地点资料、R2 地点图片和管理审计
- 用户、会话、微信身份绑定
- 活动、参加者、活动图片与开始/结束时间
- 活动留言、举报、站内通知和治理状态
- 社区帖子、帖子评论（含封面图 R2 对象键）
- OpenNext 缓存：`revalidations` 表（D1 tag cache，migration 0012 自动创建）

公共地图只展示 `published` 地点和 `visible` 活动。所有社区写操作都要求有效身份、同源请求并应用限流。

## 分享、收录与日历

- 地点分享链接指向 `/place/<slug>`，活动分享链接指向 `/event/<id>`；两者都能一键回到地图并自动定位。
- 地点页读取 D1 的 `published` 地点，D1 不可用时退回内置地点数据；活动页只展示未被下架的记录，已取消或已结束的活动保留页面但标记 `noindex`。
- `sitemap.xml` 收录首页、政策页、全部已发布地点与正在召集的活动；`robots.txt` 排除 `/admin` 与 `/api/`。
- 活动时间统一按武汉时间（Asia/Shanghai）显示，避免服务端（UTC）与浏览器显示不一致。
- 分享图 `public/og.png` 由 `python3 scripts/generate-og-image.py` 生成（需要 Pillow 与系统中文字体）。
