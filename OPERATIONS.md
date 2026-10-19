# 江城图志运行手册

部署方式：**人工执行 `bun run deploy`**（`opennextjs-cloudflare build && deploy`）。仓库没有配置 Cloudflare Workers Builds 的自动部署，CI 只做校验与冒烟；如需改成 Workers Builds，请同时在本文件记录触发分支、构建命令（`bun run deploy` 之外的 `opennextjs-cloudflare build`）与回滚入口。

## 发布前检查

```bash
bun install --frozen-lockfile
bun run lint
bunx next typegen
bunx tsc --noEmit
bun test
bunx wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts --include-runtime=false
git diff --exit-code -- cloudflare-env.d.ts   # 绑定漂移检查：有差异说明忘了提交类型
git status --porcelain                        # 必须为空：仓库就是部署源，未跟踪文件不会被部署
bunx wrangler secret list                     # 见下方“Secrets 校验”
bun run db:migrate:remote                     # 有新字段时先迁移，再部署读取字段的 Worker
bun run deploy                                # 内部已包含 opennextjs-cloudflare build，不需要单独 bun run build
```

### Secrets 校验

`wrangler secret list` 的输出里必须同时存在这 5 个名字（缺任何一个都会出问题，值不可见是正常的）：

| Secret | 缺失后果 |
| --- | --- |
| `ADMIN_PASSWORD` | 治理后台无法登录（`/api/admin/session` 500/401） |
| `ADMIN_SESSION_SECRET` | 后台会话无法签发与校验 |
| `USER_AUTH_SECRET` | 用户注册/登录全部失败（PBKDF2 派生依赖它） |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 仅微信登录不可用，登录框显示“等待开放平台配置” |

首次配置或轮换：

```bash
bunx wrangler secret put ADMIN_PASSWORD
bunx wrangler secret put ADMIN_SESSION_SECRET
bunx wrangler secret put USER_AUTH_SECRET
```

轮换 `ADMIN_SESSION_SECRET`/`USER_AUTH_SECRET` 会让现有会话立即失效；后者还会让已注册用户无法用旧密码登录（密码记录用旧密钥派生），需要提示用户重置，建议在低峰期执行。

### 部署后检查

```bash
bash scripts/smoke.sh                                   # 本地/CI 用；参数见脚本头部
BASE_URL=https://atlas.sololeveling.top bash scripts/smoke.sh
curl -sI https://atlas.sololeveling.top/ | grep -i "strict-transport-security\|content-security-policy-report-only"
curl -sI https://atlas.sololeveling.top/api/activities/<活动ID>/calendar | grep -i content-type  # 应为 text/calendar; charset=utf-8
```

## 回滚

```bash
bunx wrangler versions list                  # 找到上一个正常版本 id
bunx wrangler rollback <version-id>          # 回滚 Worker 代码
bunx wrangler deployments status             # 确认当前生效版本
```

- 回滚只还原 Worker 代码与静态资源，**不会**回滚 D1 迁移：新增字段（列/表）保持存在，旧版本代码可以忽略它们；如果坏发布删过列，只能前滚修复或从备份恢复。
- 静态资源随版本一起回滚，因此回滚后建议立刻跑一次 `bash scripts/smoke.sh`。
- 渐进发布（可选）：`bunx wrangler versions upload` 得到预览版本 → 验证 → `bunx wrangler versions deploy`。

## 缓存配置（R2 增量缓存 + D1 tag cache + DO 队列）

`open-next.config.ts` 启用了官方 “Small site using revalidation” 组合，`wrangler.jsonc` 里对应的绑定必须存在：

