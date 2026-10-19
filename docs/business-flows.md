# 江城图志 · 业务流程说明（对照当前工作树）

> 事实来源：`app/`、`lib/`、`migrations/`、`scripts/`、`wrangler.jsonc`、`next.config.ts`、`open-next.config.ts`；配套阅读 `OPERATIONS.md`、`docs/community-posts.md`、`VERIFICATION-REPORT.md`、`OPTIMIZATION-AUDIT.md`。
> 快照时间：2026-10-19（已随 `a7bd9085` 上线生产）。**R2 图片 CDN 已启用**（`lib/media.ts` + `wrangler.jsonc` vars）；**通知 postId / 去重冷却、详情卡锚点微调已完成**并有 e2e 断言覆盖。
> 图例：✅ 已有自动化覆盖 ｜ 🧪 需人工确认。

```
浏览器 ──HTTPS──▶ Cloudflare 边缘 ──▶ Workers（OpenNext，wrangler.jsonc）
                                          ├─▶ D1  jiangcheng-atlas-db（业务表 + revalidations tag cache）
                                          ├─▶ R2  jiangcheng-atlas-media（places/ activities/ posts/）
                                          ├─▶ R2  jiangcheng-atlas-next-cache（ISR/数据缓存条目）
                                          └─▶ DO 队列 DOQueueHandler（时间驱动 revalidate）
```

## 1. 角色与权限

| 角色 | 能做什么 | 边界与失败码 | 鉴权代码 |
| --- | --- | --- | --- |
| 游客 | 浏览 `/`、`/place/[slug]`、`/event/[id]`、`/community`、`/post/[id]`、政策页；读公开接口 `/api/places`、`/api/activities`、`/api/posts`、`/api/posts/[id]`、活动留言 GET、`/api/activities/[id]/calendar`、`/api/health` | 所有写接口 401；无 Origin 的写请求 403 | `currentUser()` 返回 `user: null`（`lib/user-auth.ts:110`） |
| 登录用户（`users.status='active'`） | 发帖/编辑/删除自己的帖子、评论、举报、看通知、改昵称、注销；创建活动、报名/退出、留言 | cookie `jc_user_session`（HttpOnly、SameSite=Strict、30 天）；库内只存 `sha256(token)`；封禁后会话失效 | `lib/user-auth.ts`（`newSession`/`currentUser`）、`app/api/auth/*` |
| 活动发起人（`activities.creator_id`） | 编辑（未开始且容量不低于已报名）、标记完成（已开始）、取消；收到报名/留言通知 | 不能退出自己的活动（409，提示改为取消）；编辑/完成/取消均 409 | `app/api/activities/[id]/route.ts`、`.../join/route.ts` |
| 管理员 | `/admin` 地点增改归档、上传媒体、社区治理（活动/帖子/评论隐藏与恢复、用户封禁/激活、举报处理）、审计日志 | `jc_admin_session`（HMAC-SHA256，8 小时）；`ADMIN_PASSWORD`/`ADMIN_SESSION_SECRET` 缺失即 fail-closed（503/401），密码短于 16 位记告警 | `lib/admin-auth.ts`、`app/api/admin/*` |
| 被停用用户 | — | `status='suspended'`：会话被删除，其活动/帖子/评论因 `JOIN users ON status='active'` 不再展示 | `app/api/admin/community/route.ts`、`lib/community-repository.ts:73` |

## 2. 数据模型（D1）

