# 江城图志 · 优化审计报告

- 审计对象：当前工作树（含全部未提交改动），只读审计，未改动任何源码。
- 审计日期：2026-10-19
- 方法：Lead + 3 名审计员分头精读（后端/安全、前端/性能、平台/运维），Lead 对关键结论逐条复核（含 headless Chrome 实测、sqlite3 `EXPLAIN QUERY PLAN` 复核、安全边界 POC），最后汇总去重。
- 明细证据：`audit/backend-security.md`、`audit/frontend-ux.md`、`audit/platform-ops.md`（本文件是汇总与优先级裁决，冲突处以本文件为准）。本文件与 `audit/` 均为本次审计新增产物，可随时删除，不影响构建与部署。

---

## 0. 结论摘要

底子是好的：类型严格、37 个单测全过、CI 有 install/lint/typegen/tsc/test/build 五道关；鉴权骨架、参数化 SQL、JSON-LD 转义、报名容量原子写都是正确写法（详见第 8 节"已核实无问题"）。

真正需要立刻处理的是 **3 个 P0**：

1. **内容页完全无法滚动**（`/place/*`、`/event/*`、`/privacy`、`/community-guidelines`）：全局 `html, body { overflow: hidden }` + 内容页只用 `min-height: 100vh`，没有真正的滚动容器。已用 headless Chrome 实测：390×844 视口下页面内容高 1489px、文档 `scrollHeight` = 视口 701px，**无法滚动的部分永久不可见**。分享落地页会直接翻车。
2. **管理员登录 fail-open**：未配置 `ADMIN_PASSWORD` 时，空密码即可登录后台（已用 Node 复现哈希相等）。生产是否已配置 secret 需 `wrangler secret list` 确认，但代码必须 fail-closed。
3. **部署源 ≠ git**：`/place`、`/event`、`sitemap`、`robots`、错误页、分享图、日历接口等一整套新功能都还是未跟踪文件（9 个已修改 + 18 个新文件）。任何基于 git 的部署（CI checkout、Workers Builds、`git archive`）都会丢掉这些页面。

性能大头：首页 first-load JS **1.68 MB raw / 492 KB gzip**（其中 maplibre + gsap 318 KB gz），Noto Sans SC 构建出 **106 个 @font-face / 4.6 MB 字体**（首屏会按 unicode-range 拉取 1 MB 量级的子集），`public/places` 原图 3.5 MB 直接用在 98px 高的卡片里。基础设施上：全站无 ISR/边缘缓存、图片全部经 Worker 回源 R2、无 CSP/HSTS、CI 无任何运行路径测试。

建议节奏：**今天 30 分钟先做 8 条速胜（第 7 节）→ 本周修 P1 → P2 按需**。

---

## 1. 基线（实测，非估算）

| 项目 | 结果 | 证据 |
|---|---|---|
| `bun run lint` | 0 error / 5 warning | `/tmp/atlas-audit/baseline.log` |
| `bunx tsc --noEmit` | 通过 | 同上 |
| `bun test` | 37 pass / 0 fail（5 个文件，均为纯函数单测） | 同上 |
| `opennextjs-cloudflare build` | 成功（本机需可写 `$HOME`，见 P1-14） | `/tmp/atlas-audit/build2.log`，`.open-next/` |
| 首页 first-load JS | 12 个同步 chunk，**1.68 MB raw / 492 KB gzip** | 解析 `.next/server/app/index.html` 实测 |
| 其中地图 chunk | `36ou2_z9y85hl.js` 1.13 MB raw / **318 KB gz**（maplibre + gsap） | chunk 内容标识符 + 上游包对比 |
| CSS（首页） | 字体 92 KB raw / 32 KB gz + maplibre 68 KB / 9 KB gz + Tailwind/globals 54 KB / 11 KB gz | 4 个 `.next/static/chunks/*.css` |
| 字体产物 | **106 个 @font-face / 104 个 woff2 / 4.6 MB** | `.open-next/assets/_next/static/media` |
| 地点图片 | 9 张 JPEG 共 3.5 MB，单张 237–632 KB | `public/places/*.jpg` |
| 静态资源总计 | **10 MB** | `.open-next/assets` |
| 未提交内容 | 9 个已修改 + 18 个未跟踪新文件（整套分享/SEO 功能） | `git status --untracked-files=all` |
| 缓存 | 无 ISR、无 Worker 边缘缓存；页面/接口全 `force-dynamic` | `open-next.config.ts`、各 `export const dynamic` |
| 测试覆盖 | 仅 `lib/` 纯函数；route/repository/页面/媒体路由 0 测试 | `tests/` |

> 环境注记：本机 `PATH` 里的 `bun`/`bunx` 是坏的 vite-plus shim（报 `Operation not permitted`），审计时统一用 `~/.bun/bin/bun`；这是本机环境问题，不记入项目缺陷。

---

## 2. P0（立即修）

### P0-1 内容页无法滚动（必现，影响所有分享落地页）

**位置**：`app/globals.css:21`（`html, body { width:100%; height:100%; margin:0; overflow:hidden }`）；受影响页面 `app/place/[slug]/page.tsx:104`、`app/event/[id]/page.tsx:103`、`app/privacy/page.tsx`、`app/community-guidelines/page.tsx`（`.detail-page` 见 `app/globals.css:492`、`.policy-page` 见 `:481`、`.status-page` 见 `:533`，均只有 `min-height:100vh; overflow-y:auto` 而没有高度约束，因此不构成滚动容器；错误页 `.status-page` 内容少，通常不触发）。

