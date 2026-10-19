# 平台/运维审计（task-3）

审计对象：工作树（未提交改动视为事实来源）。方法：静态阅读配置/脚本/CI/路由 + 读取 lead 基线日志（/tmp/atlas-audit/*.log）+ 阅读 `node_modules/next/dist/docs/`、`node_modules/@opennextjs/cloudflare/dist/`、`node_modules/wrangler/wrangler-dist/cli.js` 与 `config-schema.json` 核对命令与开关（未跑全量 build、未改源码）。
结论：**P0 0 条**（未发现已提交密钥/破坏性脚本/自动生产发布）；**P1 9 条**；**P2 10 条**。

## 部署链路现状（事实基线）

- 产物：`opennextjs-cloudflare build` → `.open-next/worker.js` + `.open-next/assets`；`wrangler.jsonc:5,12-15` 用 `main` + ASSETS 绑定，`routes` 为自定义域 `atlas.sololeveling.top`（`:7-9`），`account_id` 写在仓库里（`:4`，属可接受但建议改为环境变量 `CLOUDFLARE_ACCOUNT_ID`）。
- 数据：D1 `jiangcheng-atlas-db`（`:20-26`，`migrations/` 0001-0010 与默认迁移目录一致）、R2 `jiangcheng-atlas-media`（`:27-32`）、4 个限流绑定（`:33-66`，代码里全部启用，见 `app/api/auth/login/route.ts:12`、`lib/admin-auth.ts:108` 等）。
- 触发：CI（`.github/workflows/ci.yml`）只验证不部署；生产由人工 `package.json:13` 部署（见 P2-9/P2-10）。
- 成本敏感点：图片经 Worker 回源 R2（P1-3）、全站无边缘缓存（P1-2）、observability 全量采样（P2-5）。

## P0

无。已核对：仓库历史（`git log --all --diff-filter=A`）从未提交 `.dev.vars`/`.env`/`*.pem`；CI 无部署步骤，不会误发生产。

## P1

### P1-1 生产 `next build` 也会启动 wrangler/miniflare，构建不可复现且在受限环境直接失败
- 证据：`next.config.ts:2,4` 在模块顶层无条件调用 `initOpenNextCloudflareForDev()`；适配器实现 `node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.js:76-84` 只按“是否存在 AsyncLocalStorage”判断，不区分 dev/build。`/tmp/atlas-audit/build.log:19-47`：`$ next build` → `Using secrets defined in .dev.vars` → `EPERM ... ~/Library/Preferences/.wrangler/logs/...` → `error: script "build" exited with code 1`。
- 影响：构建结果依赖开发者本机 `.dev.vars`（读取本机密钥）与 `$HOME` 可写；CI/沙箱/只读 HOME 环境 `opennextjs-cloudflare build` 直接失败，即“本地能发、CI 发不了”。
- 改法：把初始化限制在开发态：`if (process.env.NODE_ENV === "development") { void initOpenNextCloudflareForDev(); }`（`next dev` 加载配置时 NODE_ENV 已是 development，本地开发不受影响）。注意 wrangler 4.111 **不支持** `WRANGLER_HOME`（`cli.js` 中命中 0 次），只支持 `WRANGLER_LOG_PATH`（1 次），仅设日志路径不足以绕过 registry 写入，别把它当修复手段。

### P1-2 全站没有边缘/ISR 缓存：OpenNext 缓存与 Worker 缓存都未启用
- 证据：`open-next.config.ts:3` 使用空配置 `defineCloudflareConfig()`；默认值见 `node_modules/@opennextjs/cloudflare/dist/api/config.js:9,45-59`：`incrementalCache`/`tagCache`/`queue` 全为 `"dummy"`、`enableCacheInterception=false`。所有页面/接口均 `export const dynamic = "force-dynamic"`（如 `app/place/[slug]/page.tsx:11`、`app/sitemap.ts:8`）。`wrangler.jsonc` 未配置 Worker 缓存（schema 顶层支持 `cache: { enabled, cross_version_cache }`，`node_modules/wrangler/config-schema.json#/definitions/CacheOptions`）。
- 影响：每个 HTML 请求（含爬虫）都完整 Worker 渲染 + D1 查询；`app/place/[slug]/page.tsx:19-31` 每次请求拉全量已发布地点再 `.find(slug)`；`app/sitemap.ts` 每次抓取跑 2 条查询。TTFB、冷启动 CPU、D1 读量、成本随爬虫流量线性上涨，且 `revalidate` 类优化在当前配置下是空操作。
- 改法：`open-next.config.ts` 配 R2 增量缓存 + D1 tag 缓存（`incremental-cache/r2-incremental-cache`、`tag-cache/d1-next-tag-cache`，均在 `dist/api/overrides/` 可用），并给地点/活动/sitemap 加 `revalidate`（如 300/60s）；若坚持 force-dynamic，则给 `/api/places` 类公共读接口用 Cache API 或 Cache Rules 落边缘缓存。

### P1-3 图片全部经 Worker 回源 R2，且未做条件请求与边缘缓存
- 证据：`app/media/[...key]/route.ts:3` `force-dynamic`；`:17` 每次 `env.MEDIA.get`；`:27` 设 `ETag` 但全文没有 `If-None-Match` 比较，永远返回 200 全量体；`:28` `Cache-Control: immutable` 只对浏览器生效（Worker 生成的响应默认不进 Cloudflare 边缘缓存，除非启用 Worker 缓存/Cache API/Cache Rules，参见 [Cloudflare Workers 缓存文档](https://developers.cloudflare.com/workers/cache/)）。
- 影响：每次图片展示 = Worker 调用 + R2 Class B 读 + 全量字节过 Worker；图片是主要流量来源，成本与耗时都放大（`s-maxage` 在 Worker 路由上同样不生效）。
- 改法：给 R2 bucket 绑定自定义域（如 `media.atlas.sololeveling.top`）由 CDN 直出，`/media/*` 仅保留给受限对象；或在路由内 `caches.default.match/put` + 命中 `If-None-Match` 返回 304。

### P1-4 缺 CSP 与 HSTS，且 `headers()` 覆盖不到静态资源
- 证据：`next.config.ts:9-21` 只有 nosniff/X-Frame-Options/Referrer-Policy/Permissions-Policy，无 `Content-Security-Policy`、无 `Strict-Transport-Security`。
- 影响：有用户生成内容 + 管理后台的站点缺 XSS 纵深防御；无 HSTS 时首次访问/降级攻击面保留。
- 改法：按 Next 16 官方做法用 `proxy.ts`（16 起 Middleware 更名 Proxy，见 `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`）下发 nonce CSP，先上 `Content-Security-Policy-Report-Only`；HSTS 在 Cloudflare 边缘开启（或 `public/_headers`，仅对 ASSETS 直出的静态文件生效——wrangler 资源层支持 `_headers`）。注意 `next.config.ts` 的 headers 只作用于 OpenNext 处理的请求，`/_next/static/*` 由 ASSETS 绑定直出，部署后必须 `curl -I` 实测两条路径。

### P1-5 发布手册缺密钥校验与回滚，只有单向流程
- 证据：`OPERATIONS.md:5-13` 发布前检查无 `wrangler secret put/list`；`:37-40` 只写 WECHAT_*；`README.md:66-68` 才有 ADMIN_PASSWORD/ADMIN_SESSION_SECRET/USER_AUTH_SECRET。全文无回滚章节（wrangler 4.111 支持 `wrangler rollback`、`versions upload`、`deployments status`，均已核对存在）。
- 影响：新环境/换帐号重建时易漏配三个密钥（后台登录与用户登录直接不可用）；坏版本只能“再发一次”修，D1 迁移只有 up 没有回滚说明。
- 改法：把 `bunx wrangler secret list`（校验 3+2 个名字存在）加入发布前检查；新增“回滚”章节：`wrangler versions list` → `wrangler rollback <version-id>`，并写明迁移不可逆时只前滚、先备份。

### P1-6 备份落盘权限与完整性都不达标
- 证据：`scripts/backup-cloudflare.sh:10,18` 用 `mkdir -p`（默认 0755）创建备份与图片目录；`:11-13` 导出完整 D1 SQL（含 `users` 密码哈希/盐、用户 PII）与 R2 对象；`:23-24` 只提示“请加密后复制”，脚本本身不加密、不算校验和、不生成清单；`:13` 无 `jq`/wrangler 登录态预检；无恢复脚本（`OPERATIONS.md:54` 仅为文字描述）。命令用法本身正确（`r2 object get --remote`、`d1 export --skip-confirmation` 在 wrangler 4.111 中均存在，已核对 `cli.js`）。
- 影响：同机其他用户/同步盘/误复制即可拿到全量账号数据；无法证明备份可用，恢复靠临场手写命令。
- 改法：脚本开头 `umask 077`；导出后 `age`/`gpg` 加密并写 `manifest.sha256`；新增 `scripts/restore-cloudflare.sh` 支持导入临时 D1 校验；OPERATIONS.md 增加季度恢复演练记录；保留策略（如保留最近 7 份 + 每月 1 份）。

### P1-7 CI 不覆盖任何真实运行路径
- 证据：`.github/workflows/ci.yml:20-25` 只有 install/lint/typegen/tsc/test/opennext build；`tests/` 5 个文件 37 个用例全是纯函数单测（`node:test`，覆盖 `lib/activity-format|validation|calendar|user-auth`），没有 route/repository/集成测试，没有 preview 冒烟。
- 影响：本次新增的 `app/sitemap.ts`、`app/robots.ts`、`app/media/[...key]/route.ts`、`public/og.png` 全部无测试；响应头、SEO、媒体路由回归只能靠人肉 curl。
- 改法：CI 在 build 后起 `wrangler dev`（本地模式）跑一组冒烟：`/api/health` 200、`/sitemap.xml` 含 `<urlset`、`/robots.txt` 含 sitemap、`/media/<存在的key>` 返回 `content-type` 与 304/200、`/place/<slug>` 200；把 `OPERATIONS.md:15-25` 的 curl 清单脚本化为 `scripts/smoke.sh`，本地与 CI 共用（当前脚本也无执行位，`-rw-r--r--`，建议 `chmod +x` 并提交）。

### P1-8 CI 工程化缺项：无并发控制、无缓存、无类型漂移与依赖审计
- 证据：`.github/workflows/ci.yml:3-6` 无 `concurrency`；`:15-25` 无 `actions/cache`；`package.json:14` 有 `cf-typegen` 但 CI 不执行（`cloudflare-env.d.ts` 是跟踪文件，绑定变更后 tsc 仍按旧类型通过）；无 `bun audit`/Dependabot（`.github/` 下仅 `workflows/`）；`actions/checkout@v4`、`oven-sh/setup-bun@v2` 未按 SHA 固定。
- 影响：PR 连续推送重复排队耗分钟数；每次全新下载依赖；`wrangler.jsonc` 与 `cloudflare-env.d.ts` 漂移无感知（例如新增限流绑定时前端/服务端类型不同步）；供应链与已知漏洞无监控。
- 改法：加 `concurrency: { group: ${{ github.ref }}, cancel-in-progress: true }`；缓存 `~/.bun/install/cache`；CI 执行 `bunx wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts --include-runtime=false && git diff --exit-code cloudflare-env.d.ts`；加 `bun audit`（或 `bun outdated` 报告）；action 固定 SHA；加 `.github/dependabot.yml`（bun 生态 + actions）。

### P1-9 监控告警只有“建议”，没有落地配置
- 证据：`OPERATIONS.md:56-61` 明确写“建议在 Cloudflare Health Checks 或独立监控服务中每 5 分钟检查 `/api/health`”；仓库内无任何监控/告警配置或脚本；`wrangler.jsonc:16-19` 仅开 observability（`head_sampling_rate: 1` 全量采样）。
- 影响：故障只能靠用户或人工发现；`/api/health` 已经能返回 503（`app/api/health/route.ts:11-14`），但无人消费。
- 改法：在 Cloudflare Notifications/外部 uptime 服务按 OPERATIONS.md 阈值落一条真实告警（连续 2 次失败）；把“建议”改为“已配置 + 责任人”；必要时把采样率降到 0.1–0.5 控制日志成本。

## P2

1. **`.mimosa/` 未进仓库 `.gitignore`**：`git check-ignore -v .mimosa` 命中 `/Users/liuyi/.gitignore_global:1`，即只有本机全局忽略；其他机器/CI 上会以未跟踪目录出现，易被 `git add -A` 带入（内含 hook 状态/报告）。改法：`.gitignore` 增 `/.mimosa/`。
2. **发布源与部署源不一致**：工作树有 13 个未跟踪文件（`app/sitemap.ts`、`app/robots.ts`、`app/error.tsx`、`app/global-error.tsx`、`app/not-found.tsx`、`public/og.png` 等）。任何基于 git 的部署（CI checkout、`git archive`、Workers Builds）都会漏掉 SEO/错误页。改法：发布前 `git status --porcelain` 必须为空的 gate。
3. **`tsconfig.json:15` `types: ["@cloudflare/workers-types"]`** 只保留 Workers 全局，排除 `@types/node` 全局；当前 tsc 通过，但以后用 Node 全局（`process`/`Buffer`/`setImmediate`）会静默漏检。改法：`"types": ["@cloudflare/workers-types", "node"]`。
4. **`wrangler.jsonc:6` `workers_dev: true`** 与自定义域并存 → 站点有第二个公网入口，重复内容/非预期暴露。改法：确认后设为 `false`（`preview_urls` 本版本默认已是 `false`，无需处理）。
5. **`head_sampling_rate: 1`**（`wrangler.jsonc:18`）全量采样；流量上来后按需下调（见 P1-9）。
6. **`tsconfig.tsbuildinfo`、`.DS_Store` 等**已被 `.gitignore:29,46` 覆盖，未跟踪、未误提交（`git ls-files` 仅 88 个受跟踪文件，无产物）；`output/`、`.playwright-cli/`、`backups/` 同样只在本机存在——`.playwright-cli/` 内含浏览器 console 日志，建议确认其中无会话信息后清理。
7. **`components/admin-console.tsx:4` 使用 `next/image`**：适配器有 `/_next/image` 处理器（`dist/cli/templates/images.js`），但本仓库未在 Cloudflare 环境验证过（本次未跑 preview）。改法：部署后 `curl -I '/_next/image?url=...'` 验证，否则设 `images: { unoptimized: true }`。
8. **`.dev.vars` 的密钥生命周期无文档**：`README.md:38-44` 定义本地变量，`:66-68` 要求 `wrangler secret put`，但没有轮换步骤与影响面（轮换 `ADMIN_SESSION_SECRET`/`USER_AUTH_SECRET` 会使既有会话/密码校验失效）。改法：补一段轮换 runbook（先加新值、观察、再失效旧值，注明用户需重设密码的影响）。
9. **发布清单重复构建一次**：`OPERATIONS.md:10` 跑 `bun run build`（= `next build`），`:12` 的 `bun run deploy`（`package.json:13`）内部又会执行 `opennextjs-cloudflare build` → 第二次 `next build`。改法：清单里删掉独立 `bun run build`，只保留 `bunx next typegen` + `bun run deploy`（本地要预览产物用 `bun run preview`）。
10. **部署方式无单一事实来源**：`package.json:12-13` 是手工部署，CI 不部署，但 `git log` 存在 “触发 Cloudflare Workers Builds 自动部署验证” 提交，而 `wrangler.jsonc` 没有 `build` 配置、OPERATIONS.md 也未描述该路径。改法：明确二选一并在文档写清触发条件/构建命令/回滚入口。

## 已核实无问题（避免误判）

- 密钥未泄露：`.dev.vars`（166B，仅 3 个变量名 ADMIN_PASSWORD/ADMIN_SESSION_SECRET/USER_AUTH_SECRET，未读取值）被 `.gitignore:40` 排除；`git log --all --diff-filter=A` 无 `.dev.vars`/`.env`/`*.pem`/`*.key` 记录；`git ls-files` 无产物、无 `.DS_Store`、无 `tsconfig.tsbuildinfo`。
- 依赖一致性：`bun.lock`（lockfileVersion 1）与 `package.json` 的固定版本一致，含 `next@16.3.0`、`@opennextjs/cloudflare@1.20.2`、`wrangler@4.111.0`；`bun test` 37 pass，`tsc --noEmit` 通过（lead 基线）。
- 备份命令有效性：`wrangler r2 object get --remote`、`wrangler d1 export --skip-confirmation --output` 在 wrangler 4.111 中存在；对象键有 `""`/绝对路径/`..` 防护（`scripts/backup-cloudflare.sh:15-17`）。
- 迁移与绑定：`migrations/0001..0010` 与 `wrangler.jsonc` 默认 `migrations` 目录一致；4 个限流绑定与 `cloudflare-env.d.ts:6-9` 完全对应；`/api/health`（`app/api/health/route.ts:9`）真查 D1。
- SEO 基础：`public/og.png` 实测 1200×630；`layout.tsx:18-45` metadataBase/OG/Twitter 完整，`app/place/[slug]/page.tsx:68-92`、`app/event/[id]/page.tsx:56-86` 各自设置 canonical 与 OG（不会误继承首页 canonical），JSON-LD 有 `<` 转义（`app/place/[slug]/page.tsx:177-181`），`robots.ts` 正确指向 sitemap。

## 环境限制

`opennextjs-cloudflare preview`/`wrangler dev` 未在本会话运行（沙箱禁止写 `~/Library/Preferences`，与 P1-1 同源），因此 P1-3/P1-4/P2-7 的线上实际响应头与 `/_next/image` 行为属“待实测”，报告中已按待验证标注，未作为已确定结论。

## 建议执行顺序（1 天可完成）

1. 修 `next.config.ts:4` 的 dev 守卫（P1-1）；2. CI 加并发/缓存/`wrangler types` 漂移检查 + 冒烟脚本（P1-7/P1-8）；3. `umask 077` + 备份加密/清单/恢复脚本（P1-6）；4. `open-next.config.ts` 配 R2 缓存 + 页面 `revalidate`、R2 自定义域直出图片（P1-2/P1-3）；5. `proxy.ts` CSP Report-Only + 边缘 HSTS（P1-4）；6. OPERATIONS.md 补密钥校验与回滚（P1-5）、落一条真实告警（P1-9）；7. `.gitignore` 补 `/.mimosa/` 与发布前工作树 gate（P2-1/P2-2）。
