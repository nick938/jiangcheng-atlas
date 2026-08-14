# 江城图志 · Jiangcheng Atlas

一个以武汉为主题的城市互动地图与线下活动社区。地图收录地标、自然、人文、街区、高校和美食地点，用户可以在地图上创建活动、报名、留言和接收变更通知。

## 已有能力

- MapLibre 全屏地图、武汉城区范围、2D/3D 视角和分类图例
- D1 地点资料、详情图片、分享链接与管理后台
- 用户名密码登录、可配置的微信开放平台扫码登录
- 创建、编辑、报名、退出、完成和取消活动，支持时间段与 R2 封面
- 活动留言、站内消息、用户举报和社区治理后台
- 用户资料修改、退出登录和账号注销
- 管理员活动下架、留言隐藏、账号停用、举报处理和审计日志
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

微信登录为可选能力，获得审核通过的网站应用后再增加：

```dotenv
WECHAT_APP_ID=微信开放平台网站应用ID
WECHAT_APP_SECRET=微信开放平台网站应用密钥
```

## 验证

```bash
bun run lint
bunx tsc --noEmit
bun test
bun run build
```

## Cloudflare 发布

```bash
bunx wrangler login
bunx wrangler secret put ADMIN_PASSWORD
bunx wrangler secret put ADMIN_SESSION_SECRET
bunx wrangler secret put USER_AUTH_SECRET
bun run db:migrate:remote
bun run deploy
```

微信登录的 AppID 与 AppSecret 也通过 `wrangler secret put` 配置，不能写入仓库。详细发布、备份、恢复和监控步骤见 [OPERATIONS.md](./OPERATIONS.md)。

## 数据结构

迁移文件位于 `migrations/`，目前包含：

- 地点分类、地点资料、R2 地点图片和管理审计
- 用户、会话、微信身份绑定
- 活动、参加者、活动图片与开始/结束时间
- 活动留言、举报、站内通知和治理状态

公共地图只展示 `published` 地点和 `visible` 活动。所有社区写操作都要求有效身份、同源请求并应用限流。