**证据（headless Chrome 实测）**：把 `/privacy` 预渲染 HTML 内联 CSS 后，390×844 视口下：
`{"innerH":701,"scrollH":701,"bodyScrollH":1489,"bodyOverflow":"hidden","htmlOverflow":"hidden"}`。
把 `html,body` 改为 `overflow:visible` 后：`scrollH:1489` —— 内容确实高出 788px，但默认样式把它裁掉了。
`.detail-page` 用的是同一套「全局 overflow hidden + min-height」组合，`/place`、`/event` 同样中招（`globals.css:605` 的移动端样式还预留了底部 padding，说明原本预期可滚动）。

**修法**（1 行级改动）：删除 `html, body` 上的 `overflow: hidden`。地图页不需要它——`.atlas-shell` 本身是 `position: fixed; inset: 0`，不产生页面滚动；如需防止 iOS 回弹，给 `.atlas-shell` 加 `overscroll-behavior: none`。修完用上面的 headless Chrome 方法回归 5 个页面。

### P0-2 未配置 `ADMIN_PASSWORD` 时空密码可登录管理后台（fail-open）

**位置**：`lib/admin-auth.ts:48-51` + `:35-37`；`app/api/admin/session/route.ts:43,47`。
**证据**：`env.ADMIN_PASSWORD` 缺失时为 `undefined`，`TextEncoder.encode(undefined)` 等价于 `encode("")`，两侧同为 `SHA-256("")`；路由只校验 `typeof password === "string" && length <= 256`，空串通过 → 直接下发 8 小时管理员 Cookie。已用 Node 复现 `sha256(encode(undefined)) === sha256(encode(""))`。
同类隐患：`env.ADMIN_SESSION_SECRET` 缺失时 `verifyAdminSession` 的 HMAC key 为空串，攻击者可自行伪造管理员 Cookie（不需要密码）。
**现实性**：`wrangler.jsonc` 没有 `vars`，3 个 secret 只能靠 `wrangler secret put` 注入；而 `OPERATIONS.md:3-13` 的发布清单只提到 WeChat 两个 secret，这 3 个从未被文档化要求。生产是否已配置需 `bunx wrangler secret list` 确认；无论是否配置都要修。

**修法**：
```ts
// lib/admin-auth.ts
export async function passwordsMatch(candidate: string, expected: string | undefined) {
  if (typeof expected !== "string" || expected.length === 0) return false; // fail-closed
  const [candidateHash, expectedHash] = await Promise.all([digest(candidate), digest(expected)]);
  return equalBytes(candidateHash, expectedHash);
}
export async function verifyAdminSession(token: string | undefined, secret: string | undefined) {
  if (!token || typeof secret !== "string" || secret.length === 0) return false;
  ...
}
// app/api/admin/session/route.ts（比对前）
const expected = env.ADMIN_PASSWORD;
if (typeof expected !== "string" || expected.length < 16)
  return NextResponse.json({ error: "管理员凭据未配置" }, { status: 503 });
```
同时：把 3 个 secret 写进 `OPERATIONS.md` 发布清单；`/api/health` 增加 `secretsConfigured` 布尔自检（不泄露值）；生产值 <16 位也应视为未配置。

### P0-3 部署源 ≠ git：整套分享/SEO 功能尚未提交

**位置**：`git status`（9 modified + 18 untracked）。未跟踪的包括：`app/place/`、`app/event/`、`app/api/activities/[id]/calendar/`、`app/error.tsx`、`app/global-error.tsx`、`app/not-found.tsx`、`app/robots.ts`、`app/sitemap.ts`、`lib/activity-format.ts`、`lib/calendar.ts`、`lib/navigation.ts`、`lib/site.ts`、`public/og.png`、`scripts/generate-og-image.py` 及 4 个新测试。
**影响**：任何基于 git 的发布路径都会让 `/place/<slug>`、`/event/<id>`、sitemap、分享图、日历导出、错误页变成 404/缺失；`git log` 里还有「触发 Cloudflare Workers Builds 自动部署验证」的提交，说明确实存在 git 驱动的部署路径。
**修法**：先提交这批工作（或至少 `git add -A && git commit`）；在 `OPERATIONS.md` 发布前检查加入 `test -z "$(git status --porcelain)"` 作为 gate；确认生产到底是人工 `bun run deploy` 还是 Workers Builds，二选一写进文档（见 P1-18）。

---

## 3. P1 · 首屏与交互性能

### P1-1 中文字体：106 个 @font-face / 4.6 MB，首屏估算拉取 1 MB 量级

**位置**：`app/layout.tsx:7-11`（`Noto_Sans_SC({ subsets: ["latin"] })`），`app/globals.css:15,22` 把它设为正文首选字体。
**证据**：构建 CSS `1lygnpdpp58b5.css` 中 95 KB（占该文件 99%）全是 `@font-face`，共 **106 个 face、104 个 woff2、4.6 MB**；`subsets` 只影响是否输出 `<link rel=preload>`（首页仅 2 个），不影响 self-host 与按需下载。首页 SSR HTML 493 个唯一汉字、HTML+全部 JS 706 个，按 `unicode-range` 求解会命中 20–30 个 subset，**首屏字体字节约 1–1.4 MB**（前端审计按 781 字集估算 27 个文件 / 1.35 MB）。
**收益**：改回系统 CJK 栈可省 4.6 MB 构建产物 + 32 KB gz 阻塞 CSS + 首屏 MB 级字体流量，并消除中文 `font-display: swap` 的二次重排。`--font-cn` 里已有 `"PingFang SC", "Microsoft YaHei"` 兜底，观感差异很小。
**修法（最省）**：删掉 `Noto_Sans_SC`，`--font-cn: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;`，仅保留 Space Grotesk 装饰字体。
**修法（要统一字体）**：按站点文案做字集子集（pyftsubset/glyphhanger），产出一个 ~60–150 KB 的 woff2，用 `next/font/local` 引入并设 `preload: false`。

