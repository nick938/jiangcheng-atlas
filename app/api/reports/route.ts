import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

const targetTypes = new Set(["activity", "comment", "user"]);
const reasons = new Set(["spam", "unsafe", "harassment", "false_info", "other"]);

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录后举报" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const body = await readJsonBody<{ targetType?: unknown; targetId?: unknown; reason?: unknown; details?: unknown }>(request, 4096);
  const targetType = typeof body?.targetType === "string" ? body.targetType : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const details = typeof body?.details === "string" ? body.details.trim() : "";
  if (!targetTypes.has(targetType) || !reasons.has(reason) || targetId.length < 1 || targetId.length > 100 || details.length > 500) {
    return NextResponse.json({ error: "举报信息不完整" }, { status: 400 });
  }
  const targetQuery = targetType === "activity"
    ? "SELECT id FROM activities WHERE id = ?"
    : targetType === "comment"
      ? "SELECT id FROM activity_comments WHERE id = ?"
      : "SELECT id FROM users WHERE id = ?";
  if (!(await env.DB.prepare(targetQuery).bind(targetId).first())) {
    return NextResponse.json({ error: "举报对象不存在" }, { status: 404 });
  }
  try {
    await env.DB.prepare(`INSERT INTO community_reports
      (id, reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), user.id, targetType, targetId, reason, details).run();
  } catch {
    return NextResponse.json({ error: "你已经举报过这条内容" }, { status: 409 });
  }
  return NextResponse.json({ reported: true }, { status: 201 });
}
