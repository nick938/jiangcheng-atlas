# 后端 / API / 安全审计（jiangcheng-atlas）

审计范围：`app/api/**`（22 个 route）、`app/media/[...key]`、`lib/{admin-auth,user-auth,wechat-auth,http,image-upload,activity-validation,place-validation,community-repository,place-repository,calendar}.ts`、`migrations/*.sql`、`wrangler.jsonc`、`next.config.ts`。
方式：逐文件精读工作树（未提交改动为准）；行号均来自当前工作树。已读基线 `/tmp/atlas-audit/{build,baseline}.log`（lint 0 error、tsc 通过、bun test 37 pass），未重复全量构建。

**总体判断**：鉴权/授权与参数化 SQL 的骨架是扎实的——22 个写方法（POST/PUT/PATCH/DELETE）**全部**做了同源校验，另 2 个 OAuth GET 入口是仅有的例外；所有 SQL 都走 `.bind()`（未发现拼接注入），JSON-LD 已转义，容量竞态写成了单语句原子形式。主要风险集中在**密钥缺失时的 fail-open**、**R2 媒体响应的 Content-Type 透传**、**限流粒度/缺口**与**查询随数据增长的退化**。

## P0

**P0-1 未配置 `ADMIN_PASSWORD` 时，空密码即可登录管理后台（fail-open）**
- 证据：`lib/admin-auth.ts:48-51` `passwordsMatch` 两侧都做 `digest()`；`lib/admin-auth.ts:35-37` `digest` 调用 `encoder.encode(value)`。当 `env.ADMIN_PASSWORD` 未设置时为 `undefined`，而 `TextEncoder.encode(undefined)` 按默认参数变成 `encode("")` → 两侧同为 `SHA-256("")`。`app/api/admin/session/route.ts:43` 只校验 `typeof password === "string" && length <= 256`，空串（length 0）通过；`route.ts:47` 比对成功 → 下发 8 小时管理员 Cookie（`lib/admin-auth.ts:53-59`）。
- 本地已用 bun 实证：`encode(undefined).length === 0` 且 `SHA-256(encode(undefined)) === SHA-256(encode(""))`。攻击无需浏览器（curl 自设 `Origin`/`X-Forwarded-Host` 即可通过 `isSameOrigin`），门槛为零。
- 影响：**完全接管后台**（改/删地点、上传媒体、封禁用户、隐藏内容、清空会话）。
- 现实性：`wrangler.jsonc` 无 `vars` 段，三个密钥必须由 `wrangler secret put` 注入；但 `OPERATIONS.md:3-13` 的发布清单只写了 WeChat 两个 secret（`OPERATIONS.md:35-40`），**ADMIN_PASSWORD/ADMIN_SESSION_SECRET/USER_AUTH_SECRET 从未被文档化要求**。配置是否存在于生产需运行时确认（`bunx wrangler secret list`）；无论是否配置，此处都必须 fail-closed。
- 修法：`admin/session` 在比对前加 `const expected = env.ADMIN_PASSWORD; if (typeof expected !== "string" || expected.length < 16) return 503`，并在 `passwordsMatch` 内对 `undefined/""` 直接返回 `false`；同时把三个 secret 写进 `OPERATIONS.md` 发布清单，并给 `/api/health` 加 `secretsConfigured` 自检（不泄露值）。

## P1