### P1-2 首页 JS 492 KB gz：maplibre + gsap 静态 import；maplibre CSS 全站加载

**位置**：`components/map-explorer.tsx:3-4` 静态 `import maplibregl` / `import { gsap }`；`app/page.tsx:1` 静态引入该组件；`app/layout.tsx:3` 全局 `import "maplibre-gl/dist/maplibre-gl.css"`。
**证据**：地图 chunk 1.13 MB raw / 318 KB gz（maplibre ≈276 KB gz + gsap ≈28 KB gz），占首页 JS 62%；maplibre CSS 68 KB raw / 9 KB gz 出现在**所有页面**（含 `privacy.html`、`community-guidelines.html` 等纯文本页）。gsap 全站只用于 4 处装饰动画（`map-explorer.tsx:950,984,1010` 等）。
**修法**：
1. gsap → CSS 动画或 `await import("gsap")`（省 ~28 KB gz，最低风险）；
2. maplibre CSS 从 `app/layout.tsx:3` 移到地图页面（App Router 允许在 page/component 中 import 全局 CSS，需在 `/` 上验证）；
3. maplibre 惰性化：先渲染地图容器骨架，`requestIdleCallback`/`useEffect` 内 `import("maplibre-gl")` 后再建图（首屏 JS 可降到 ~180 KB，-63%，改动最大，需回归深链、创建差事、地图交互）。
4. 可选：换自定义深色 style JSON，省掉 `applyMissionMapTheme` 40+ 次 `setPaintProperty` 与“亮色底图闪一下”（`map-explorer.tsx:696-697`）。

### P1-3 图片原图直接用在 98px 高卡片 / 详情页，无 srcset

**位置**：`components/map-explorer.tsx:1283,1325`（`backgroundImage`），`app/place/[slug]/page.tsx:117`、`app/event/[id]/page.tsx:116`（`<img>` 原图）；`.detail-visual` / `.mission-visual` 高度 98px / 92px（移动端 82px）。
**证据**：`public/places` 9 张 JPEG 共 3.5 MB，单张 237 KB（east-lake）–632 KB（yellow-crane-tower）；无缩略图、无 `srcset`、列表页与详情页共用同一原图。
**收益**：点开地点从最多 632 KB 降到 ~15–25 KB（-96%），并避免在 98px 容器里解码 1280px 图片造成主线程卡顿。
**修法**：构建期生成 320/640/1280 三档 WebP/AVIF（Pillow 脚本或 sharp CLI，仓库已有 `scripts/` 惯例），卡片用 320，详情页用 `srcset+sizes`；`next/image` 在 OpenNext/Workers 上需确认 loader（见 P2-9），当前建议先静态多档产物最稳。

### P1-4 地图拖动时每帧 React setState + 每帧重绘 `backdrop-filter` 卡片

**位置**：`map-explorer.tsx:921-931`（`map.on("move")` → `map.project()` → `setDetailPosition`），消费点 `:1277`、`:1320`（`style={{left, top}}`）；卡片样式 `app/globals.css:210,219-220` 含 `backdrop-filter: blur(26px)`。
**影响**：拖拽/惯性期间 60fps 的 React commit + 大面积 blur 重采样，移动端掉帧明显；`reactCompiler` 只能 memo JSX 子树，省不掉定位与该重绘。
**修法**：详情卡改用 `maplibregl.Marker({ element })` 承载（由 MapLibre 按帧更新，不进 React），或在 `move` 回调里用 ref 直写 `transform: translate3d(...)`；拖动期间避免改 `left/top`，加 `will-change: transform`。

### P1-5 深链 / 浏览器前进后退不联动

**位置**：`map-explorer.tsx:344-348,361-364,377-380` 全部用 `history.replaceState` 手写 URL；`?place=`/`?event=` 只在 `map.on("load")`（`:845-851`）与挂载 effect（`:1031-1036`）读一次，全文件无 `popstate` 监听。
**影响**：点开地点后按浏览器后退，详情卡不关闭、URL 与 UI 不一致；直接粘贴 `?event=xxx` 时若 `/api/activities` 还没返回，会漏掉深链。
**修法**：改用 `useSearchParams()` + `router.replace(url, { scroll: false })`，由 `useSearchParams` 变化驱动选中态（App Router 原生支持前进/后退与分享）。

### P1-6 其它交互细节（低风险、体感明显）

