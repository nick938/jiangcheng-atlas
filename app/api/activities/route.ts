import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { listActivities, listMyActivities } from "@/lib/community-repository";
import type { ActivityType } from "@/lib/community-types";
import { readJsonBody } from "@/lib/http";
import { inspectUploadedImage, MAX_IMAGE_REQUEST_BYTES } from "@/lib/image-upload";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
const activityTypes = new Set<ActivityType>(["ride", "walk", "sports", "food", "photo", "other"]);

export async function GET(request: NextRequest) {
  const { env, user } = await currentUser(request);
  const [activities, myActivities] = await Promise.all([
    listActivities(env.DB, user),
    user ? listMyActivities(env.DB, user) : Promise.resolve([]),
  ]);
  return NextResponse.json({ activities, myActivities, user }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> | null;
  let image: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_IMAGE_REQUEST_BYTES) {
      return NextResponse.json({ error: "图片不能超过 5 MB" }, { status: 413 });
    }
    const form = await request.formData();
    body = Object.fromEntries(
      [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    const uploaded = form.get("image");
    image = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  } else {
    body = await readJsonBody<Record<string, unknown>>(request, 8192);
  }
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const details = typeof body?.details === "string" ? body.details.trim() : "";
  const activityType = typeof body?.activityType === "string" ? body.activityType as ActivityType : "other";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const meetingName = typeof body?.meetingName === "string" ? body.meetingName.trim() : "";
  const meetingLongitude = Number(body?.meetingLongitude);
  const meetingLatitude = Number(body?.meetingLatitude);
  const capacity = Number(body?.capacity);
  const startTime = new Date(startsAt).getTime();
  const endTime = new Date(endsAt).getTime();
  const validLocation = Number.isFinite(meetingLongitude) && meetingLongitude >= 113.9 && meetingLongitude <= 114.8
    && Number.isFinite(meetingLatitude) && meetingLatitude >= 30.2 && meetingLatitude <= 30.9;
  if (title.length < 4 || title.length > 48 || details.length < 10 || details.length > 600
    || meetingName.length < 2 || meetingName.length > 80 || !Number.isInteger(capacity)
    || capacity < 2 || capacity > 50 || !activityTypes.has(activityType) || !validLocation
    || !Number.isFinite(startTime) || !Number.isFinite(endTime)
    || startTime < Date.now() + 30 * 60_000 || startTime > Date.now() + 90 * 86400_000
    || endTime < startTime + 15 * 60_000 || endTime > startTime + 7 * 86400_000) {
    return NextResponse.json({ error: "请检查类型、标题、说明、时间、人数和地图位置" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const inspectedImage = image ? await inspectUploadedImage(image) : null;
  if (image && !inspectedImage) {
    return NextResponse.json({ error: "仅支持 5 MB 内、内容有效的 JPEG、PNG、WebP 或 AVIF" }, { status: 400 });
  }
  const imageKey = image && inspectedImage
    ? `activities/${id}/${crypto.randomUUID()}.${inspectedImage.extension}`
    : null;

  if (image && inspectedImage && imageKey) {
    try {
      const object = await env.MEDIA.put(imageKey, await image.arrayBuffer(), {
        httpMetadata: {
          contentType: inspectedImage.contentType,
          cacheControl: "public, max-age=31536000, immutable",
          contentDisposition: "inline",
        },
        customMetadata: { activityId: id, originalName: image.name.slice(0, 120) },
      });
      if (!object) return NextResponse.json({ error: "图片存储失败" }, { status: 500 });
    } catch (error) {
      console.error("Failed to upload activity image", error);
      return NextResponse.json({ error: "图片存储失败，请稍后重试" }, { status: 500 });
    }
  }

  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO activities
      (id, creator_id, activity_type, title, details, starts_at, ends_at, meeting_name,
       meeting_longitude, meeting_latitude, capacity, image_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, activityType, title, details, new Date(startTime).toISOString(), new Date(endTime).toISOString(),
        meetingName, meetingLongitude, meetingLatitude, capacity, imageKey),
      env.DB.prepare("INSERT INTO activity_members (activity_id, user_id) VALUES (?, ?)").bind(id, user.id),
    ]);
  } catch (error) {
    if (imageKey) await env.MEDIA.delete(imageKey);
    console.error("Failed to create activity", error);
    return NextResponse.json({ error: "差事发布失败，图片已回滚" }, { status: 500 });
  }
  return NextResponse.json({ id }, { status: 201 });
}
