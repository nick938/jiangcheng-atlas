import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: RouteContext<"/api/activities/[id]/join">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO activity_members (activity_id, user_id)
     SELECT a.id, ? FROM activities a WHERE a.id = ? AND a.status = 'open'
     AND datetime(a.starts_at) > datetime('now')
     AND (SELECT COUNT(*) FROM activity_members m WHERE m.activity_id = a.id) < a.capacity`,
  ).bind(user.id, id).run();
  if (!result.meta.changes) return NextResponse.json({ error: "活动已开始、已满员，或你已经加入" }, { status: 409 });
  await env.DB.prepare(`INSERT INTO user_notifications (id, user_id, activity_id, type, title, body)
    SELECT ?, creator_id, id, 'activity_joined', '有新成员加入', ? FROM activities WHERE id = ? AND creator_id != ?`)
    .bind(crypto.randomUUID(), `${user.displayName} 加入了你的活动。`, id, user.id).run();
  return NextResponse.json({ joined: true });
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/activities/[id]/join">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const activity = await env.DB.prepare("SELECT creator_id FROM activities WHERE id = ?").bind(id).first<{ creator_id: string }>();
  if (activity?.creator_id === user.id) return NextResponse.json({ error: "发起人不能退出，可取消活动" }, { status: 409 });
  const result = await env.DB.prepare(
    `DELETE FROM activity_members WHERE activity_id = ? AND user_id = ?
     AND EXISTS (
       SELECT 1 FROM activities a WHERE a.id = activity_members.activity_id
       AND a.status = 'open' AND datetime(a.starts_at) > datetime('now')
     )`,
  ).bind(id, user.id).run();
  if (!result.meta.changes) {
    return NextResponse.json({ error: "只能退出尚未开始的差事" }, { status: 409 });
  }
  return NextResponse.json({ joined: false });
}
