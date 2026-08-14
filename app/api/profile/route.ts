import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { currentUser, USER_COOKIE_NAME, userCookieOptions } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonBody<{ displayName?: unknown }>(request, 2048);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length < 2 || displayName.length > 24) return NextResponse.json({ error: "昵称需为 2–24 个字符" }, { status: 400 });
  await env.DB.prepare("UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(displayName, user.id).run();
  return NextResponse.json({ user: { ...user, displayName } });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonBody<{ confirmation?: unknown }>(request, 1024);
  if (body?.confirmation !== "注销") return NextResponse.json({ error: "请输入“注销”确认" }, { status: 400 });
  const anonymized = `deleted_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET username = ?, display_name = '已注销用户', password_hash = ?,
      password_salt = NULL, password_iterations = NULL, avatar_url = NULL, status = 'suspended', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).bind(anonymized, crypto.randomUUID(), user.id),
    env.DB.prepare("DELETE FROM oauth_identities WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(user.id),
  ]);
  const response = NextResponse.json({ deleted: true });
  response.cookies.set(USER_COOKIE_NAME, "", { ...userCookieOptions(request.url), maxAge: 0 });
  return response;
}
