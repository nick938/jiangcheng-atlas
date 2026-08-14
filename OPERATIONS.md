# 江城图志运行手册

## 发布前检查

```bash
bun install --frozen-lockfile
bun run lint
bunx tsc --noEmit
bun test
bun run build
bun run db:migrate:remote
bun run deploy
```

涉及新数据库字段时必须先迁移 D1，再部署读取这些字段的 Worker。部署后检查：

```bash
curl --fail https://jiangcheng-atlas.liuyi4781.workers.dev/api/health
curl --fail https://jiangcheng-atlas.liuyi4781.workers.dev/api/activities
```

## 微信登录

微信开放平台网站应用审核通过后，将回调地址配置为：

```text
https://你的正式域名/api/auth/wechat/callback
```

再设置 Cloudflare Secrets：

```bash
bunx wrangler secret put WECHAT_APP_ID
bunx wrangler secret put WECHAT_APP_SECRET
```

未同时配置两个值时，登录框只显示“等待开放平台配置”，不会发起 OAuth。

## 备份

本机需要 Bun、Wrangler 登录态和 `jq`：

```bash
bun run backup:remote
```

脚本导出完整 D1 SQL，并根据数据库中的对象键下载 R2 地点和活动图片。备份目录默认位于 `backups/<UTC 时间>/`，该目录已被 `.gitignore` 排除。备份完成后应加密并复制到与 Cloudflare 账号隔离的存储。

恢复 D1 会覆盖生产数据，必须先创建临时数据库验证备份，再在维护窗口按 Cloudflare D1 恢复流程执行。R2 图片可以用 `wrangler r2 object put` 按原对象键逐个恢复。

## 监控

- `/api/health` 返回 `200 {"status":"ok"}` 表示 Worker 和 D1 可用；失败返回 503。
- Cloudflare Workers Observability 已启用，生产错误使用结构化事件名记录。
- 建议在 Cloudflare Health Checks 或独立监控服务中每 5 分钟检查 `/api/health`，连续失败两次告警。
- 每周检查一次治理后台的待处理举报，每月执行并抽查一次备份。