| 表 | 迁移 | 作用与关键列 |
| --- | --- | --- |
| `users` / `user_sessions` / `oauth_identities` | 0003、0009 | 账号（`password_hash/salt/iterations`、`status`）、会话（`token_hash` 主键、`expires_at`）、微信身份（`PRIMARY KEY(provider, provider_user_id)`、可选唯一 `union_id`） |
| `places` / `place_images` / `categories` | 0001、0010 | 地点（`slug` 唯一、`status` draft/published/archived）、图片对象键（`object_key`）、6 个分类 |
| `activities` / `activity_members` | 0003→0007 | 活动（`status` open/cancelled/completed、`moderation_status`、`capacity` 2–50、`starts_at/ends_at`、`image_key`）、报名（复合主键） |
| `activity_comments` | 0008 | 活动留言（`status` published/hidden，软删除） |
| `community_posts` / `post_comments` | 0011 | 帖子（`topic`、`image_key`、`status`）、帖内评论（同上） |
| `community_reports` | 0008、0011 扩容 | 多态举报：`target_type ∈ activity/comment/user/post/post_comment` + `target_id`，`UNIQUE(reporter_id,target_type,target_id)`，`status` open/resolved/dismissed |
| `user_notifications` | 0008、0011 扩容 | 站内通知：`type ∈ activity_joined/activity_updated/activity_cancelled/new_comment/moderation/post_comment`，目前只有 `activity_id`（无帖子列，见 §6） |
| `admin_audit_logs` | 0002 | 后台审计：`action` + `place_id` + `detail` |
| `revalidations` | 0012 | OpenNext D1 tag cache（`revalidatePath`/`revalidateTag` 的失效记录） |
| `cycling_routes` | 0003 | 骑行线路（当前仅数据表，无独立页面流程） |

```
users ──1:N── user_sessions
  │  └─1:N── oauth_identities (wechat)
  ├─1:N── activities ──N:M── activity_members ──N:1── users
  │            ├─1:N── activity_comments
  │            └─1:N── user_notifications（activity_id）
  ├─1:N── community_posts ──1:N── post_comments
  └─1:N── community_reports（多态指向 activity/comment/user/post/post_comment）
places ──1:N── place_images ──▶ R2 对象键
```

**R2 对象键约定**（读取白名单见 `app/media/[...key]/route.ts:12`）：`places/<placeId>/<uuid>.<ext>`（后台地点图）、`activities/<activityId>/<uuid>.<ext>`（活动封面）、`posts/<postId>/<uuid>.<ext>`（帖子封面）。写入时统一带 `Content-Type`、`Cache-Control: public, max-age=31536000, immutable`、`Content-Disposition: inline`。

## 3. 页面地图

| 路由 | 渲染方式 | 数据来源 | 缓存/失效 |
| --- | --- | --- | --- |
| `/` | 构建期静态壳 + 客户端拉数 | `MapExplorer(seedPlaces)`，浏览器再取 `/api/places`、`/api/activities` | 无 ISR；`/api/places` 返回 `max-age=60, s-maxage=300` |
| `/place/[slug]` | ISR `revalidate = 300`，`generateStaticParams` 返回 `[]`（按需生成） | `listPublishedPlaces(D1)`；D1 不可用回退 `seedPlaces` | 进 R2 增量缓存；改地点最多 300s 生效 |
| `/event/[id]` | ISR `revalidate = 120` | `findActivityById`（`moderation_status='visible'`） | 报名/评论/编辑无 `revalidatePath`，靠 120s |
| `/community` | `dynamic = "force-dynamic"` | `listPosts(topic, 20)`；D1 异常渲染空态不 500 | `no-store` |
| `/post/[id]` | ISR `revalidate = 60` | `findPostById` + `listPostComments`；隐藏/不存在 `notFound()` | 编辑/删除/管理员隐藏触发 `revalidatePath` 即时失效 |
| `/privacy`、`/community-guidelines` | 静态 | 纯文案（补了帖子/评论/封面图说明） | — |
| `/east-lake` | 重定向 | `redirect("/?category=event")` | — |
| `/admin` | `force-dynamic` | `verifyAdminSession` + `listAdminPlaces` | 未登录只渲染登录框 |
| `/sitemap.xml` | `force-dynamic` | 4 条固定 + 地点 + 活动 + 帖子（游标分页，上限 200，`lastModified=updated_at`） | 帖子查询失败只丢帖子条目 |
| `/robots.txt` | 静态 | `disallow: /admin`、`/api/`，`sitemap` 指向站点 | — |
| `/media/[...key]` | `force-dynamic` | R2 `MEDIA` 桶 | ETag/304 + Cache API best-effort |

