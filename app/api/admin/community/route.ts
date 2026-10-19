import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, mutationAllowed, requireAdmin, writeAuditLog } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";

export const dynamic = "force-dynamic";

const actions = new Set([
  "user.suspend", "user.activate", "activity.hide", "activity.show",
  "comment.hide", "report.resolve", "report.dismiss",
  "post.hide", "post.show", "post_comment.hide",
]);

export async function GET(request: NextRequest) {
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [users, activities, posts, reports] = await Promise.all([
    env.DB.prepare(`SELECT u.id, u.username, u.display_name, u.status, u.created_at,
      (SELECT COUNT(*) FROM activities a WHERE a.creator_id = u.id) AS activity_count,
      (SELECT COUNT(*) FROM community_reports r WHERE r.reporter_id = u.id) AS report_count
      FROM users u ORDER BY datetime(u.created_at) DESC LIMIT 200`).all(),
    env.DB.prepare(`SELECT a.id, a.title, a.status, a.moderation_status, a.starts_at, a.ends_at,
      a.created_at, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM activity_members m WHERE m.activity_id = a.id) AS member_count,
      (SELECT COUNT(*) FROM community_reports r WHERE r.target_type = 'activity' AND r.target_id = a.id AND r.status = 'open') AS open_reports
      FROM activities a JOIN users u ON u.id = a.creator_id
      ORDER BY datetime(a.created_at) DESC LIMIT 200`).all(),
    env.DB.prepare(`SELECT p.id, p.title, p.status, p.topic, p.created_at,
      u.display_name AS author_name,
      (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count,
      (SELECT COUNT(*) FROM community_reports r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.status = 'open') AS open_reports
      FROM community_posts p JOIN users u ON u.id = p.author_id
      ORDER BY datetime(p.created_at) DESC LIMIT 200`).all(),
    env.DB.prepare(`SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status,
      r.created_at, u.display_name AS reporter_name,
      CASE r.target_type
        WHEN 'activity' THEN COALESCE((SELECT title FROM activities WHERE id = r.target_id), '已删除活动')
        WHEN 'comment' THEN COALESCE((SELECT substr(body, 1, 80) FROM activity_comments WHERE id = r.target_id), '已删除留言')
        WHEN 'user' THEN COALESCE((SELECT display_name FROM users WHERE id = r.target_id), '已删除用户')
        WHEN 'post' THEN COALESCE((SELECT title FROM community_posts WHERE id = r.target_id), '已删除帖子')
        WHEN 'post_comment' THEN COALESCE((SELECT substr(body, 1, 80) FROM post_comments WHERE id = r.target_id), '已删除评论')
      END AS target_label
      FROM community_reports r JOIN users u ON u.id = r.reporter_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, datetime(r.created_at) DESC LIMIT 200`).all(),
  ]);
  return NextResponse.json({ users: users.results, activities: activities.results, posts: posts.results, reports: reports.results }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await mutationAllowed(env))) return NextResponse.json({ error: "操作过于频繁" }, { status: 429 });
  const body = await readJsonBody<{ action?: unknown; targetId?: unknown }>(request, 2048);
  const action = typeof body?.action === "string" ? body.action : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  if (!actions.has(action) || targetId.length < 1 || targetId.length > 100) {
    return NextResponse.json({ error: "治理操作无效" }, { status: 400 });
  }
  const statements: Record<string, { sql: string; params: unknown[] }> = {
    "user.suspend": {
      sql: "UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
      params: [targetId],
    },
    "user.activate": {
      sql: "UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'suspended'",
      params: [targetId],
    },
    "activity.hide": {
      sql: "UPDATE activities SET moderation_status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND moderation_status = 'visible'",
      params: [targetId],
    },
    "activity.show": {
      sql: "UPDATE activities SET moderation_status = 'visible', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND moderation_status = 'hidden'",
      params: [targetId],
    },
    "comment.hide": {
      sql: "UPDATE activity_comments SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'published'",
      params: [targetId],
    },
    "post.hide": {
      sql: "UPDATE community_posts SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'published'",
      params: [targetId],
    },
    "post.show": {
      sql: "UPDATE community_posts SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'hidden'",
      params: [targetId],
    },
    "post_comment.hide": {
      sql: "UPDATE post_comments SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'published'",
      params: [targetId],
    },
    "report.resolve": {
      sql: "UPDATE community_reports SET status = 'resolved', handled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
      params: [targetId],
    },
    "report.dismiss": {
      sql: "UPDATE community_reports SET status = 'dismissed', handled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
      params: [targetId],
    },
  };
  const selected = statements[action];
  const result = await env.DB.prepare(selected.sql).bind(...selected.params).run();
  if (!result.meta.changes) return NextResponse.json({ error: "对象不存在或状态没有变化" }, { status: 409 });
  if (action === "user.suspend") {
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(targetId).run();
  }
  await writeAuditLog(env, action, null, targetId);
  if (action === "post.hide" || action === "post.show") {
    revalidatePath(`/post/${targetId}`);
  }
  return NextResponse.json({ updated: true });
}