**P1-1 媒体路由透传 R2 对象的 Content-Type / Content-Disposition（同源存储型 XSS 的兜底被绕过）**
- 证据：`app/media/[...key]/route.ts:22-24` 原样回写 `metadata.contentType`/`contentDisposition`，只做了 key 前缀白名单（`:12`，`places/`、`activities/`）。上传侧（`lib/image-upload.ts:37-41`）校验了 MIME 与魔数，所以**当前写入路径**是安全的；但读取侧对桶内任意对象无条件信任，`wrangler r2 object put` 恢复备份（`OPERATIONS.md:54`）、控制台手工上传、未来新增上传入口都会产生 `text/html` 对象并以同源 HTML 提供（`X-Content-Type-Options: nosniff` 只防止浏览器把 `image/*` 猜成其它类型，当响应头自己就是 `text/html` 时它不提供任何保护）。
- 影响：任意在该域执行的脚本可读取 `jc_user_session`（`httpOnly` 只挡 JS 读取，不挡同源脚本发起带 Cookie 的写操作）→ 账号接管。
- 修法：读取侧白名单 `image/(jpeg|png|webp|avif)`，非白名单一律 `application/octet-stream` + `Content-Disposition: attachment`；忽略存储的 `contentDisposition`，或强制 `inline` 且仅对白名单类型生效；`next.config.ts:9-21` 增加 CSP（当前只有 XFO/nosniff/Referrer/Permissions，**无 CSP**），并把媒体迁到独立域名/路径的 `Content-Security-Policy: sandbox`。

**P1-2 管理员登录限流是全局单键，5 次/分钟即可永久锁死后台（DoS）**
- 证据：`app/api/admin/session/route.ts:34` `limit({ key: "admin-login" })` + `wrangler.jsonc:35-41`（limit 5 / period 60）。键为常量，与来源无关。
- 影响：任意匿名者每分钟发 5 个 POST 就能让管理员无法登录（含登录成功前的正常操作），且真实管理员的重试同样消耗该桶。同类问题：`lib/admin-auth.ts:108` `key: "admin-mutation"` 使所有管理员共享 60 次/分钟配额（`wrangler.jsonc:43-49`）。
- 修法：登录键改为 `cf-connecting-ip` 并叠加"账号维度"桶；锁定期做指数退避而非整分钟；对第 429 次响应写审计日志（当前失败登录**完全不记录**，`app/api/admin/session/route.ts:49` 直接返回 401，缺少暴破可观测性）。

**P1-3 一批已登录写接口没有限流，且缺少按账号的内容速率约束**
- 证据（均已确认无 `*_RATE_LIMITER` 调用）：`app/api/profile/route.ts:8`(PATCH) 与 `:20`(DELETE)、`app/api/notifications/route.ts:31`(PATCH)、`app/api/activities/[id]/join/route.ts:26`(DELETE 退出)、`app/api/activities/[id]/comments/route.ts:77`(DELETE 隐藏留言)、`app/api/auth/session/route.ts:12`(DELETE)。另有 `app/api/auth/wechat/start`（`route.ts:6`）与 `callback`（`route.ts:14`）无任何限流。
- 影响：昵称/注销/通知已读/退出/删留言可无限刷（注销接口 `profile/route.ts:27-33` 是写 3 张表的破坏性操作）；留言与加入活动的 `POST` 虽有 30 次/分钟（`USER_ACTION_RATE_LIMITER`），但每次成功都会给发起人插一条 `user_notifications`（`comments/route.ts:69-71`、`join/route.ts:20-22`）→ 单个账号可对指定发起人形成 30 条/分钟的通知轰炸，无接收方维度的抑制。
- 修法：给上述 6 个端点统一加 `USER_ACTION_RATE_LIMITER`（key 用 `user.id`）；`POST /api/notifications` 对同一 `(user_id, type, activity_id)` 在 N 分钟内合并；对 `join` 的进/出循环加冷却（如 10 秒内同活动忽略）。

**P1-4 账号级登录防爆破缺失 + 遗留快速哈希**
- 证据：`app/api/auth/login/route.ts:12` 限流键是 IP（`lib/user-auth.ts:141` `cf-connecting-ip`），无账号维度计数、无失败审计、无验证码；`lib/user-auth.ts:89` 对 `password_salt IS NULL` 的账号回退到 `passwordFingerprint`（`:25-39`，单轮 HMAC-SHA256，非慢哈希）。
- 影响：分布式（换 IP/换 IPv6）撞库不受限；一旦 D1 备份泄露，所有尚未登录过的老账号口令可被高速离线破解。缓解项：登录成功时会自动升级为 PBKDF2-210k（`login/route.ts:33-38`），且明文口令不落日志（已核对，与 `/privacy` 声明一致）。
- 修法：加 `(username, ip)` 二元计数与 N 次失败后锁定；对 `password_salt IS NULL` 的账号在下次登录前限制功能或在迁移窗口内强制重置；`migrations/0009` 之后新账号已无此路径，可加一次性数据迁移彻底消除遗留哈希。

