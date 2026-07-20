import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/activities/[id]">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const result = await env.DB.prepare("UPDATE activities SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND creator_id = ? AND status = 'open'")
    .bind(id, user.id).run();
  if (!result.meta.changes) return NextResponse.json({ error: "只能取消自己发起的进行中活动" }, { status: 409 });
  return NextResponse.json({ cancelled: true });
}
