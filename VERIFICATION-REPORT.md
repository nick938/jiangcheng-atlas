# 修复与验证报告（2026-10-19）

本文件对应 `OPTIMIZATION-AUDIT.md` 的落地结果：3 个 P0、30 分钟速胜 8 条、本周 P1（后端加固 / 前端性能 / 平台运维）全部实施，并新增社区发帖功能；全部改动都在本地真实运行环境（Next dev 与 OpenNext + Wrangler 本地 D1/R2/DO）上用自动化脚本验证过。

## 1. 验证结果总览（可复现）

| 验证 | 命令 / 环境 | 结果 |
|---|---|---|
| 静态检查 | `bunx tsc --noEmit` / `bun run lint` | 0 error；lint 5 warning（与审计基线相同，无新增） |
| 单元测试 | `bun test` | **68 pass / 0 fail**（9 个文件，基线为 37 pass / 5 个文件） |
| 生产构建 | `HOME=/tmp/atlas-home bunx opennextjs-cloudflare build` | exit 0，OpenNext worker 生成成功 |
| Worker 冒烟 | `BASE_URL=http://localhost:8787 bash scripts/smoke.sh` | **16/16 通过** |
| API 端到端 | `BASE_URL=http://localhost:8787 node scripts/e2e-local.mjs` | **59/59 通过**（注册/登录/活动/报名/评论/举报/治理/媒体/SEO/社区发帖/通知） |
| 浏览器端到端 | `node scripts/e2e-browser.mjs --base http://localhost:8787` | **0 失败**（真实 Chrome + SwiftShader：地图 canvas、创建面板、深链详情卡、滚动、社区列表→详情） |
| 缓存 | `/place/east-lake` 等页面 + `.wrangler/state/v3/r2/jiangcheng-atlas-next-cache` | ISR 条目写入本地 R2 缓存（9 条）；`revalidatePath` 写入 D1 `revalidations`；管理员隐藏帖子后详情页**立即** 404 |
| 部署配置 | `bunx wrangler deploy --dry-run` | 11 个 binding 全部解析；产物中包含 `export { DOQueueHandler }` |

## 2. P0 修复

1. **内容页无法滚动**：`app/globals.css` 的 `html, body { height:100%; overflow:hidden }` 改为 `width:100%; min-height:100%`。真实 Chrome 实测：`/privacy` 1549 vs 757、`/place/east-lake` 1240 vs 757、`/community-guidelines` 1387 vs 757，`overflow=visible`，全部可滚动。
2. **管理员登录 fail-open**：`lib/admin-auth.ts` 的 `passwordsMatch`/`verifyAdminSession` 对空/缺失密钥直接返回 false；`/api/admin/session` 在密码比对前校验 `ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET` 已配置（缺失返回 503），密码短于 16 位记结构化警告。实测空密码 401、错误密码 401、正确密码 200。
3. **部署源 ≠ git**：本次全部工作已提交（见第 6 节）；`OPERATIONS.md` 发布清单加入 `git status --porcelain` 必须为空的 gate。

## 3. 社区发帖功能（新增）

- 迁移：`migrations/0011_community_posts.sql`（帖子/评论表 + 索引 + 举报/通知 CHECK 扩容重建，已用 sqlite3 复现旧数据迁移，数据无丢失）、`migrations/0012_opennext_revalidations.sql`（tag cache 表）。
- 接口：`GET/POST /api/posts`、`GET/PATCH/DELETE /api/posts/[id]`、`GET/POST/DELETE /api/posts/[id]/comments`；全部写接口同源 + 登录 + 限流；封面图走 R2（`posts/` 前缀），校验魔数、失败回滚。
- 页面：`/community`（话题筛选、分页加载、发帖入口）、`/post/[id]`（正文、封面、评论、删除、JSON-LD）；地图页 header 增加「社区」入口。
- 治理与举报：`/api/reports` 支持 `post`/`post_comment`；治理后台新增「帖子」tab 与隐藏/恢复；隐藏后列表/详情/评论立即不可见。
- 收录：`sitemap.xml` 增加 `/community` 与已发布帖子（≤200，使用 `updated_at`）。
- 文案：隐私说明、社区公约补充帖子/评论/封面图与举报治理说明。

## 4. 本轮发现并修复的"真实流程"问题