**P1-5 `GET /api/activities` 走全表扫描，且 `status='open'` 集合无上界增长**
- 证据：`lib/community-repository.ts:68-74` 的过滤与排序把列包在 `datetime()`/`COALESCE()` 里。用 bun:sqlite 复刻 `migrations/0003/0007/0008` 的索引后跑 `EXPLAIN QUERY PLAN`（2 万行）：现写法 → `["SCAN a","USE TEMP B-TREE FOR ORDER BY"]`（**全表扫描 + 临时 B 树排序，`idx_activities_status_time`/`idx_activities_moderation_time`/`idx_activities_end_time` 全部失效**）；改成纯文本比较 → `SEARCH a USING INDEX idx_activities_status_time (status=?)`。同规模本地耗时 2.19ms vs 0.88ms（D1 上差额会体现在行读计费与临时排序内存）。
- 加剧因素：活动结束后没有任何路径把 `status` 改成 `completed`（只有发起人手动 PATCH，`app/api/activities/[id]/route.ts:48`），所以历史活动永久留在 `status='open'` 里；该 GET 匿名可打（`app/api/activities/route.ts:11`，无缓存），且 `/api/east-lake`（`app/api/east-lake/route.ts:7`）与 `sitemap.ts:22` 复用同一查询。
- 修法：改 `a.ends_at > ?`（绑定 `new Date().toISOString()`；列在 0007 已回填、写入路径必填，建议顺手加 `NOT NULL`），排序改 `ORDER BY a.starts_at`；`listMyActivities` 的 `OR`（`lib/community-repository.ts:97`，实测同样 `SCAN a`）改 `UNION` 两支各走索引；再加定时任务把过期活动置 `completed`，并对匿名结果做 30–60s `caches.default` 缓存。

## P2

