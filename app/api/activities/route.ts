import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { listActivities } from "@/lib/community-repository";
import type { ActivityType } from "@/lib/community-types";
import { readJsonBody } from "@/lib/http";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
const activityTypes = new Set<ActivityType>(["ride", "walk", "sports", "food", "photo", "other"]);

export async function GET(request: NextRequest) {
  const { env, user } = await currentUser(request);
  const activities = await listActivities(env.DB, user);
  return NextResponse.json({ activities, user }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  const body = await readJsonBody<Record<string, unknown>>(request, 8192);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const details = typeof body?.details === "string" ? body.details.trim() : "";
  const activityType = typeof body?.activityType === "string" ? body.activityType as ActivityType : "other";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const meetingName = typeof body?.meetingName === "string" ? body.meetingName.trim() : "";
  const meetingLongitude = Number(body?.meetingLongitude);
  const meetingLatitude = Number(body?.meetingLatitude);
  const capacity = Number(body?.capacity);
  const startTime = new Date(startsAt).getTime();
  const validLocation = Number.isFinite(meetingLongitude) && meetingLongitude >= 113.9 && meetingLongitude <= 114.8
    && Number.isFinite(meetingLatitude) && meetingLatitude >= 30.2 && meetingLatitude <= 30.9;
  if (title.length < 4 || title.length > 48 || details.length < 10 || details.length > 600
    || meetingName.length < 2 || meetingName.length > 80 || !Number.isInteger(capacity)
    || capacity < 2 || capacity > 50 || !activityTypes.has(activityType) || !validLocation
    || !Number.isFinite(startTime) || startTime < Date.now() + 30 * 60_000
    || startTime > Date.now() + 90 * 86400_000) {
    return NextResponse.json({ error: "请检查类型、标题、说明、时间、人数和地图位置" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO activities
      (id, creator_id, activity_type, title, details, starts_at, meeting_name,
       meeting_longitude, meeting_latitude, capacity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, activityType, title, details, new Date(startTime).toISOString(),
        meetingName, meetingLongitude, meetingLatitude, capacity),
    env.DB.prepare("INSERT INTO activity_members (activity_id, user_id) VALUES (?, ?)").bind(id, user.id),
  ]);
  return NextResponse.json({ id }, { status: 201 });
}