- **地图错误横幅常驻**：`map-explorer.tsx:853-856` 任意一次 `error` 事件就 `setMapError(true)` 且无复位，瓦片 404/sprite 缺图都会误报；建议只在 `style.load` 失败或连续 N 次错误时置位，并支持关闭/复位（`:1413`）。
- **`currentTime` 冻结在挂载时刻**：`:268` `useState(() => Date.now())`，长驻页面挂机数小时后「进行中/已结束/报名按钮」状态失真；改为每 60s 刷新或按需读 `Date.now()`。
- **手机旋转后地图 padding 不更新**：`getCoreMapPadding()` 只在建图/重置时计算一次（`:201-205,678,406`），旋转后 `maxBounds`/padding 不匹配。
- **`registerMapIcons` 失败会静默废掉整张地图**：`:241-256` 的 Promise 无 catch，`:699` `await` reject 后所有 layer/事件、`setMapReady(true)`、深链全部不执行；至少 `.catch()` + `finally`。
- **可访问性**：`community-auth-modal.tsx:56` 无焦点陷阱/Esc/初始焦点；`map-explorer.tsx:1071-1090` 自建 menu 无键盘导航；详情卡整块 `aria-live="polite"` 会把上千字留言全部播报，而关闭按钮焦点不可达；`map-explorer.tsx:1051` brand 按钮建议补 `aria-label="返回全图视图"`（lint 报的“缺少标签”是误报）。

---

## 4. P1 · 安全与可靠性

### P1-7 限流矩阵缺口（已逐端点核对）

| 端点 | 现状 | 风险 |
|---|---|---|
| `POST /api/profile` PATCH 昵称、DELETE 注销 | 同源 ✅ 登录 ✅ **无限流** | 注销是写 3 张表的破坏性操作，可无限刷 |
| `PATCH /api/notifications` | 同源 ✅ 登录 ✅ **无限流** | 可无限刷 |
| `DELETE /api/activities/[id]/join`（退出） | 同源 ✅ 登录 ✅ **无限流** | 进/出循环刷通知 |
| `DELETE /api/activities/[id]/comments`（隐藏留言） | 同源 ✅ 登录 ✅ **无限流** | 可无限刷 |
| `DELETE /api/auth/session`（登出） | 同源 ✅ 登录 ✅ 无限流 | 无危害，可不加 |
| `GET /api/auth/wechat/start`、`callback` | 无同源/无限流 | OAuth 入口，建议至少加 IP 限流 |

另：`join`/`comments` 每次成功都写一条 `user_notifications`（`join/route.ts:20-22`、`comments/route.ts:69-71`），单账号 30 次/分钟即可对指定发起人形成通知轰炸，接收方无抑制。**修法**：上述写接口统一接 `USER_ACTION_RATE_LIMITER`（key = `user.id`）；通知按 `(user_id,type,activity_id)` N 分钟合并；join 进/出加 10s 冷却。

### P1-8 管理员登录限流是全局单键 → 匿名者可锁死后台

**位置**：`app/api/admin/session/route.ts:34`（`limit({ key: "admin-login" })`）+ `wrangler.jsonc:35-41`（5 次/60s）。
**影响**：任何人每分钟发 5 个 POST 就能让管理员无法登录（含正确密码），且失败登录完全不记录（`:49` 直接 401），没有暴破可观测性；`lib/admin-auth.ts:108` 的 `"admin-mutation"` 同理让所有管理员共享 60 次/分钟。
**修法**：登录键改 `cf-connecting-ip`（可叠加账号维度），失败写审计日志；锁定期用指数退避；`/api/health` 或监控对 429 告警。

### P1-9 `/media/*` 透传 R2 的 Content-Type / Content-Disposition

**位置**：`app/media/[...key]/route.ts:22-24`。**现状**：写入侧 `lib/image-upload.ts` 有 MIME + 魔数校验，当前上传路径安全；但读取侧无条件信任桶内对象元数据，`wrangler r2 object put` 恢复备份、控制台手工上传、未来新入口都可能塞入 `text/html` 对象，与主站同源 → 存储型 XSS（`httpOnly` Cookie 挡不住同源脚本发起写请求）→ 账号接管。
**修法**：读取侧白名单 `image/(jpeg|png|webp|avif)`，其余一律 `application/octet-stream` + `attachment`；忽略存储的 `contentDisposition`；配合 P1-10 的 CSP。另：路由未处理 `If-None-Match`（设了 ETag 但永远 200 全量）、未校验对象所属地点/活动是否已下架（`route.ts:17,27`）。

### P1-10 无 CSP / HSTS，安全响应头不完整

**位置**：`next.config.ts:9-21` 只有 nosniff/X-Frame-Options/Referrer-Policy/Permissions-Policy。
**修法**：Next 16 用 `proxy.ts`（Middleware 已更名 Proxy，见 `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`）下发 nonce CSP，先上 `Content-Security-Policy-Report-Only` 收集违规（外链瓦片、样式内联需放行）；HSTS 在 Cloudflare 边缘开启。注意 `next.config.ts` 的 `headers()` 覆盖不到 ASSETS 绑定直出的 `/_next/static/*`，部署后需 `curl -I` 两条路径实测（平台审计已标“待实测”）。

### P1-11 D1 查询：`status='open'` 无上界增长 + 函数包裹导致索引范围失效（复核校正）

