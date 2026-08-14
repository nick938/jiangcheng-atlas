import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { validateActivityInput } from "@/lib/activity-validation";
import { readJsonBody } from "@/lib/http";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, context: RouteContext<"/api/activities/[id]">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const body = await readJsonBody<Record<string, unknown>>(request, 8192);
  const validation = validateActivityInput(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { title, details, activityType, startsAt, endsAt, meetingName, meetingLongitude, meetingLatitude, capacity } = validation.data;
  const result = await env.DB.prepare(`UPDATE activities SET activity_type = ?, title = ?, details = ?,
      starts_at = ?, ends_at = ?, meeting_name = ?, meeting_longitude = ?, meeting_latitude = ?, capacity = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND creator_id = ? AND status = 'open' AND moderation_status = 'visible'
      AND datetime(starts_at) > datetime('now')
      AND ? >= (SELECT COUNT(*) FROM activity_members WHERE activity_id = activities.id)`)
    .bind(activityType, title, details, startsAt, endsAt,
      meetingName, meetingLongitude, meetingLatitude, capacity, id, user.id, capacity).run();
  if (!result.meta.changes) {
    return NextResponse.json({ error: "只能编辑自己尚未开始的活动，且人数不能低于已报名人数" }, { status: 409 });
  }
  await env.DB.prepare(`INSERT INTO user_notifications (id, user_id, activity_id, type, title, body)
    SELECT lower(hex(randomblob(16))), m.user_id, a.id, 'activity_updated', '活动信息有更新', ?
    FROM activity_members m JOIN activities a ON a.id = m.activity_id
    WHERE a.id = ? AND m.user_id != ?`)
    .bind(`「${title}」的时间、地点或详情可能有调整，请重新确认。`, id, user.id).run();
  return NextResponse.json({ updated: true });
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/activities/[id]">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const result = await env.DB.prepare(
    `UPDATE activities SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND creator_id = ? AND status = 'open'`,
  ).bind(id, user.id).run();
  if (!result.meta.changes) {
    return NextResponse.json({ error: "只能完成自己发起的进行中差事" }, { status: 409 });
  }
  return NextResponse.json({ completed: true });
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/activities/[id]">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const result = await env.DB.prepare(
    `UPDATE activities SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND creator_id = ? AND status = 'open'`,
  )
    .bind(id, user.id).run();
  if (!result.meta.changes) return NextResponse.json({ error: "只能取消自己发起的进行中活动" }, { status: 409 });
  await env.DB.prepare(`INSERT INTO user_notifications (id, user_id, activity_id, type, title, body)
    SELECT lower(hex(randomblob(16))), m.user_id, a.id, 'activity_cancelled', '活动已取消', '「' || a.title || '」已由发起人取消。'
    FROM activity_members m JOIN activities a ON a.id = m.activity_id
    WHERE a.id = ? AND m.user_id != ?`).bind(id, user.id).run();
  return NextResponse.json({ cancelled: true });
}