## 4. 核心流程

### 4.1 游客浏览与地图交互

入口 `/`（SSR 壳）→ `MapExplorer` 客户端加载 `/api/places`、`/api/activities` → 分类切换（差事 + 6 个地点类目；`?category=` 深链打开分类面板）→ 点 marker 或列表项 → `focusPlace`/`focusActivity`（`flyTo` + `pushState` 写入 `?place=<slug>` / `?event=<id>`）→ 详情卡展示。

```
打开 /?place=east-lake
  └─ map.on("load") 读 searchParams → focusPlace(place,"none")（不压历史）
       └─ flyTo(offset [0,150]) → 详情卡定位（视口夹取）
            ├─ 关闭：clearSelection 删除 ?place/?event 参数
            └─ 复制分享链接：/place/<slug>（详情页再“在地图中打开”回 /?place=）
```

失败分支：`/api/places` 失败 → 用内置 `seedPlaces`（接口 D1 故障时返回 `source:"seed"`）；活动列表失败 → 保留上次数据；WebGL 初始化抛错 → 精简模式（保留页头与列表，不再整页错误）；`/place/[slug]` 未收录 → 404 且 `robots: noindex`。✅ e2e-browser 第 1、2 组；✅ e2e-local 第 1、6 组。

### 4.2 注册 / 登录 / 微信 / 退出 / 注销

- 注册 `POST /api/auth/register`：同源校验 → IP 限流（`USER_AUTH_RATE_LIMITER` 10/60s）→ 校验（账号 3–24 `[a-z0-9_]`、昵称 2–24、密码 10–72）→ PBKDF2-SHA256（210k 次、16 字节盐）→ `users` + `user_sessions` → 201 + cookie。失败：限流 429、重名 409、校验 400。
- 登录 `POST /api/auth/login`：同源 → IP 限流 → 账号维度限流 `user-login:<username>` → 查 `status='active'` → `verifyPassword`（有 salt 走 PBKDF2；0009 前的老记录走 HMAC 指纹，成功后就地升级为 PBKDF2）→ 新会话。失败统一 401「账号或密码不正确」，并写结构化日志（不含口令、不区分账号是否存在）。
- 微信登录：`GET /api/auth/wechat/status` 返回 `configured`；未配置时按钮禁用显示「微信登录等待开放平台配置」，`/api/auth/wechat/start` 也会重定向 `/?wechat=unavailable`。配置后：start 生成 state 存入 `jc_wechat_oauth_state`（httpOnly、SameSite=Lax、path=`/api/auth/wechat`、10 分钟）→ 跳 `open.weixin.qq.com` → callback（先按 IP 限流）校验 code/state → 换 token/资料 → 按 openid 或 unionid 查 `oauth_identities` → 命中且 `suspended` 拒绝；新用户建 `users`（`password_hash='oauth:wechat'`）+ `oauth_identities` → 建会话 → 回 `/?wechat=success`（地图页 toast 映射 5 种状态）。🧪 需开放平台审核与正式回调域名，无法自动化。
- 退出 `DELETE /api/auth/session`：同源 → 删除当前 `token_hash` 行 + 清 cookie（幂等，不接限流）。
- 注销 `DELETE /api/profile`：同源 → 登录 → 限流 → 必须提交 `confirmation: "注销"` → 批量：匿名化 `username/display_name/password_hash`、清 salt/iterations/avatar_url、`status='suspended'`、删 `oauth_identities` 与 `user_sessions`、清 cookie；历史活动与留言为保证记录完整性匿名保留。

✅ e2e-local 第 2、8 组（注册/会话/无 Origin 403/退出）；✅ `tests/user-auth.test.ts`、`tests/rate-limit.test.ts`。

### 4.3 活动全生命周期