**位置**：`lib/community-repository.ts:68-74`（`datetime(COALESCE(a.ends_at, datetime(a.starts_at,'+2 hours'))) > datetime('now')`、`ORDER BY datetime(a.starts_at)`）、`:97-100`（`OR EXISTS` 查询）；`app/api/activities/[id]/route.ts:48-52` 完成活动不校验开始时间。
**复核结果**（本机 sqlite3 复刻 `migrations/0001–0010` + 2 万行）：
- 无统计信息时走 `SEARCH a USING INDEX idx_activities_moderation_time (moderation_status=? AND status=?)`；**`ANALYZE` 后（数据分布单一/增长到一定规模）优化器转为 `SCAN a` + `USE TEMP B-TREE FOR ORDER BY`**。所以“全表扫描”不是无条件成立，但趋势成立：`ends_at` 被函数包裹无法走范围索引，`ORDER BY datetime(...)` 必然临时排序。
- 根因是**历史活动永远留在 `status='open'`**（只有发起人手动完成/取消），`open+visible` 集合无上界增长，索引选择率持续下降；`listMyActivities` 的 `OR` 查询在任何情况下都是 `SCAN a`。
- 时间格式已统一为 ISO8601（`toISOString()` 与 `migrations/0007` 回填一致），可直接做字符串比较。
**修法**：① 定时任务把过期活动置 `completed`（Cron Triggers 或惰性清理），给 `status='open'` 集合封顶；② 条件改 `a.ends_at > ?`（绑定 ISO 字符串）、排序改 `ORDER BY a.starts_at`；③ `listMyActivities` 拆 `UNION` 两支各走索引；④ 复合索引建议 `(moderation_status, status, ends_at)` 已有，可保留。

### P1-12 内容治理一致性

- **封禁用户的内容仍公开展示**：`listActivities`/评论查询 JOIN `users` 未过滤 `u.status='active'`（`community-repository.ts:65`、`comments/route.ts:34`）；建议列表过滤或封禁时同步隐藏内容。
- **审计日志污染**：`admin/places/[id]/route.ts:28-44,63-74` 在 `UPDATE` 之后才判断 `changes===0`，对不存在/无变化 ID 也会写入 `admin_audit_logs`；应改为 `changes>0` 才追加审计（或 `INSERT ... SELECT WHERE EXISTS`）。
- **完成活动不校验开始时间**：`activities/[id]/route.ts:48-52`，发起人可把未开始的活动标记完成，状态机不一致。
- **登录防爆破只有 IP 维度**：`user-auth.ts:141`；无账号维度计数、无失败审计；老账号（`password_salt IS NULL`）回退单轮 HMAC 快哈希（`user-auth.ts:89,25-39`），登录成功才自动升级。建议加 `(username, ip)` 计数与失败锁定，并一次性迁移消除遗留哈希。
- **D1 故障被静默兜底**：`api/places/route.ts:16-21` 把任意错误都回退到内置种子数据并缓存 60s，故障被掩盖；建议回退响应 `no-store` 并上报指标。
- **错误分类粗糙**：`register`/`activities`/`admin/places`/`reports` 的 catch 把任意 D1 错误映射为 409/500 业务文案（如“账号已被使用”），误报且难排障；`request.formData()`（`activities/route.ts:33`、`admin/media/route.ts:21`）未包 try/catch，畸形 multipart 直接 500。

---

## 5. P1 · 平台与运维

### P1-13 全站没有 ISR / 边缘缓存

**证据**：`open-next.config.ts:3` 是空配置 `defineCloudflareConfig()` → `incrementalCache/tagCache/queue` 全为 `dummy`（`node_modules/@opennextjs/cloudflare/dist/api/config.js:9,45-59`），叠加所有页面/接口 `force-dynamic`。结果：每个 HTML 请求（含爬虫）都完整 Worker 渲染 + D1 查询，`/place/*` 每次拉全量已发布地点再 `.find(slug)`，`sitemap.xml` 每次跑 2 条查询，`revalidate` 类优化当前是空操作。
**修法**：`open-next.config.ts` 接 R2 增量缓存 + D1 tag 缓存（`@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache`、`.../tag-cache/d1-next-tag-cache`，模板见 `node_modules/@opennextjs/cloudflare/templates/open-next.config.ts`），需要新增一个 R2 bucket 绑定；给 `/place`、`/event`、`/sitemap.xml` 加 `revalidate`（如 300/60s），后台改地点后 `revalidatePath`。若坚持全动态，至少给 `/api/places` 这类公共读接口用 Cache API 落边缘缓存。

### P1-14 图片全部经 Worker 回源 R2

**证据**：`app/media/[...key]/route.ts:3,17,27-28`：`force-dynamic`，每次 `env.MEDIA.get`，设了 ETag 但无 `If-None-Match` 比较，`Cache-Control: immutable` 只对浏览器生效——Worker 生成的响应默认不进 Cloudflare 边缘缓存。
**影响**：每次图片展示 = Worker 调用 + R2 Class B 读 + 全量字节过 Worker；图片是本站主要流量，成本与延迟都被放大。**修法**：给 R2 桶绑定自定义域（如 `media.atlas.sololeveling.top`）由 CDN 直出，`/media/*` 仅保留受限对象；或路由内 `caches.default.match/put` + 条件请求返回 304。

### P1-15 构建非 hermetic：`initOpenNextCloudflareForDev` 在生产 build 也会初始化 wrangler