| 绑定 | 用途 | 需要用户侧一次性操作 |
| --- | --- | --- |
| `NEXT_INC_CACHE_R2_BUCKET` → `jiangcheng-atlas-next-cache` | ISR/数据缓存条目 | 建桶：`bunx wrangler r2 bucket create jiangcheng-atlas-next-cache` |
| `NEXT_TAG_CACHE_D1` → 复用 `jiangcheng-atlas-db` | `revalidateTag`/`revalidatePath` 的 tag 记录 | 无：migration `0012_opennext_revalidations.sql` 自动建表 |
| `NEXT_CACHE_DO_QUEUE` → `DOQueueHandler` | 时间驱动 `revalidate` 的后台再生成 | 无（`wrangler deploy` 会应用 `migrations` 里的 `v1`） |
| `WORKER_SELF_REFERENCE` | 队列回源到自身 Worker | 无（服务名与 `name` 相同） |

D1 tag 表由 `migrations/0012_opennext_revalidations.sql` 创建（`bun run db:migrate:remote` 会应用）。若在旧环境手工恢复，可执行同样的 DDL：

```bash
bunx wrangler d1 execute jiangcheng-atlas-db --remote --command "CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL DEFAULT 0, stale INTEGER, expire INTEGER, UNIQUE(tag) ON CONFLICT REPLACE);"
```

- 只有页面声明了 `export const revalidate`（或使用 `revalidateTag`/`revalidatePath`）才会写入这份缓存；没有声明 `revalidate` 的路由行为与以前一致。
- 时间驱动再验证必须有 DO 队列：缺省 dummy 队列会在日志里反复出现 `Failed to revalidate stale page`，页面停留在旧内容。
- 想进一步减少 R2 读取可用 regional cache（`withRegionalCache(r2IncrementalCache, { mode: "long-lived" })`），但与按需再验证同时使用时要配 Cache Purge，否则各数据中心可能读到旧值。
- `preview`（`wrangler dev`）会用本地模拟绑定；缓存写入 `.wrangler/state`，可随手删除。

## R2 图片直出（可选，降低 Worker 与 R2 读成本）

图片当前由 `app/media/[...key]/route.ts` 经 Worker 回源 R2。要让 CDN 直出：

1. Cloudflare 控制台 → R2 → `jiangcheng-atlas-media` → Settings → **Public access → Custom Domains → Connect Domain**，填 `media.atlas.sololeveling.top`。
2. 该域名会自动创建 CNAME 记录（`media` → 桶的 R2 域名）并签发证书，不需要手工加 DNS；确认 Zone 的代理状态为已代理。
3. 给该主机名加缓存规则（Cache Rules）：`http.host eq "media.atlas.sololeveling.top"` → Cache eligibility: Eligible，Edge TTL 忽略源站缓存头、Browser TTL 使用源站（R2 已写入 `public, max-age=31536000, immutable`）。
4. 代码侧 `/media/<key>` 保留为 fallback（未绑定自定义域、或需要权限控制的私有对象走它）。切换时把 `lib/places.ts`/数据库里返回给前端的前缀改成新域名即可，无需改 Worker。
5. 验证：`curl -sI https://media.atlas.sololeveling.top/places/<placeId>/<uuid>.jpg` 应看到 `cf-cache-status: HIT`（第二次请求）。

## 安全响应头

- 应用层（`next.config.ts`）：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、`Strict-Transport-Security`。
- CSP 目前是 **Report-Only**，与其他安全头一起由 `next.config.ts` 的 `headers()` 下发（`source: "/:path*"`）：`default-src 'self'`、`img-src 'self' data: blob: https://tiles.openfreemap.org https://commons.wikimedia.org https://upload.wikimedia.org`、`connect-src 'self' https://tiles.openfreemap.org`、`worker-src blob:`、`frame-ancestors 'none'`。浏览器只上报不拦截，观察一周无违规后可改成 `Content-Security-Policy` 并把 `script-src` 的 `'unsafe-inline'` 换成 nonce。
- **为什么没有用 `proxy.ts`**：Next 16 起 Proxy（原 Middleware）默认运行在 Node.js runtime，且 Proxy 文件不允许设置 `runtime`（`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:223`）；而 `@opennextjs/cloudflare` 1.20.2 遇到 Node.js middleware 会直接终止构建（`dist/cli/build/build.js:66-69`，实测报 `Node.js middleware is not currently supported`）。没有 nonce 时静态响应头与 Proxy 等价，所以先放在 `next.config.ts`。将来要上 nonce：先确认适配器已支持 Node middleware（或改用 edge runtime），再把这段搬到 `proxy.ts` 并在响应头里带 nonce。
- HSTS 目前由应用层下发；**不要**再在 Cloudflare 边缘（SSL/TLS → Edge Certificates → HSTS）重复开启，二选一。
- `next.config.ts` 的 `headers()` **不覆盖** Workers 静态资源（`/_next/static/*`、`public/` 文件）。需要给静态资源加缓存头时用 `public/_headers`：

  ```text
  /_next/static/*
    Cache-Control: public, max-age=31536000, immutable
  ```

