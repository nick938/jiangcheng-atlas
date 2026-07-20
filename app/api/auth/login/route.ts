import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { fingerprintsMatch, newSession, passwordFingerprint, requestIp, USER_COOKIE_NAME, userCookieOptions } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env } = await getCloudflareContext({ async: true });
  if (!(await env.USER_AUTH_RATE_LIMITER.limit({ key: requestIp(request) })).success) {
    return NextResponse.json({ error: "操作太频繁，请一分钟后再试" }, { status: 429 });
  }
  const body = await readJsonBody<{ username?: unknown; password?: unknown }>(request, 4096);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const row = await env.DB.prepare("SELECT id, username, display_name, avatar_color, password_hash FROM users WHERE username = ? AND status = 'active'")
    .bind(username).first<{ id: string; username: string; display_name: string; avatar_color: string; password_hash: string }>();
  const candidate = await passwordFingerprint(username, password, env.USER_AUTH_SECRET);
  if (!row || !fingerprintsMatch(candidate, row.password_hash)) return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
  const session = await newSession();
  await env.DB.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(session.tokenHash, row.id, session.expiresAt).run();
  const response = NextResponse.json({ user: { id: row.id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color } });
  response.cookies.set(USER_COOKIE_NAME, session.token, userCookieOptions(request.url));
  return response;
}