| # | 位置 | 问题 | 影响 | 修法 |
|---|---|---|---|---|
| P2-1 | `app/api/admin/places/[id]/route.ts:28-44`、`:63-74` | 审计日志与 UPDATE 同批执行，`results[0].meta.changes === 0` 的判断在提交之后 | 对不存在/无变化的 ID 也会写入 `admin_audit_logs`，审计可被污染、不能作为事实依据 | 先 `UPDATE` 再按 `changes>0` 追加审计；或把审计并入带 `WHERE EXISTS` 的 `INSERT ... SELECT` |
| P2-2 | `app/api/reports/route.ts:35-40` + `migrations/0008:27` | `UNIQUE (reporter_id, target_type, target_id)` 不含状态，而 `route.ts:38` 把所有唯一约束冲突都当成"已举报过" | 举报被管理员 dismiss/resolve 后，同一用户对该对象**永久无法再举报**（含对象被换内容后再次违规的场景） | 唯一约束改为部分索引 `WHERE status = 'open'`，或冲突时若旧记录已关闭则允许插入新记录 |
| P2-4 | `app/api/notifications/route.ts:17` + `migrations/0008:46` | `ORDER BY datetime(created_at) DESC` 同样被函数包裹，且索引中列序为 `(user_id, read_at, created_at)` | 每个用户的通知列表都要临时排序 | 改 `ORDER BY created_at DESC`；如需按未读分组可加 `(user_id, created_at DESC)` 索引 |
| P2-5 | `lib/community-repository.ts:65`、`app/api/activities/[id]/comments/route.ts:34` | JOIN `users` 时未过滤 `u.status='active'` | 管理员封禁（`admin/community/route.ts:53-56` 会清会话）后，其活动与留言仍公开展示 | 列表/评论查询加 `u.status='active'`（或封禁时同步隐藏其内容） |
| P2-6 | `lib/admin-auth.ts:83-95` | 同源判定用请求自带的 `x-forwarded-host`/`x-forwarded-proto`/`host` 推导，而非固定 `SITE_URL` 白名单 | 直接 HTTP 客户端可自设这些头通过校验（浏览器 CSRF 场景因预检/Origin 由浏览器控制仍被拦住，未构成可利用绕过） | 与 `lib/site.ts:2` 的 `SITE_URL` 做固定 host 比较，忽略 `x-forwarded-*` |
| P2-7 | `app/api/auth/wechat/start/route.ts:6-22` + `lib/wechat-auth.ts:36` | 启动 OAuth 的 GET 无 Origin/Referer 校验，state Cookie 为 `sameSite: "lax"` | 存在"登录 CSRF"路径（诱导受害者浏览器进入攻击者账号的会话）；实际可利用性依赖微信二维码页可否被跨站嵌入，需运行时验证 | start 增加 Origin/Referer 校验；state Cookie 改 `strict` 并绑定当前会话/双重提交 |
| P2-8 | `app/api/activities/[id]/route.ts:48-52` | 完成（PATCH）不校验 `datetime(starts_at) <= now` | 发起人可把尚未开始的活动标为"已完成"，状态机不一致 | 与 PUT/DELETE 一致地加时间前置条件 |
| P2-9 | `app/api/places/route.ts:16-21` | D1 故障回退到内置种子数据，并带 `Cache-Control: public, max-age=60`（`:20`） | 目录不可用时 60s 内对外呈现"另一套内容"，故障被掩盖 | 回退响应改 `no-store` 或 `max-age=5`，并输出 `source: "seed"` 已有（前端可据此告警） |
| P2-10 | `app/api/auth/register/route.ts:36-39`、`app/api/activities/route.ts:81-84`、`app/api/admin/places/route.ts:52-55`、`app/api/reports/route.ts:38-40` | `catch` 把任意 D1 错误一律映射为 409/500 业务文案，并把原始 error 交给 `console.error` | 误报（限流/约束/连接错误都显示"账号已被使用"）＋ 日志可能含 SQL 与绑定值（经核对**不含明文口令**） | 按 `error.message` 分类返回；日志只记 `event` + `error.message`，observability 采样率当前为 1（`wrangler.jsonc:16-19`），注意留存成本 |
| P2-11 | `app/api/activities/route.ts:33`、`app/api/admin/media/route.ts:21` | `request.formData()` 未包 try/catch | 畸形 multipart 直接 500 | 包住并返回 400；`Content-Length` 预检仅为尽力而为，真正的体积兜底已在 `lib/image-upload.ts:37` |
| P2-12 | `app/media/[...key]/route.ts:17,27` | 未处理 `If-None-Match`，已设 ETag 但不回 304；也不校验对象所属地点/活动是否已下架或隐藏 | 重复传输；隐藏活动（`moderation_status='hidden'`）的图片在被猜到 key 时仍可取（key 为 UUID，实际风险低） | 用 `env.MEDIA.get(key, { onlyIf: request.headers })`；可选：读取时校验 `place_images`/`activities` 状态 |
| P2-13 | `wrangler.jsonc:6` | `workers_dev: true` 与自定义域并存 | 同一 Worker 有第二个可访问主机名，同源判定会以该主机名为准，增加信任面 | 关闭 `workers_dev` 或在该主机名强制 301 到 `SITE_URL` |

## 写接口鉴权 / 限流矩阵（同源 = `isSameOrigin`；登录 = 会话/管理员校验；限流 = 实际调用的限流器）