**位置**：`next.config.ts:2,4`。适配器实现（`.../api/cloudflare-context.js:76-102`）只按 AsyncLocalStorage 判断，不区分 dev/build；`next build` 时同样读 `.dev.vars`、起 wrangler/miniflare 并写 `$HOME`。本机首次 build 就是因此 `EPERM` 失败（`/tmp/atlas-audit/build.log:19-47`），换可写 `HOME` 后才成功；同时本地构建会读取开发者本机 `.dev.vars`，构建结果依赖开发者环境，CI 与本地行为不一致（CI 无 `.dev.vars`，能过但同样会多起一次 wrangler）。
**修法**：`if (process.env.NODE_ENV === "development") { void initOpenNextCloudflareForDev(); }`（`next dev` 加载配置时 NODE_ENV 已是 development）。若未来有 SSG 页面需要绑定，再单独处理。注意 wrangler 4.111 不支持 `WRANGLER_HOME`，别把它当解法。

### P1-16 CI 只做静态检查，不覆盖任何真实运行路径

**位置**：`.github/workflows/ci.yml:20-25`。现状 install → lint → `next typegen` → tsc → test → opennext build；无 route/repository/集成/冒烟测试，`app/media`、`sitemap`、`robots`、`place/event` 页面、响应头、SEO 全部无测试。另缺：`concurrency`（连续 push 重复排队）、bun 依赖缓存、`wrangler types` 漂移检查（`cloudflare-env.d.ts` 是跟踪文件，绑定变更后 tsc 仍按旧类型通过）、依赖审计（`bun audit` / Dependabot）、action 固定 SHA。
**修法**：把 `OPERATIONS.md:18-22` 的 curl 清单脚本化为 `scripts/smoke.sh`，CI 在 build 后起 `wrangler dev` 跑一组冒烟（`/api/health` 200、`/sitemap.xml` 含 `<urlset`、`/robots.txt` 含 sitemap、`/place/<slug>` 200、`/media/<key>` 200 + 304、安全响应头存在）；加 `concurrency: { group: ..., cancel-in-progress: true }`、缓存 `~/.bun/install/cache`、CI 执行 `wrangler types ... && git diff --exit-code cloudflare-env.d.ts`；加 `.github/dependabot.yml`。

### P1-17 备份脚本不满足"可恢复"标准

**位置**：`scripts/backup-cloudflare.sh:10,11,23-24`。`mkdir -p` 默认 0755 创建含全量账号 PII/密码哈希的备份；只提示"请加密后复制"，脚本本身不加密、不算校验和、不生成清单；无 `jq`/登录态预检；无恢复脚本；无保留策略。命令用法本身正确（`d1 export --skip-confirmation`、`r2 object get --remote` 在 wrangler 4.111 均有效），对象键有 `""`/绝对路径/`..` 防护。
**修法**：`umask 077`；导出后 `age`/`gpg` 加密 + `manifest.sha256`；新增 `scripts/restore-cloudflare.sh`（先导入临时 D1 校验）；OPERATIONS 增加季度恢复演练；保留最近 7 份 + 每月 1 份。

### P1-18 监控/告警与发布手册只有"建议"

- `OPERATIONS.md:56-61` 明确写"建议"每 5 分钟探活 `/api/health`，仓库内无任何监控/告警配置；`wrangler.jsonc:16-19` observability 采样率 1（全量，流量上来后日志成本高）。
- 发布清单（`OPERATIONS.md:5-13`）无 `wrangler secret list` 校验（P0-2 的直接诱因）、无回滚章节（wrangler 4.111 支持 `wrangler rollback` / `versions list`，已核实）；且清单先 `bun run build`、再 `bun run deploy`（后者内部又跑一次 `opennextjs-cloudflare build`）→ 重复构建。
- **修法**：落一条真实告警（连续 2 次失败），把"建议"改成"已配置+责任人"；发布清单加入 3+2 个 secret 的名字校验、回滚步骤、删除重复 build；明确部署方式（人工 `bun run deploy` vs Workers Builds）并写清触发/回滚入口。

---

## 6. P2 清单（按需，不必一次做完）

**代码与架构**
1. `components/map-explorer.tsx` 1443 行、约 30 个 `useState` 的单体组件：按 `useMapInstance` / `useActivities` / 各 panel 拆分（参考 P1-4，先把每帧状态移出 React）。拆分前先补深链/交互回归。
2. 死代码：`app/api/east-lake/route.ts`（无调用方）、`listCyclingRoutes` / `CyclingRoute` / `cycling_routes` 表（新 UI 不写 `route_id`，只剩 JOIN 占位）、`map-explorer.tsx:872-874` 的 `visibleActivities`（被下一行 filter 抵消）、CSS `.mission-cta`。删除前确认后台/历史数据无依赖。
3. Tailwind v4 引入但 **0 个工具类使用**（全仓库唯一命中是 `legend-category-grid` 的子串）：`@import "tailwindcss"` 只产出 preflight + 99 个 `--tw-*` 变量。要么移除 Tailwind（删 postcss 配置与依赖），要么开始真正使用；当前状态只增加构建复杂度与样式重算成本。
4. 遗留 `subsets:["latin"]` 的字体配置（见 P1-1）。
5. `tsconfig.json`：`target: ES2017` 对 Workers 偏旧（可升 ES2022）；`types` 只含 `@cloudflare/workers-types`，注意未来用 Node 全局会漏检（如需加 `node` 要先验证与 workers-types 的全局冲突）。
6. `wrangler.jsonc:6` `workers_dev: true` 与自定义域并存 → 同一 Worker 有第二个公网入口；确认后关掉。
7. `.gitignore` 补 `/.mimosa/`（目前只被本机全局 gitignore 覆盖，换机器/CI 会以未跟踪目录出现）；`.playwright-cli/` 里是历史 console 日志，建议清理。
8. `next.config.ts:4` 的 floating promise（lint warning）加 `void`/dev 守卫（见 P1-15）。

