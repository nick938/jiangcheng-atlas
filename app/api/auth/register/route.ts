import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { newSession, passwordFingerprint, requestIp, USER_COOKIE_NAME, userCookieOptions } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
const colors = ["#d8ff3e", "#53d9ff", "#ff6b4a", "#d38cff", "#ffcf4a"];

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env } = await getCloudflareContext({ async: true });
  if (!(await env.USER_AUTH_RATE_LIMITER.limit({ key: requestIp(request) })).success) {
    return NextResponse.json({ error: "操作太频繁，请一分钟后再试" }, { status: 429 });
  }
  const body = await readJsonBody<{ username?: unknown; displayName?: unknown; password?: unknown }>(request, 4096);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return NextResponse.json({ error: "账号需为 3–24 位小写字母、数字或下划线" }, { status: 400 });
  if (displayName.length < 2 || displayName.length > 24) return NextResponse.json({ error: "昵称需为 2–24 个字符" }, { status: 400 });
  if (password.length < 10 || password.length > 72) return NextResponse.json({ error: "密码需为 10–72 个字符" }, { status: 400 });

  const id = crypto.randomUUID();
  const session = await newSession();
  const passwordHash = await passwordFingerprint(username, password, env.USER_AUTH_SECRET);
  const color = colors[username.split("").reduce((sum, value) => sum + value.charCodeAt(0), 0) % colors.length];
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, display_name, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?)").bind(id, username, displayName, passwordHash, color),
      env.DB.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(session.tokenHash, id, session.expiresAt),
    ]);
  } catch (error) {
    console.error("Registration failed", error);
    return NextResponse.json({ error: "这个账号已被使用" }, { status: 409 });
  }
  const response = NextResponse.json({ user: { id, username, displayName, avatarColor: color } }, { status: 201 });
  response.cookies.set(USER_COOKIE_NAME, session.token, userCookieOptions(request.url));
  return response;
}