```
创建 POST /api/activities（multipart 或 JSON）
 同源 → 登录 → 用户限流 → 校验(capacity 2–50 / 时间)
   ├─ 有封面：Content-Length ≤ 5MB+128KB → 魔数校验 → R2 put activities/<id>/<uuid>.<ext>
   ├─ DB.batch[INSERT activities, INSERT activity_members(发起人)]
   └─ 写库失败 → 删除刚上传的 R2 对象（回滚）并 500
报名 POST /api/activities/:id/join（单条 SQL 原子判定）
 INSERT OR IGNORE ... SELECT ... WHERE status='open' AND starts_at>now
   AND (SELECT COUNT(*) FROM activity_members) < capacity
   → 0 行变化 = 已开始/满员/已加入 → 409；成功后给发起人写 activity_joined
编辑 PUT（creator+open+visible+未开始+新容量≥已报名）→ 给其他成员写 activity_updated
完成 PATCH（creator+open+已开始）→ 仅改状态，不发通知
取消 DELETE（creator+open）→ status=cancelled + 给其他成员写 activity_cancelled
留言 POST .../comments：仅发起人或已报名；活动 visible+open 且
   datetime(COALESCE(ends_at, starts+2h), '+7 days') > now（7 天窗口）→ 给发起人 new_comment
日历 GET /api/activities/:id/calendar：公开；RFC 5545（75 字节折行、文本转义、GEO、取消时 STATUS:CANCELLED）
   → text/calendar; charset=utf-8 + attachment 文件名
分享页 /event/:id：ISR 120s；JSON-LD Event；已取消/已结束显示「仅作记录」；仅 open 允许索引
```

失败分支：未登录 401、非成员留言 403、重复报名/满员 409、编辑他人或已开始 409、内容违规由管理员下架（`moderation_status='hidden'` 后列表/详情/留言接口全部不可见）。✅ e2e-local 第 3 组（创建/满员容量/评论/未登录 401/日历 content-type/分享页）；✅ `tests/activity-validation.test.ts`、`tests/activity-format.test.ts`、`tests/calendar.test.ts`；✅ e2e-browser 深链与创建面板。

### 4.4 社区发帖

- 发帖 `POST /api/posts`：同源 → 登录 → 用户限流 → `title` 4–60、`body` 10–3000、`topic ∈ chat/meetup/guide/food/photo/help`；带图走 multipart（`Content-Length ≤ 5MB+128KB`，魔数校验 JPEG/PNG/WebP/AVIF）→ key `posts/<id>/<uuid>.<ext>` 先写 R2、再写库（路由与仓储共用同一个 `id`），**写库失败删除对象回滚**。
- 列表 `GET /api/posts?topic=&cursor=&limit=`：公开；keyset 分页游标 `base64("<created_at>|<id>")`，`limit` 默认 20、上限 50；只返回 `posts.status='published'` 且作者 `active`；摘要 120 字、评论数用子查询；`Cache-Control: no-store`。
- 详情 `GET /api/posts/[id]` → `{ post, comments }`；隐藏/不存在 404。
- 评论 `POST /api/posts/[id]/comments`：1–500 字；帖子隐藏/不存在 404；给作者写 `post_comment` 通知（不给自己）。
- 编辑 `PATCH`：仅作者且 `published`，成功后 `revalidatePath('/post/<id>')`。
- 删除 `DELETE /api/posts/[id]`：软删除 `status='hidden'` + `revalidatePath`；非作者已发布帖子 403、隐藏/不存在 404。评论删除允许「评论作者或帖主」，其他人 403。
- 页面：`/community` 话题筛选是链接 `?topic=`，加载更多用游标；发帖成功后 `router.refresh()` 并跳 `/post/<id>`；未登录点发帖/评论弹 `CommunityAuthModal`，登录成功后继续。

✅ e2e-local 第 7 组（发帖/列表/超短 400/未登录 401/详情页/评论/越权删除 403/举报/管理员隐藏后接口与页面 404/sitemap/带图）；✅ e2e-browser 第 4 组；✅ `tests/post-validation.test.ts`。