## 微信登录

微信开放平台网站应用审核通过后，将回调地址配置为：

```text
https://atlas.sololeveling.top/api/auth/wechat/callback
```

再设置 Cloudflare Secrets（`bunx wrangler secret put WECHAT_APP_ID` / `WECHAT_APP_SECRET`）。未同时配置两个值时，登录框只显示“等待开放平台配置”，不会发起 OAuth。

## 备份

本机需要 Bun、Wrangler 登录态、`jq`，建议装 `age` 用于加密：

```bash
bun run backup:remote                                   # 输出到 backups/<UTC 时间戳>/
BACKUP_AGE_RECIPIENT=age1... bun run backup:remote      # 额外产出 <目录>.tar.gz.age
```

产物：`d1.sql`（完整 D1，含密码哈希与用户数据）、`r2/<object_key>`（数据库引用的全部图片）、`manifest.sha256`（逐文件校验和）、`backup-meta.txt`。脚本以 `umask 077` 运行，目录仅当前用户可读。

- 保留策略：本机保留最近 4 份每日备份 + 最近 3 份月度备份（约 7 份）；每月抽查一次恢复演练并记录。
- 明文目录等同生产数据：加密后复制到与 Cloudflare 账号隔离的存储，然后删除本机明文副本（脚本会提示，但不会自动删除）。
- 没有 `age` 时只能得到明文备份，务必手动加密（`tar -czf - <目录> | age -r <recipient> -o <目录>.tar.gz.age`）。

## 恢复

```bash
# 1) 只校验 + 恢复到自动创建的临时库（安全默认值，不会碰生产）
bun run restore:remote --dir backups/20260814T031248Z
# 2) 确认临时库数据正确后再恢复生产（危险，需要显式 --confirm）
bash scripts/restore-cloudflare.sh --dir backups/20260814T031248Z --prod --confirm
# 3) 图片按 manifest 校验后写回生产桶
bash scripts/restore-cloudflare.sh --dir backups/20260814T031248Z --r2 --confirm
```

脚本会先校验 `manifest.sha256`，校验失败立即退出；对生产库或生产桶的写入必须显式 `--confirm`；临时库默认命名为 `jiangcheng-atlas-restore-<UTC 时间戳>`，演练后可用 `bunx wrangler d1 delete <库名>` 清理。恢复生产后立刻跑 `BASE_URL=https://atlas.sololeveling.top bash scripts/smoke.sh`。

## 监控

- **已配置**：`.github/workflows/monitor.yml` 每 15 分钟（`workflow_dispatch` 可手动触发）检查 `https://atlas.sololeveling.top/api/health`，并附带 `/`、`/sitemap.xml`、`/robots.txt` 的 200 校验；失败时工作流变红，结果写入 run summary。GitHub 定时任务失败会通知仓库 watch 设置里勾选了 Actions 的人。
- 建议再在 Cloudflare Notifications 加一条 “Workers 错误率/请求失败” 告警作为双保险。
- 告警责任人：**待填写**（当前为仓库维护者）；处理时限：15 分钟内确认，1 小时内给出结论。
- `/api/health` 返回 `200 {"status":"ok"}` 表示 Worker 与 D1 可用，失败返回 503。Cloudflare Workers Observability 已启用，生产错误使用结构化事件名记录。
- 每周检查一次治理后台的待处理举报；每月执行并抽查一次备份与恢复演练。