| 问题 | 发现方式 | 处理 |
|---|---|---|
| 全部内容页无法滚动 | headless Chrome 实测 scrollHeight | 修 CSS（P0-1） |
| 无 WebGL 设备整页变成错误页 | headless `--disable-gpu` 触发 | 地图构造 try/catch + 精简模式面板（保留页头与列表） |
| 深链详情卡跑到视口外（实测 top=-287 / left=-38） | 浏览器 E2E 量 `getBoundingClientRect` | `positionDetailNode` 增加视口夹取，稳定态 top=10 / left=107 |
| `/media` 条件请求永远 200 | API E2E | MIME 白名单 + `If-None-Match` → 304（实测 304） |
| 发帖返回 id ≠ 落库 id | community-frontend 交叉验证 | repo 接受 route 的 id（同一 id 用于 R2 key/落库/响应） |
| 隐私/公约页标题重复「· 江城图志」 | 浏览器 E2E 读 title | 页面 title 去掉站点名，由 layout template 追加 |
| 共享 dev server 全站 500 | 后端同学复现 | 定位为 `proxy.ts` 残留 manifest；已重启并确定 CSP 改由 `next.config.ts` 下发 |
| 详情卡拖动时每帧 React setState | 审计 | 改 ref 直写 `translate3d`（CDP 实测 React 不再写 left） |

## 5. 性能对比（构建产物实测）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 首页 first-load JS | 1.68 MB raw / 492 KB gzip | **1.62 MB raw / 472 KB gzip** |
| 首页 CSS | 3 个文件 214 KB raw / 52 KB gzip | **2 个文件 126 KB raw / 22 KB gzip** |
| 字体产物 | 106 个 woff2 / **4.6 MB**，首页按需拉取 ~1 MB 级 | **5 个文件 72 KB**，只有 1 个 latin preload |
| 地点详情卡图片 | 原图 232–617 KB | 320 档 **12–34 KB（-94%~-96%）**，hero 用 srcset |
| 活动列表查询 | `SCAN a` + 临时排序（20k 行 EXPLAIN） | `SEARCH a USING INDEX ...`；`listMyActivities` 改为 UNION 走索引 |
| 媒体请求 | 每次 Worker + R2 全量回源 | 条件请求 304 + Cache API best-effort + `posts/` 支持 |

## 6. 变更范围与提交

- 修改/新增文件约 90 个；新增测试 4 个文件（媒体路由、限流、http 工具、帖子校验），测试数 37 → 68。
- 新增验证脚本：`scripts/e2e-local.mjs`（API 流程）、`scripts/e2e-browser.mjs`（真实浏览器 + CDP）、`scripts/smoke.sh`（发布冒烟）。
- 新增文档：`docs/community-posts.md`（功能契约）、本文件、`audit/*.md`、`OPTIMIZATION-AUDIT.md`。
- 全部改动（含本次之前工作区里未提交的分享页/SEO 改动）已作为一次本地提交保存，`git status` 现在为空。

## 7. 部署前需要做的事（仓库外）

1. `bunx wrangler r2 bucket create jiangcheng-atlas-next-cache`（ISR 增量缓存桶）。
2. `bun run db:migrate:remote`：包含 `0011`（社区帖子）与 `0012`（`revalidations` 表）。
3. `bunx wrangler secret list` 确认 5 个名字（3 个管理员/用户 + 2 个微信）。
4. 可选：R2 `MEDIA` 桶绑定 `media.atlas.sololeveling.top` 做 CDN 直出；HSTS 不要与 Cloudflare 边缘重复开启。
5. 监控告警：`.github/workflows/monitor.yml` 已按 15 分钟探活，建议再在 Cloudflare Notifications 配一条责任人告警。

## 8. 已知遗留（不影响本次验收）

