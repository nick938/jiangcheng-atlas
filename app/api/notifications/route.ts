import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import type { CommunityNotification } from "@/lib/community-types";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type NotificationRow = {
  id: string; activity_id: string | null; type: CommunityNotification["type"];
  title: string; body: string; read_at: string | null; created_at: string;
};

export async function GET(request: NextRequest) {
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const rows = await env.DB.prepare(`SELECT id, activity_id, type, title, body, read_at, created_at
    FROM user_notifications WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 50`)
    .bind(user.id).all<NotificationRow>();
  const notifications: CommunityNotification[] = rows.results.map((row) => ({
    id: row.id,
    activityId: row.activity_id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
  return NextResponse.json({ notifications }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  await env.DB.prepare("UPDATE user_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL")
    .bind(user.id).run();
  return NextResponse.json({ read: true });
}
