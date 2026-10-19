# 社区发帖功能 · 实现规格（v1）

> 本文件是本次实现的唯一契约。后端、前端、E2E 都以此为准；如需变更契约，先在团队里同步 Lead，再改本文件。
> 作用域：社区发帖 MVP —— 发帖（标题 + 正文 + 可选封面图 + 话题）、帖子列表、帖子详情、评论、管理员治理、举报接入、sitemap 收录。**不含点赞/关注/私信**。

## 1. 数据模型（migration `migrations/0011_community_posts.sql`）

沿用现有迁移风格：`PRAGMA foreign_keys = ON;` + `CREATE TABLE IF NOT EXISTS` + 索引。

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'chat',
  image_key TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- published | hidden
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_status_time ON community_posts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author_time ON community_posts(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_topic_time ON community_posts(topic, status, created_at);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published', -- published | hidden
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments(user_id, created_at);
```

## 2. 类型契约 `lib/post-types.ts`（新建，前后端共用）

```ts
export const POST_TOPICS = ["chat", "meetup", "guide", "food", "photo", "help"] as const;
export type PostTopic = (typeof POST_TOPICS)[number];

export type PostAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type CommunityPost = {
  id: string;
  title: string;
  body: string;
  topic: PostTopic;
  imageUrl: string | null; // 形如 /media/posts/...
  author: PostAuthor;
  commentCount: number;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PostSummary = Omit<CommunityPost, "body"> & { excerpt: string };

export type PostComment = {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  author: PostAuthor;
  isMine: boolean;
};

export const POST_TOPIC_LABELS: Record<PostTopic, string> = {
  chat: "闲聊",
  meetup: "约伴",
  guide: "攻略",
  food: "吃喝",
  photo: "影像",
  help: "求助",
};
```

## 3. 校验 `lib/post-validation.ts`（新建）

`validatePostInput(payload: Record<string, unknown> | null): { ok: true; data: { title: string; body: string; topic: PostTopic } } | { ok: false; error: string }`

- `title`：trim 后 4–60 字符；
- `body`：trim 后 10–3000 字符；
- `topic`：必须在 `POST_TOPICS` 中，缺失默认 `chat`；
- 错误文案统一 `请检查标题、正文和话题`。
- 图片校验复用 `lib/image-upload.ts`（≤5 MB，JPEG/PNG/WebP/AVIF，魔数校验）。

## 4. 数据访问 `lib/post-repository.ts`（新建）

只接受 `D1Database`，不直接读 `getCloudflareContext`，便于测试。函数签名（可内部调整实现，但导出名/返回结构固定）：

```ts
export async function listPosts(db, viewerId: string | null, opts: {
  topic?: PostTopic | null;
  cursor?: string | null;   // base64("<created_at>|<id>")
  limit?: number;           // 默认 20，最大 50
}): Promise<{ posts: PostSummary[]; nextCursor: string | null }>;

export async function findPostById(db, id: string, viewerId: string | null): Promise<CommunityPost | null>;

export async function listPostComments(db, postId: string, viewerId: string | null): Promise<PostComment[]>;

export async function createPost(db, input: { authorId: string; title: string; body: string; topic: PostTopic; imageKey: string | null }): Promise<string>; // 返回 id

export async function updatePost(db, id: string, authorId: string, input: { title: string; body: string; topic: PostTopic }): Promise<boolean>; // 仅作者 + published

export async function hidePost(db, id: string, actor: { userId: string; isAdmin: boolean }): Promise<boolean>; // 作者或管理员

export async function createPostComment(db, input: { postId: string; userId: string; body: string; notifyAuthorId: string | null }): Promise<string | null>; // 帖子不存在/已隐藏返回 null；同时给作者写 user_notifications（type: 'post_comment'），不给自己发

export async function hidePostComment(db, input: { postId: string; commentId: string; userId: string }): Promise<boolean>;
```

实现要求：
- 列表/详情 JOIN `users`，`status = 'published'`，且过滤 `u.status = 'active'`；按 `ORDER BY created_at DESC, id DESC` keyset 分页；`commentCount` 用相关子查询（`status='published'`）。
- `excerpt`：正文去换行后截 120 字符。
- 时间统一 ISO8601（`CURRENT_TIMESTAMP` 返回 `YYYY-MM-DD HH:MM:SS`，在 SQL 里用 `strftime('%Y-%m-%dT%H:%M:%fZ', created_at)` 输出，或返回后由映射函数转 `new Date(...)`，保证前端 `dateLabel` 能解析——建议 SQL 直接输出 ISO）。
- 帖子隐藏时评论不可再写入；`createPostComment` 先查帖子 `status='published'` 且作者 active。

## 5. API 契约

所有写接口必须：`isSameOrigin` → 登录校验（`currentUser`）→ `USER_ACTION_RATE_LIMITER`（key 用 `user.id`）→ 校验。错误响应统一 `{ error: string }`。

| Method | Path | Auth | 请求 | 成功响应 | 备注 |
|---|---|---|---|---|---|
| GET | `/api/posts?topic=&cursor=&limit=` | 公开 | — | `{ posts: PostSummary[], nextCursor: string \| null }` | `Cache-Control: no-store` |
| POST | `/api/posts` | 登录 | `multipart/form-data`（有图）或 JSON：`title/body/topic[/image]` | `{ id }` 201 | 有图时：先 `inspectUploadedImage`，R2 key `posts/<id>/<uuid>.<ext>`，`MEDIA.put` 成功后写库；写库失败回滚删对象。Content-Length 上限 `MAX_IMAGE_REQUEST_BYTES` |
| GET | `/api/posts/[id]` | 公开 | — | `{ post: CommunityPost, comments: PostComment[] }` | 隐藏/不存在 404 |
| PATCH | `/api/posts/[id]` | 作者 | JSON `title/body/topic` | `{ updated: true }` | 非作者/已隐藏 409/404 |
| DELETE | `/api/posts/[id]` | 作者 | — | `{ hidden: true }` | 软删除（status=hidden） |
| POST | `/api/posts/[id]/comments` | 登录 | JSON `{ body }` | `{ id }` 201 | body 1–500 字符；帖子隐藏/不存在 404 |
| DELETE | `/api/posts/[id]/comments?comment=<id>` | 评论作者或帖作者 | — | `{ hidden: true }` | 其它人 403 |

举报与治理扩展（同样在本任务内完成）：
- `app/api/reports/route.ts`：`targetTypes` 增加 `post`、`post_comment`，`targetQuery` 增加 `community_posts` / `post_comments`。
- `app/api/admin/community/route.ts`：`actions` 增加 `post.hide`、`post.show`、`post_comment.hide`；GET 响应增加 `posts`（最近 200 条：id/title/status/topic/created_at/author_name/comment_count/open_reports）；reports 的 `target_label` CASE 增加 post/post_comment。
- `lib/community-types.ts`：`CommunityNotification["type"]` 增加 `"post_comment"`。

## 6. 页面与组件

路由与文件（**新文件，勿改他人文件**）：
- `app/community/page.tsx`（服务端）：读取 `searchParams.topic`，用 `getCloudflareContext({ async: true })` + `listPosts` 取首屏；D1 异常时渲染空态提示（不 500）。`export const dynamic = "force-dynamic"`。metadata：title「社区 · 江城图志」、canonical `/community`、description。页面外壳复用全局 `.detail-page` 风格（可加 `.policy-page` 的宽度约束）。
- `app/post/[id]/page.tsx`（服务端）：`findPostById` + `listPostComments`；不存在 `notFound()`；已隐藏 404；metadata 与 JSON-LD（`@type: "DiscussionForumPosting"`，author/datePublished/commentCount，`</` 转义）。
- `components/community-feed.tsx`（client）：话题筛选（链接到 `/community?topic=`）、帖子卡片列表、发帖入口；未登录点发帖时渲染现有 `CommunityAuthModal`，登录成功后 `router.refresh()`；已登录时打开 `PostComposer`；发帖成功后 `router.refresh()` 并跳转 `/post/<id>`。
- `components/post-composer.tsx`（client）：标题/话题/正文/图片选择（前端校验 5 MB/类型），`FormData` POST `/api/posts`，错误就地展示。
- `components/post-thread.tsx`（client）：帖子详情侧的评论区：列表、发表评论（未登录触发 `CommunityAuthModal`）、删除自己/自己帖子下的评论（DELETE），操作后 `router.refresh()`。
- `components/community.module.css`：新样式（CSS Modules）。
- `app/community/page.tsx` 顶部/侧边提供「返回地图」链接。

导航入口（Lead 在集成阶段负责，社区同学**不要**改 `components/map-explorer.tsx`）：地图页 header 增加「社区」链接到 `/community`。

## 7. SEO / 通知 / 其他

- `app/sitemap.ts`：加入 `/community` 和全部 published 帖子的 `/post/<id>`（上限 200 条，`lastModified` 用 `updated_at`）。
- `/post/[id]` 页面已隐藏状态 → `notFound()`（404）。
- 通知：评论帖子给作者写 `user_notifications`（`type='post_comment'`，title「你的帖子有新回复」，body 带帖子标题与评论摘要 80 字）；不给自己发。通知面板已按 `type` 映射图标/文案的，补一个分支即可（如无映射则用默认）。
- 管理端治理 UI：`components/community-governance.tsx` 增加「帖子」tab（列表 + 隐藏/恢复按钮），复用现有 `PATCH /api/admin/community`。
- 测试：`tests/post-validation.test.ts`（必做，覆盖标题/正文/话题边界）；仓库映射类纯函数如导出可加测（可选）。

## 8. 验收标准

1. `bun run lint` 0 error（warning 不新增）；`bunx tsc --noEmit` 通过；`bun test` 全过。
2. 本地 `bun run dev`（HOME 可写）下用 curl 验证：注册两个用户 → A 发帖（含图/不含图）→ 列表可见 → 详情含评论 → B 评论 → A 收到通知 → B 删自己评论成功、删他人评论 403 → 举报帖子 → 管理员治理可见并隐藏 → 隐藏后列表/详情 404 → sitemap 含帖子。
3. 未登录发帖 401；无 Origin 的写请求 403；超长标题/正文 400；重复刷帖触发 429。
4. 不修改不属于本任务的文件；不新增未使用的依赖；不提交 git。
