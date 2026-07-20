import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
const paces = new Set(["relaxed", "steady", "sport"]);

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  const body = await readJsonBody<Record<string, unknown>>(request, 8192);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const details = typeof body?.details === "string" ? body.details.trim() : "";
  const routeId = typeof body?.routeId === "string" ? body.routeId : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const meetingName = typeof body?.meetingName === "string" ? body.meetingName.trim() : "";
  const capacity = Number(body?.capacity);
  const pace = typeof body?.pace === "string" ? body.pace : "";
  const route = await env.DB.prepare("SELECT start_longitude, start_latitude FROM cycling_routes WHERE id = ? AND status = 'published'")
    .bind(routeId).first<{ start_longitude: number; start_latitude: number }>();
  const startTime = new Date(startsAt).getTime();
  if (title.length < 4 || title.length > 48 || details.length < 10 || details.length > 400 || meetingName.length < 2 || meetingName.length > 80 || !Number.isInteger(capacity) || capacity < 2 || capacity > 30 || !paces.has(pace) || !route || !Number.isFinite(startTime) || startTime < Date.now() + 30 * 60_000 || startTime > Date.now() + 90 * 86400_000) {
    return NextResponse.json({ error: "请检查标题、说明、时间、人数和集合点" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO activities (id, creator_id, route_id, title, details, starts_at, meeting_name, meeting_longitude, meeting_latitude, capacity, pace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, routeId, title, details, new Date(startTime).toISOString(), meetingName, route.start_longitude, route.start_latitude, capacity, pace),
    env.DB.prepare("INSERT INTO activity_members (activity_id, user_id) VALUES (?, ?)").bind(id, user.id),
  ]);
  return NextResponse.json({ id }, { status: 201 });
}