### 4.5 举报与治理

```
用户（登录）POST /api/reports {targetType,targetId,reason,details}
  同源 → 登录 → 限流 → 目标存在性查询（不存在 404）
   → INSERT community_reports；UNIQUE 冲突 → 409「你已经举报过这条内容」
管理员 /admin「社区治理」四大 tab：待处理举报 / 活动 / 帖子 / 用户
  GET  /api/admin/community → users、activities、posts、reports 各最近 200 条（open 优先）
  PATCH /api/admin/community {action,targetId}
    user.suspend / user.activate          → 停用会删除该用户全部会话
    activity.hide / activity.show         → moderation_status
    comment.hide / post.hide / post.show / post_comment.hide
    report.resolve / report.dismiss       → status + handled_at
  任何 action：changes=0 → 409；成功写 admin_audit_logs(action,target_id)
  post.hide / post.show 额外 revalidatePath('/post/<id>')（详情页立即 404）
```

封禁的连带效果：作者 `status='suspended'` 后其帖子/活动因 `JOIN users ... status='active'` 从列表与详情消失。🧪 举报 UI 只覆盖活动/留言（帖子与帖子评论的举报入口尚未做，见 §6）；✅ e2e-local 第 5、7 组（举报→治理列表→处理→隐藏→404）；✅ `app/api/admin/*` 的审计写入。

### 4.6 媒体链路（上传 → R2 → `/media` 与 CDN）

```
上传（后台地点图 / 活动封面 / 帖子封面）
  inspectUploadedImage：≤5MB、MIME ∈ JPEG/PNG/WebP/AVIF、读取前 16 字节魔数
  R2 MEDIA.put(key, body, {contentType, cacheControl=public,max-age=31536000,immutable})
  写库失败 → MEDIA.delete(key) 回滚（地点图/活动/帖子三处一致）

读取 URL（lib/media.ts 的 mediaUrl(key)）
  NODE_ENV=production → https://media.atlas.sololeveling.top/<key>   ← CDN 直出（已接入）
  其它（dev / 未配置） → /media/<key>                                ← Worker 回退路由
/media/[...key]：前缀白名单 places/ activities/ posts/；拒绝 .. 段
  MIME 白名单收敛（非白名单 → octet-stream + attachment，防同源存储型 XSS）
  ETag + If-None-Match → 304；Cache API best-effort（本地不支持则静默回源）
```

CDN 侧要点：`lib/site.ts` 的 `MEDIA_PUBLIC_BASE` 置空即可整体回退；`next.config.ts` 的 CSP `img-src` 已包含 `https://media.atlas.sololeveling.top`；`scripts/smoke.sh` 支持 `MEDIA_CDN_BASE` 校验 CDN 直出与 `immutable`。🧪 生产需实测 `cf-cache-status: HIT`（第二次请求）与证书/缓存规则。✅ `tests/media-route.test.ts`、`tests/http.test.ts`；✅ e2e-local 第 4 组（200/ETag/304/路径穿越 404）。

### 4.7 缓存与失效

```
页面 export const revalidate
  /place 300s   /event 120s   /post 60s   （三者 generateStaticParams=[] → 动态段按需生成）
        │
        ├─ 首次请求：渲染结果写入 R2 jiangcheng-atlas-next-cache
        ├─ 到期：DO 队列 DOQueueHandler 后台再生成（生产必需；本地 wrangler dev 不执行）
        └─ 按需：revalidatePath 写 D1 revalidations 表（NEXT_TAG_CACHE_D1）
触发点（当前仅 3 处）：PATCH /api/posts/:id、DELETE /api/posts/:id、admin post.hide|post.show
未接触发点：活动报名/评论/编辑（等 120s）、管理员改地点（等 300s）
```

