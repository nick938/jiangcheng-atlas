import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  isSameOrigin,
  passwordsMatch,
  requireAdmin,
  sessionCookieOptions,
  writeAuditLog,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const env = await requireAdmin(request);
  return NextResponse.json(
    { authenticated: env !== null },
    { status: env ? 200 : 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 2048) {
    return NextResponse.json({ error: "请求格式无效" }, { status: 413 });
  }

  const { env, ctx } = await getCloudflareContext({ async: true });
  const rateLimit = await env.ADMIN_LOGIN_RATE_LIMITER.limit({ key: "admin-login" });
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "尝试次数过多，请一分钟后再试" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== "string" || body.password.length > 256) {
    return NextResponse.json({ error: "请输入管理员密码" }, { status: 400 });
  }

  const valid = await passwordsMatch(body.password, env.ADMIN_PASSWORD);
  if (!valid) {
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }

  const token = await createAdminSession(env.ADMIN_SESSION_SECRET);
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, sessionCookieOptions(request.url));
  ctx.waitUntil(
    writeAuditLog(env, "admin.login", null).catch((error: unknown) => {
      console.error("Failed to write login audit log", error);
    }),
  );
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    ...sessionCookieOptions(request.url),
    maxAge: 0,
  });
  return response;
}