| 接口 | 方法 | 同源 | 登录 | 限流 | 输入校验 |
|---|---|---|---|---|---|
| `/api/auth/register` | POST | `register/route.ts:11` ✅ | n/a | USER_AUTH/IP `:13` ✅ | `:20-22` 用户名/昵称/口令长度 ✅ |
| `/api/auth/login` | POST | `login/route.ts:10` ✅ | n/a | USER_AUTH/IP `:12` ✅（与注册同桶） | `:16-17`、≤72 ✅ |
| `/api/auth/session` | DELETE | `session/route.ts:13` ✅ | 需 `tokenHash` `:14` ✅ | ❌ 无 | — |
| `/api/auth/wechat/start` | GET | ❌ 无（P2-7） | n/a | ❌ 无 | state 24B 随机 ✅ |
| `/api/auth/wechat/callback` | GET | ❌ 无（OAuth 必需） | n/a | ❌ 无 | state 常量时间比对 `wechat/callback:19` ✅ |
| `/api/activities` | POST | `activities/route.ts:21` ✅ | 需登录 `:23` ✅ | USER_ACTION/uid `:24` ✅ | `activity-validation.ts:33-38` + 图片魔数 ✅ |
| `/api/activities/[id]` | PUT | `[id]/route.ts:10` ✅ | `:13` ✅ | USER_ACTION `:14` ✅ | 同上 + 归属/开状态/时间/容量 `:21-28` ✅ |
| `/api/activities/[id]` | PATCH(完成) | `:41` ✅ | `:44` ✅ | `:45` ✅ | 归属 `:48-52`（缺开始时间校验，P2-8） |
| `/api/activities/[id]` | DELETE(取消) | `:60` ✅ | `:63` ✅ | `:64` ✅ | 归属 `:67-71` ✅ |
| `/api/activities/[id]/join` | POST | `join/route.ts:8` ✅ | `:11` ✅ | `:12` ✅ | 容量/时间/状态原子判定 `:13-18` ✅ |
| `/api/activities/[id]/join` | DELETE | `:27` ✅ | `:30` ✅ | ❌ 无（P1-3） | 发起人不可退出 `:31-32` ✅ |
| `/api/activities/[id]/comments` | POST | `comments/route.ts:44` ✅ | `:47` ✅ | USER_ACTION `:48` ✅ | 1–300 字 `:53` + 参与者校验 `:56-62` ✅ |
| `/api/activities/[id]/comments` | DELETE | `:78` ✅ | `:81` ✅ | ❌ 无（P1-3） | 留言/活动/作者三重限定 `:84-86` ✅ |
| `/api/profile` | PATCH | `profile/route.ts:9` ✅ | `:11` ✅ | ❌ 无（P1-3） | 昵称 2–24 `:14` ✅ |
| `/api/profile` | DELETE | `:21` ✅ | `:23` ✅ | ❌ 无（P1-3） | 需输入"注销" `:25` ✅ |
| `/api/reports` | POST | `reports/route.ts:12` ✅ | `:14` ✅ | USER_ACTION `:15` ✅ | 类型/理由白名单 + 目标存在性 `:23-33` ✅ |
| `/api/notifications` | PATCH | `notifications/route.ts:32` ✅ | `:34` ✅ | ❌ 无（P1-3） | 仅更新本人 `:35` ✅ |
| `/api/admin/session` | POST | `admin/session/route.ts:24` ✅ | n/a | ADMIN_LOGIN 全局键 `:34` ⚠️(P1-2) | ≤256 `:43`（fail-open 见 P0-1） |
| `/api/admin/session` | DELETE | `:64` ✅ | ❌（仅清 Cookie，无害） | ❌ 无 | — |
| `/api/admin/community` | PATCH | `admin/community/route.ts:42` ✅ | 管理员 `:43` ✅ | ADMIN_MUTATION 全局键 `:45` ⚠️(P1-2) | 动作白名单 + id 长度 `:49` ✅ |
| `/api/admin/media` | POST | `admin/media/route.ts:9` ✅ | `:10` ✅ | ADMIN_MUTATION `:12` ✅ | 魔数 + 地点存在性 `:27-35` ✅ |
| `/api/admin/places` | POST | `admin/places/route.ts:17` ✅ | `:18` ✅ | ADMIN_MUTATION `:20` ✅ | `place-validation.ts:32-63` ✅ |
| `/api/admin/places/[id]` | PATCH | `[id]/route.ts:8` ✅ | `:9` ✅ | `:11` ✅ | 同上 + id 长度 `:16` ✅ |
| `/api/admin/places/[id]` | DELETE | `:54` ✅ | `:55` ✅ | `:57` ✅ | id 长度 `:62` ✅ |