`open-next.config.ts` 使用官方「Small site using revalidation」组合（R2 增量缓存 + DO 队列 + D1 tag cache）；`wrangler.jsonc` 对应 4 个绑定；`revalidations` 表由 `migrations/0012` 建立。本地限制：DO 队列在 `wrangler dev` 下会打印 "will not work in local development"；`caches.default` 分支在本地 preview 未生效，两者都要在生产复核。🧪 生产 `x-nextjs-cache: HIT` 与时间驱动再生成需实测（VERIFICATION-REPORT 记录 `/place/east-lake` 二次请求已 HIT）。

### 4.8 安全与限流

| 机制 | 位置 | 说明 |
| --- | --- | --- |
| 同源校验 | `isSameOrigin`（`lib/admin-auth.ts:88`） | `/api/` 下所有写接口第一步：要求 `Origin` 存在且 host/proto 与 `x-forwarded-*`/`host` 一致，否则 403 |
| 登录校验 | `currentUser` / `requireAdmin` | cookie → `sha256` → `user_sessions` join `users.status='active'`；管理员 HMAC 校验 + 8 小时过期 |
| 限流 | `wrangler.jsonc` | `ADMIN_LOGIN` 5/60s（按 IP）、`ADMIN_MUTATION` 60/60s（单键）、`USER_AUTH` 10/60s（注册/登录按 IP；登录叠加 `user-login:<账号>`；微信 start/callback 按 IP）、`USER_ACTION` 30/60s（按用户） |
| 请求体上限 | `readJsonBody` 调用点 | 活动留言 2KB、帖子评论/举报 4KB、活动 8KB、帖子 32KB、资料 2KB、治理 2KB；图片请求 ≤ 5MB+128KB |
| 媒体类型白名单 | `lib/http.ts` | 读取侧二次收敛，只允许 4 种图片 inline，其余强制下载 |
| 响应头 | `next.config.ts` | `nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`、HSTS；CSP 目前 **Report-Only**（含 CDN 域名），观察无违规后可上 nonce 转强制 |
| 静态资源缓存 | `public/_headers` | `/_next/static/*` → `max-age=31536000, immutable`（`next.config.ts` 的 headers 不覆盖静态资源） |

✅ `tests/http.test.ts`、`tests/media-route.test.ts`、`tests/rate-limit.test.ts`、`tests/user-auth.test.ts`；✅ e2e-local 的「无 Origin 写请求 403」「媒体路径穿越 404」；✅ smoke 校验 `nosniff`/`Referrer-Policy`/CSP Report-Only 存在。

### 4.9 发布与回滚

```
bash scripts/cloudflare-setup.sh               # 只读预检（默认）
  1/6 whoami → 2/6 d1 migrations list → 3/6 R2 缓存桶是否存在
  4/6 secrets 名称校验（必需 ADMIN_PASSWORD/ADMIN_SESSION_SECRET/USER_AUTH_SECRET；可选微信两个）
  5/6 计划输出 → 只读结束
--backup --apply：先 backup:remote 备份 → 建桶 → bun run db:migrate:remote
--deploy：再执行 bun run deploy（opennextjs-cloudflare build && deploy）
部署后：BASE_URL=https://atlas.sololeveling.top bash scripts/smoke.sh（4 组）
回滚：bunx wrangler versions list → bunx wrangler rollback <version-id> → deployments status
      ⚠ 只回滚 Worker 代码与静态资源；D1 迁移不回滚（旧代码忽略新表/列）
```

发布前 gate（`OPERATIONS.md`）：`bun install --frozen-lockfile` → `bun run lint` → `bunx next typegen` → `bunx tsc --noEmit` → `bun test` → `wrangler types` 后 `git diff --exit-code cloudflare-env.d.ts` → `git status --porcelain` 必须为空 → `wrangler secret list` → 迁移 → 部署。🧪 建桶、Secret 轮换、备份/恢复演练、回滚演练都需人工在 Cloudflare 侧确认（轮换 `USER_AUTH_SECRET` 会让旧密码失效）；✅ 备份脚本产物含 `d1.sql`、`r2/<object_key>`（含 `posts/` 封面）、`manifest.sha256`。

