import type { CommunityPost, PostComment, PostSummary, PostTopic } from "@/lib/post-types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_COMMENTS = 200;
const EXCERPT_LENGTH = 120;

type PostRow = {
  id: string;
  title: string;
  body?: string;
  topic: string;
  image_key: string | null;
  created_at: string | null;
  created_at_raw: string;
  updated_at: string | null;
  author_id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  comment_count: number;
};

type CommentRow = {
  id: string;
  post_id: string;
  body: string;
  created_at: string | null;
  created_at_raw: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_color: string;
};

/** CURRENT_TIMESTAMP 是 `YYYY-MM-DD HH:MM:SS`，统一成前端 `new Date()` 可解析的 ISO8601。 */
function toIso(value: string | null, raw: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}.000Z` : raw;
}

function excerptOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH);
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(value: string | null | undefined): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return null;
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!createdAt || !id || createdAt.length > 40 || id.length > 100) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// 用 created_at 原始值做 keyset 比较（索引可用），输出时再转 ISO。
const postColumns = `p.id, p.title, p.topic, p.image_key,
  p.created_at AS created_at_raw,
  strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) AS created_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', p.updated_at) AS updated_at,
  u.id AS author_id, u.username, u.display_name, u.avatar_color,
  (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count`;

const postFrom = `FROM community_posts p JOIN users u ON u.id = p.author_id`;

const visiblePostFilter = `p.status = 'published' AND u.status = 'active'`;

function mapAuthor(row: { id: string; username: string; display_name: string; avatar_color: string }) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
  };
}

function mapPostSummary(row: PostRow & { body: string }, viewerId: string | null): PostSummary {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic as PostTopic,
    imageUrl: row.image_key ? `/media/${row.image_key}` : null,
    author: mapAuthor({
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
    }),
    commentCount: Number(row.comment_count),
    isMine: viewerId !== null && viewerId === row.author_id,
    createdAt: toIso(row.created_at, row.created_at_raw),
    updatedAt: toIso(row.updated_at, row.created_at_raw),
    excerpt: excerptOf(row.body),
  };
}

function mapPost(row: PostRow & { body: string }, viewerId: string | null): CommunityPost {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    topic: row.topic as PostTopic,
    imageUrl: row.image_key ? `/media/${row.image_key}` : null,
    author: mapAuthor({
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
    }),
    commentCount: Number(row.comment_count),
    isMine: viewerId !== null && viewerId === row.author_id,
    createdAt: toIso(row.created_at, row.created_at_raw),
    updatedAt: toIso(row.updated_at, row.created_at_raw),
  };
}

function mapComment(row: CommentRow, viewerId: string | null): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    body: row.body,
    createdAt: toIso(row.created_at, row.created_at_raw),
    author: mapAuthor({
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
    }),
    isMine: viewerId !== null && viewerId === row.user_id,
  };
}

export async function listPosts(
  db: D1Database,
  viewerId: string | null,
  opts: { topic?: PostTopic | null; cursor?: string | null; limit?: number },
): Promise<{ posts: PostSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const conditions = [visiblePostFilter];
  const bindings: unknown[] = [];
  if (opts.topic) {
    conditions.push("p.topic = ?");
    bindings.push(opts.topic);
  }
  const cursor = decodeCursor(opts.cursor);
  if (cursor) {
    conditions.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit + 1);
  const rows = await db.prepare(
    `SELECT ${postColumns}, p.body ${postFrom}
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
  ).bind(...bindings).all<PostRow & { body: string }>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.results.length > limit && last
    ? encodeCursor(last.created_at_raw, last.id)
    : null;
  return { posts: page.map((row) => mapPostSummary(row, viewerId)), nextCursor };
}

export async function findPostById(
  db: D1Database,
  id: string,
  viewerId: string | null,
): Promise<CommunityPost | null> {
  const row = await db.prepare(
    `SELECT ${postColumns}, p.body ${postFrom} WHERE p.id = ? AND ${visiblePostFilter}`,
  ).bind(id).first<PostRow & { body: string }>();
  return row ? mapPost(row, viewerId) : null;
}