覆盖：22 个 route 文件全部读过；矩阵 24 行 = 22 个写方法 + 2 个会建号/写 Cookie 的 OAuth GET。另有 7 个只读 GET（`/api/activities`、`/api/east-lake`、`/api/places`、`/api/health`、`/api/auth/session`、`/api/auth/wechat/status`、`/api/activities/[id]/calendar`）及 3 个后台 GET 已逐一读过；只读 GET 的缓存头为 `no-store`（用户相关）或 `public, max-age=60[, s-maxage=300]`（公共数据），语义正确。

## 已核验、无发现的点（避免误导为遗漏）

- **JSON-LD 注入**：`app/place/[slug]/page.tsx:179` 与 `app/event/[id]/page.tsx:187` 均在 `JSON.stringify` 后 `.replace(/</g, "\\u003c")`，`</script>` 逃逸被堵住 ✅。其它 `dangerouslySetInnerHTML` 仅两处：SVG 图标表 `components/map-explorer.tsx:152-153,160-161`（key 为常量枚举，值来自静态常量）✅。
- **开放重定向**：`app/api/auth/wechat/callback/route.ts:10-12` 用相对路径 + `encodeURIComponent(status)`，无可控跳转目标 ✅。
- **SQL 注入**：全量检索 `prepare()` 调用，无用户输入插值；`admin/community` 的动态 SQL 由动作白名单查表得到（`route.ts:52-83`）✅。
- **报名人数上限竞态**：`join/route.ts:13-18` 把"计数 < capacity"与插入放在**同一条 `INSERT OR IGNORE ... SELECT`** 内，避免了读-改-写窗口；PUT 改容量同理（`[id]/route.ts:26`）。已用 bun:sqlite 以**代码里的原文语句**实测（capacity=2）：第 2 人加入 → `changes=1`；第 3 人加入 → `changes=0`；重复加入 → `changes=0`；`PUT capacity=1`（低于当前 2 人）→ `changes=0`，`capacity=3` → `changes=1`；`datetime()` 正确解析应用写入的 ISO-`Z` 格式 ✅。SQL 语义与边界均已证实，剩余不确定性只有 D1 的写串行化假设（见下）。
- **会话/token**：256-bit `crypto.getRandomValues` + 仅存 SHA-256 哈希（`user-auth.ts:100-108`）、管理员会话 HMAC 且先验签后解析（`admin-auth.ts:61-81`）、Cookie `httpOnly` + `sameSite=strict` + 条件 `secure` ✅。注销时匿名化并清会话/微信绑定（`profile/route.ts:27-33`），与 `/privacy` 中"历史内容匿名保留"的声明一致 ✅。
- **CSRF**：所有写接口依赖 Origin 校验 + `SameSite=strict`，跨站 `text/plain` 简单请求仍会带 Origin，被 `:11/:21` 一类检查拒绝；自设 `X-Forwarded-Host` 的绕过只对非浏览器客户端成立（见 P2-6）✅。
- **输入上限**：`lib/http.ts:1-23` 流式读体并硬截断（2–8KB 按端点），`place-validation`/`activity-validation` 的长度、范围、枚举校验完整 ✅。

## 需运行时验证（本沙箱无法执行）

1. 生产是否已配置 3 个 secret（P0-1 是否已可利用）：`bunx wrangler secret list`。
2. D1 写串行化：对 `/api/activities/<id>/join` 做 20 并发抢 2 个名额，应恰好 2 人成功（SQL 已本地验证，此处验证的是运行时调度）。
3. `request.url` 在生产是否恒为 `https`（决定 Cookie `secure` 与 `isSameOrigin` 的协议比较），以及 `cf-connecting-ip` 是否总存在。
4. R2 桶内是否存在非 `image/*` 的既有对象（决定 P1-1 的现实可利用性）：`bunx wrangler r2 object list jiangcheng-atlas-media`。
5. Workers 日志中是否出现 D1 错误里的绑定值（决定 P2-10 的留存/合规成本）。
6. P2-7 登录 CSRF 的可利用性：微信 `qrconnect` 页面是否允许被第三方站点 iframe 嵌入。