- **本地 preview 无法执行 DO 队列**：wrangler 对内部 Durable Object 的本地限制，会打印 "will not work in local development, but they should work in production"；产物已确认导出 `DOQueueHandler`，时间驱动 revalidate 需在生产验证一次。
- Cache API 分支（`caches.default`）在本地 preview 未生效，生产需实测命中。
- 通知合并/冷却未做：join/comments 仍可 30 条/分钟刷发起人通知，建议按 `(user_id,type,activity_id)` 合并。
- `post_comment` 通知无法跳转到帖子（`user_notifications` 无 post 列）；帖子/评论的举报入口 UI 未加（治理后台已可处理）。
- 详情卡 anchor 数学仍按原逻辑（夹取只保证完整可见）；若要"卡片在锚点上方且不遮挡 POI"，需要调整 `flyTo` offset 或做视觉决策。
- Tailwind v4 仍未移除（0 工具类）；`map-explorer.tsx` 仍未拆分（1600+ 行）；监控告警未落到具体责任人。
- `revalidate` 采用时间驱动（place 300s / event 120s / post 60s）+ 帖子隐藏/编辑即时 `revalidatePath`；管理员改地点仍最多 5 分钟生效（如需即时可在后台接口加 `revalidatePath`）。

## 9. 生产部署记录（2026-10-19）

- Cloudflare 侧：备份 `backups/20261019T082252Z`；新建 R2 桶 `jiangcheng-atlas-next-cache`；远程迁移 `0011`、`0012` 全部应用；迁移前后行数一致（users=1、activities=1、reports=0、notifications=0）。
- 部署：`bun run deploy` 两次修正后上线，当前版本 `fee133c1-718e-4077-9a39-938f2c4b34ad`（自定义域 `atlas.sololeveling.top`）。
  - `b4487fa0`：首次部署（审计修复 + 社区功能）
  - `4dd27042`：补 `generateStaticParams`，让 `/place`、`/event`、`/post` 真正进入 R2 增量缓存
  - `fee133c1`：`public/_headers` 给 `/_next/static/*` 加 immutable 强缓存
- 上线验证：`scripts/smoke.sh` 打生产 **16/16 通过**；`/place/east-lake` 二次请求 `x-nextjs-cache: HIT`；`/media` 条件请求 304；CSP Report-Only / HSTS / nosniff 生效；静态 chunk `cache-control: public, max-age=31536000, immutable`。
- 回滚：`bunx wrangler versions list` → `bunx wrangler rollback <version-id>`（D1 迁移不回滚，旧版本代码可忽略新表）。


## 10. 第三轮：R2 CDN + 通知小遗留 + 业务流程（2026-10-19 晚）

- **R2 图片 CDN 直出**：Cloudflare 自定义域 `media.atlas.sololeveling.top` 绑定 `jiangcheng-atlas-media`；`lib/media.ts` 统一生成 URL，`wrangler.jsonc` 的 `vars.MEDIA_PUBLIC_BASE` 提供生产基地址，本地在 `.dev.vars` 覆盖为空串走 `/media` 回退。生产验证：CDN 200 / `image/jpeg` / `immutable`、第二次 `cf-cache-status: HIT`；活动页 HTML 已输出 CDN 绝对地址；CSP `img-src` 已放行该域。
- **通知小遗留**：migration `0013` 增加 `post_id` + 去重索引；`insertNotificationIfNotRecent` 统一入口（join 10 分钟、活动/帖子评论 5 分钟冷却）；消息中心可跳转 `/post/<id>`；详情卡改为「优先上方、空间不足翻到下方」并保持视口夹取。本地 API E2E 61/61（含"3 条评论只留 1 条通知且 postId 正确"）。
- **修复两个集成级问题**：
  1. `/post/[id]` 在加入 ISR（`generateStaticParams`）后，因页面内 `headers()`（会话判定）与静态生成冲突，生产构建下 500 → 改回 `force-dynamic`；
  2. `app/page.tsx` 引入 maplibre-gl.css 后 `.maplibregl-map{position:relative}` 压过 `.atlas-map`，地图容器高度塌陷为 0（canvas 退成 500×300）→ 选择器改为 `.atlas-shell .atlas-map`，并在浏览器 E2E 增加"容器铺满视口 + 样式 attribution 出现"断言。
- **业务流程文档**：新增 `docs/business-flows.md`（235 行，含角色权限、15 张表、11 条路由渲染方式、9 条核心流程、验证矩阵）。
- **上线版本**：`a7bd9085-2b4c-4ad8-bf52-de85243517c5`；生产冒烟 21/21（含 CDN 校验）、ISR 第二次 `x-nextjs-cache: HIT`、`/api/notifications` 未登录 401、migration 0013 已应用。
