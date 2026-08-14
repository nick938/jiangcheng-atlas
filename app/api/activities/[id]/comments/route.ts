import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import type { ActivityComment } from "@/lib/community-types";
import { readJsonBody } from "@/lib/http";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type CommentRow = {
  id: string; activity_id: string; body: string; created_at: string;
  user_id: string; username: string; display_name: string; avatar_color: string;
};

function mapComment(row: CommentRow, userId: string | null): ActivityComment {
  return {
    id: row.id,
    activityId: row.activity_id,
    body: row.body,
    createdAt: row.created_at,
    author: { id: row.user_id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color },
    isOwner: row.user_id === userId,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  const activity = await env.DB.prepare(
    "SELECT id FROM activities WHERE id = ? AND moderation_status = 'visible'",
  ).bind(id).first();
  if (!activity) return NextResponse.json({ error: "活动不存在或已下架" }, { status: 404 });
  const rows = await env.DB.prepare(`SELECT c.id, c.activity_id, c.body, c.created_at,
      u.id AS user_id, u.username, u.display_name, u.avatar_color
    FROM activity_comments c JOIN users u ON u.id = c.user_id
    WHERE c.activity_id = ? AND c.status = 'published'
    ORDER BY datetime(c.created_at) ASC LIMIT 100`)
    .bind(id).all<CommentRow>();
  return NextResponse.json({ comments: rows.results.map((row) => mapComment(row, user?.id ?? null)) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const body = await readJsonBody<{ body?: unknown }>(request, 2048);
  const content = typeof body?.body === "string" ? body.body.trim() : "";
  if (content.length < 1 || content.length > 300) {
    return NextResponse.json({ error: "留言需为 1–300 个字符" }, { status: 400 });
  }
  const activity = await env.DB.prepare(`SELECT creator_id, title FROM activities
    WHERE id = ? AND moderation_status = 'visible' AND status = 'open'
    AND datetime(COALESCE(ends_at, datetime(starts_at, '+2 hours')), '+7 days') > datetime('now')
    AND (creator_id = ? OR EXISTS (
      SELECT 1 FROM activity_members WHERE activity_id = activities.id AND user_id = ?
    ))`).bind(id, user.id, user.id).first<{ creator_id: string; title: string }>();
  if (!activity) return NextResponse.json({ error: "只有参加者可以留言，或活动已关闭" }, { status: 403 });
  const commentId = crypto.randomUUID();
  const statements = [
    env.DB.prepare("INSERT INTO activity_comments (id, activity_id, user_id, body) VALUES (?, ?, ?, ?)")
      .bind(commentId, id, user.id, content),
  ];
  if (activity.creator_id !== user.id) {
    statements.push(env.DB.prepare(`INSERT INTO user_notifications
      (id, user_id, activity_id, type, title, body) VALUES (?, ?, ?, 'new_comment', ?, ?)`)
      .bind(crypto.randomUUID(), activity.creator_id, id, `「${activity.title}」有新留言`, `${user.displayName}：${content.slice(0, 80)}`));
  }
  await env.DB.batch(statements);
  return NextResponse.json({ id: commentId }, { status: 201 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const commentId = new URL(request.url).searchParams.get("comment");
  if (!commentId) return NextResponse.json({ error: "缺少留言编号" }, { status: 400 });
  const result = await env.DB.prepare(`UPDATE activity_comments SET status = 'hidden', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND activity_id = ? AND user_id = ? AND status = 'published'`)
    .bind(commentId, id, user.id).run();
  if (!result.meta.changes) return NextResponse.json({ error: "只能删除自己的留言" }, { status: 403 });
  return NextResponse.json({ deleted: true });
}