**SEO / 元数据（都有实测证据）**
9. **canonical 继承 bug**：`app/layout.tsx:29` 的 `alternates.canonical: "/"` 被 `/privacy`、`/community-guidelines` 继承，实测两页 `<link rel="canonical">` 都指向首页 → 会被搜索引擎当重复页丢掉。修法：从根 layout 去掉 canonical，各页面自行声明。
10. **OG 图丢失**：Next 的 `openGraph` 是浅合并（官方文档 `generate-metadata.md:1328-1330`），页面一旦设置 `openGraph` 就整体替换 layout 的；`place`/`event` 无图时没有 `og:image`，微信分享卡片没有图。修法：这两个页面的 `openGraph` 在无图时补 `SITE_OG_IMAGE`。
11. `sitemap.ts` 每条的 `lastModified` 都用 `now`（每次请求都变），对爬虫是噪音；应使用 `places.updated_at` / `activities.updated_at`（需在查询里带出）。
12. `robots.ts:14` 的 `host: SITE_URL` 带了协议；Yandex 的 `Host` 指令只接受主机名。非关键，顺手改。
13. 通知 id 生成方式不统一：`activities/[id]/route.ts:33,74` 用 SQL `lower(hex(randomblob(16)))`，而 `join/route.ts:22`、`comments/route.ts:70` 用 `crypto.randomUUID()`；且 `user_notifications` 无唯一约束，重复通知会产生多行。统一成 UUID 便于排查。

**数据与产品**
14. 过期活动自动 `completed`（P1-11 的根因）；`user_sessions` / `user_notifications` 无清理策略，表会随账号/活动线性增长，建议 Cron Trigger 定期清理（删除 30 天过期 session、90 天已读通知）。
15. 列表无分页：活动 50、评论 100、后台 200 硬上限，超过即静默截断；建议 `limit/offset` 或游标。
16. 公开桶图片在活动取消/下架后仍可取（key 为 UUID，风险低）；可在读取时校验归属状态或删除对象。
17. 通知没有未读角标/轮询，用户不知道有新消息；建议 `/api/notifications` 返回 `unreadCount` 并在头像上显示。
18. 账号能力缺口：无修改密码/找回密码/邮箱验证，忘记密码 = 永久丢号；注销账号只靠 Cookie + 输入"注销"确认（无二次验证）。按产品优先级补。
19. 举报后无法再次举报同一对象（唯一约束冲突一律 409 文案）；建议区分"已举报"并允许补充说明。
20. `app/event/[id]/page.tsx:16-19` 没有 D1 故障兜底（`place` 页有），D1 抖动时活动页直接 500；建议对齐 place 页的降级。
21. 上传：AVIF 魔数校验只检查 `ftyp`，WebP 只检查 RIFF+WEBP，均可被构造文件绕过（仅影响文件类型可信度，不构成 XSS）；建议用更严的 box/结构校验或服务端转码。每活动/用户无配额，R2 成本需关注。
22. `api/auth/wechat/start` 无 Origin/Referer 校验、state Cookie `sameSite: lax`，存在登录 CSRF 路径（需运行时验证微信二维码页是否能被跨站嵌入）；建议 start 加 Origin 校验、state 绑定会话。
23. `app/api/activities/[id]/route.ts` 的完成/取消是"软状态"，历史记录、sitemap、通知都依赖它；建议补状态机测试。

**部署/文档**
24. `package.json` 的 `ignoreScripts` 不是 bun 的字段（bun 用 `trustedDependencies`），确认是否笔误；`@types/node@^20` 与 Node 24 环境不完全对齐（不影响构建）。
25. `OPERATIONS.md` 与 `README.md` 对 secret 的说明不一致（README 有 3 个、OPERATIONS 只有 WeChat）；补密钥轮换 runbook（轮换 `ADMIN_SESSION_SECRET`/`USER_AUTH_SECRET` 会让既有会话/口令校验失效）。
26. `next/image` 目前在 `components/admin-console.tsx:4` 使用；OpenNext 有 `/_next/image` 处理器但本仓库未在 Cloudflare 环境验证，部署后 `curl -I '/_next/image?...'` 验证，否则设 `images: { unoptimized: true }`。
27. 测试缺口：至少补 route handler 测试（用 fake `D1Database`/mock env）、`place/event` 页面快照、`/media` 条件请求、`sitemap/robots` 内容断言；CI 里加 `bun test --coverage`。

---

## 7. 建议执行顺序

### 今天 30 分钟（低风险速胜）
1. `app/globals.css:21` 删 `overflow: hidden`，用 headless Chrome 验证内容页可滚动（P0-1）。
2. `lib/admin-auth.ts` + `app/api/admin/session/route.ts` 加 fail-closed 校验（P0-2）。
3. 提交当前工作树（P0-3），发布清单加 `git status` gate。
4. `app/layout.tsx` 去掉 `Noto_Sans_SC`，改用系统 CJK 栈（P1-1，省 4.6 MB 产物 + MB 级首屏字体）。
5. `next.config.ts:4` 加 `if (process.env.NODE_ENV === "development")` + `void`（P1-15）。
6. `.gitignore` 加 `/.mimosa/`（P2-7）。
7. `app/layout.tsx:29` 移除 canonical，`app/privacy/page.tsx`、`app/community-guidelines/page.tsx` 各自声明 canonical（P2-9）。
8. `app/place/[slug]/page.tsx` / `app/event/[id]/page.tsx` 的 `openGraph` 补默认分享图（P2-10）。