## 5. 验证矩阵

| 自动化 | 规模 | 覆盖的流程 |
| --- | --- | --- |
| `bun test` | 9 文件 / **68 用例**（本次实跑 68 pass / 0 fail） | 活动校验与文案、日期时区、ICS 生成与折行、媒体响应头与条件请求、媒体路由、限流键、密码派生与校验、帖子校验 |
| `node scripts/e2e-local.mjs` | 8 组（基线 59 断言，工作树新增通知断言） | ①基础可用性 ②注册与会话/CSRF ③活动生命周期与容量 ④图片上传与媒体 304 ⑤举报与治理 ⑥分享页与 SEO ⑦社区发帖与治理 ⑧资料/通知/退出 |
| `node scripts/e2e-browser.mjs` | 4 组（真实 Chrome + SwiftShader） | ①地图首页与创建面板 ②`?place=` 深链与详情卡视口内 ③地点/隐私/公约页滚动 ④社区列表→帖子详情 |
| `bash scripts/smoke.sh` | 4 组（生产/预览只读） | 健康与 API、页面（`/`、`/place/east-lake`、`/community`）、SEO（sitemap/robots）、安全响应头 + 图片（`MEDIA_KEY`/`MEDIA_CDN_BASE`） |
| CI `ci.yml` | 每次推送 | lint、typegen、OpenNext 构建、绑定类型漂移、tsc、bun test、本地 D1 迁移 + preview + smoke |
| `monitor.yml` | 每 15 分钟 | `/api/health`（+ `/`、`/sitemap.xml`、`/robots.txt`），失败写 run summary |

需人工确认（无法用仓库内脚本证明）：微信开放平台审核、回调域名与两个 Secret 配置；Cloudflare 控制台操作（R2 自定义域与缓存规则、HSTS 与边缘二选一、Notifications 告警）；R2 CDN 缓存命中与 DO 队列时间驱动再生成的生产表现；`wrangler rollback` 与 D1 备份恢复演练；举报内容的实质判定与封禁决策；生产真实用户的多设备会话/并发报名体验。

## 6. 已知边界与待办

1. ✅ **通知 postId + 去重冷却（已完成）**：`migrations/0013_notification_post_id.sql` 增加 `post_id` 与两个去重索引；`lib/notification-repository.ts` 的统一入口 `INSERT ... SELECT ... WHERE NOT EXISTS` 让 join（10 分钟）、活动评论/帖子评论（5 分钟）在冷却窗口内只保留一条；消息中心点击带 `postId` 的通知会跳 `/post/<id>`。`scripts/e2e-local.mjs` 有对应断言（3 条评论 → 1 条通知且 postId 正确）。
2. 帖子与帖子评论的**举报入口 UI 未做**（`/api/reports` 与治理后台已支持 `post`/`post_comment`）。
3. 本地 preview **不执行 DO 队列**、Cache API 分支未生效：时间驱动 `revalidate` 与 `caches.default` 需在生产各验证一次。
4. 失效触发点不全：管理员改地点最多 300s 生效；活动报名/评论/编辑靠 120s（如需即时可在对应接口加 `revalidatePath`）。
5. `components/map-explorer.tsx` 仍 1600+ 行未拆分；Tailwind v4 仍安装但 0 工具类；详情卡锚点数学仍为「夹取 + 上下翻转」，是否需要完全不遮挡 POI 属视觉决策。
6. 监控告警责任人待填写（`OPERATIONS.md`），建议补 Cloudflare Notifications；后台治理列表各 200 条上限。
7. 活动留言删除仅限本人（管理员走治理后台 `comment.hide`）；微信登录用户 `password_hash='oauth:wechat'`，无法自行设置密码。
8. 备份为明文目录（需自行 `age` 加密后异地保存），恢复对生产库/桶必须显式 `--confirm`。