export async function listPostComments(
  db: D1Database,
  postId: string,
  viewerId: string | null,
): Promise<PostComment[]> {
  const rows = await db.prepare(
    `SELECT c.id, c.post_id, c.body, c.created_at AS created_at_raw,
       strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) AS created_at,
       u.id AS user_id, u.username, u.display_name, u.avatar_color
     FROM post_comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? AND c.status = 'published' AND u.status = 'active'
     ORDER BY c.created_at ASC, c.id ASC LIMIT ?`,
  ).bind(postId, MAX_COMMENTS).all<CommentRow>();
  return rows.results.map((row) => mapComment(row, viewerId));
}

export async function createPost(
  db: D1Database,
  input: { id?: string; authorId: string; title: string; body: string; topic: PostTopic; imageKey: string | null },
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  await db.prepare(
    `INSERT INTO community_posts (id, author_id, title, body, topic, image_key) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.authorId, input.title, input.body, input.topic, input.imageKey).run();
  return id;
}

export async function updatePost(
  db: D1Database,
  id: string,
  authorId: string,
  input: { title: string; body: string; topic: PostTopic },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE community_posts SET title = ?, body = ?, topic = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND author_id = ? AND status = 'published'`,
  ).bind(input.title, input.body, input.topic, id, authorId).run();
  return Boolean(result.meta.changes);
}

export async function hidePost(
  db: D1Database,
  id: string,
  actor: { userId: string; isAdmin: boolean },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE community_posts SET status = 'hidden', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'published' AND (author_id = ? OR ? = 1)`,
  ).bind(id, actor.userId, actor.isAdmin ? 1 : 0).run();
  return Boolean(result.meta.changes);
}

export async function createPostComment(
  db: D1Database,
  input: { postId: string; userId: string; body: string; notifyAuthorId: string | null },
): Promise<string | null> {
  const post = await db.prepare(
    `SELECT p.author_id, p.title, u.status AS author_status,
       (SELECT display_name FROM users WHERE id = ?) AS commenter_name
     FROM community_posts p LEFT JOIN users u ON u.id = p.author_id
     WHERE p.id = ? AND p.status = 'published'`,
  ).bind(input.userId, input.postId).first<{
    author_id: string;
    title: string;
    author_status: string | null;
    commenter_name: string | null;
  }>();
  if (!post) return null;

  const commentId = crypto.randomUUID();
  const statements = [
    db.prepare("INSERT INTO post_comments (id, post_id, user_id, body) VALUES (?, ?, ?, ?)")
      .bind(commentId, input.postId, input.userId, input.body),
  ];
  const notifyAuthorId = input.notifyAuthorId;
  if (
    notifyAuthorId &&
    notifyAuthorId === post.author_id &&
    notifyAuthorId !== input.userId &&
    post.author_status === "active"
  ) {
    statements.push(
      db.prepare(`INSERT INTO user_notifications (id, user_id, activity_id, type, title, body)
        VALUES (?, ?, NULL, 'post_comment', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          notifyAuthorId,
          "你的帖子有新回复",
          `${post.commenter_name ?? "有人"} 回复了「${post.title}」：${input.body.slice(0, 80)}`,
        ),
    );
  }
  await db.batch(statements);
  return commentId;
}

export async function hidePostComment(
  db: D1Database,
  input: { postId: string; commentId: string; userId: string },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE post_comments SET status = 'hidden', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND post_id = ? AND status = 'published'
       AND (user_id = ? OR EXISTS (
         SELECT 1 FROM community_posts p WHERE p.id = post_comments.post_id AND p.author_id = ?
       ))`,
  ).bind(input.commentId, input.postId, input.userId, input.userId).run();
  return Boolean(result.meta.changes);
}