### 本周（P1）
- 第 1 天：限流补齐 + 管理员登录/失败审计（P1-7、P1-8）；`/media` Content-Type 白名单 + 条件请求（P1-9）。
- 第 2 天：gsap 动态化 + maplibre CSS 按路由（P1-2 低风险部分）；地点缩略图生成（P1-3）；详情卡 transform/`Marker`（P1-4）。
- 第 3 天：R2 自定义域 + 媒体边缘缓存（P1-14）；OpenNext R2 增量缓存 + place/event/sitemap `revalidate`（P1-13）。
- 第 4 天：CSP Report-Only + HSTS（P1-10）；D1 过期活动自动完成 + 查询改写（P1-11）；封禁内容过滤/审计日志修正（P1-12）。
- 第 5 天：CI 冒烟脚本 + concurrency/缓存/typegen 漂移检查（P1-16）；备份 `umask 077` + 加密 + 清单 + 恢复脚本（P1-17）；OPERATIONS 密钥校验/回滚（P1-18）。
- 周末可选：深链/popstate、模态焦点管理、地图错误横幅（P1-5、P1-6）。

### 之后（P2）
`map-explorer` 拆分、死代码清理、Tailwind 去留、测试补齐、账号能力（改密/找回）、通知未读、分页、地图加载策略（maplibre 惰性化是收益最大但改动也最大的一条，放在充分回归之后）。

---

## 8. 已核实无问题（避免误伤，也便于 review 时放心）

- **SQL 注入**：全量检索 `prepare()` 调用，全参数化；`admin/community` 的动态 SQL 由 action 白名单查表得到 → 安全。
- **JSON-LD 注入**：`place/[slug]/page.tsx:179`、`event/[id]/page.tsx:187` 均在 `JSON.stringify` 后 `.replace(/</g,"\\u003c")`；其余 `dangerouslySetInnerHTML` 只注入本地常量 SVG。
- **报名容量竞态**：`join/route.ts:13-18` 用单条 `INSERT OR IGNORE ... SELECT ... WHERE count < capacity`，审计复核用原文语句在 bun:sqlite 实测（capacity=2 时第 3 人 `changes=0`、重复加入 0、PUT 降容被拒）→ 正确。
- **会话/密码**：256-bit 随机 token + 仅存 SHA-256；管理员 HMAC 先验签后解析；Cookie `httpOnly` + `SameSite=strict` + 条件 `secure` → 正确。
- **CSRF**：写接口统一 Origin 校验 + SameSite=strict；`x-forwarded-host` 自设绕过只对非浏览器客户端成立（浏览器 Origin 不可伪造），记为加固项而非漏洞。
- **开放重定向**：WeChat 回调只用相对路径 + `encodeURIComponent`。
- **密钥未泄露**：`.dev.vars` 被 `.gitignore` 排除，`git log --all` 无 `.env`/`.dev.vars`/`*.pem` 记录；`cloudflare-env.d.ts` 中 secret 只有类型声明。
- **备份命令有效**：`d1 export --skip-confirmation`、`r2 object get --remote` 在 wrangler 4.111 均存在；对象键有 `""`/绝对路径/`..` 防护。
- **地图生命周期**：`map-explorer.tsx:861` 依赖的两个 `useCallback` 均 `[]` 稳定，`:668` 有 `mapRef.current` 守卫、`:857-860` 有 `map.remove()`；监听器/`cursor`/`gsap.context` 清理完整；无需自建 ResizeObserver（MapLibre 内置）。
- **SEO 基础**：`og.png` 实测 1200×630；place/event 各自设置 canonical/OG；`robots.ts` 正确指向 sitemap；`metadataBase` 正确。
- **构建**：`lint 0 error`、`tsc` 通过、37 单测通过、`opennextjs-cloudflare build` 成功（需可写 HOME）。

---

## 9. 验证方法与限制

```bash
# 基线（注意本机 PATH 的 bun 是坏的 shim，用绝对路径）
export PATH="$HOME/.bun/bin:$PATH"
bun run lint && bunx tsc --noEmit && bun test
HOME=/tmp/atlas-audit/home bunx opennextjs-cloudflare build   # 规避 wrangler 写 ~/Library/Preferences

# P0-1 回归（headless Chrome 量 scrollHeight）
# 见报告证据：390×844 下 privacy 页 scrollH=701 vs 内容 1489
```

- 审计期间未运行 `wrangler dev` / `opennextjs-cloudflare preview`（沙箱禁止写 `~/Library/Preferences`），因此 **响应头、`/_next/image`、R2 边缘缓存的线上行为标为“待实测”**；
- 生产 3 个 secret 是否已配置、D1 实际数据分布、R2 桶内对象类型需线上确认（`wrangler secret list`、`wrangler d1 execute` 抽样）；
- D1 查询计划基于 sqlite3 复刻的等价 schema，与 D1 的 SQLite 版本可能有细节差异，结论以趋势为准；上线前建议在真实 D1 上 `EXPLAIN QUERY PLAN` 复核一次。

明细报告：[`audit/backend-security.md`](audit/backend-security.md) · [`audit/frontend-ux.md`](audit/frontend-ux.md) · [`audit/platform-ops.md`](audit/platform-ops.md)
