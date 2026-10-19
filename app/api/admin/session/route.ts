import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  isSameOrigin,
  passwordsMatch,
  requireAdmin,
  requestClientIp,
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
  const expectedPassword = env.ADMIN_PASSWORD;
  const sessionSecret = env.ADMIN_SESSION_SECRET;
  if (typeof expectedPassword !== "string" || expectedPassword.length === 0
    || typeof sessionSecret !== "string" || sessionSecret.length === 0) {
    console.error(JSON.stringify({ event: "admin_credentials_missing" }));
    return NextResponse.json({ error: "管理员凭据未配置，请先设置 ADMIN_PASSWORD 与 ADMIN_SESSION_SECRET" }, { status: 503 });
  }
  if (expectedPassword.length < 16) {
    console.warn(JSON.stringify({ event: "admin_password_too_short", length: expectedPassword.length }));
  }

  // Key by client IP so anonymous traffic cannot exhaust a shared bucket and lock the
  // real administrator out (the previous constant key was a denial-of-service vector).
  const clientIp = requestClientIp(request);
  const rateLimit = await env.ADMIN_LOGIN_RATE_LIMITER.limit({ key: `admin-login:${clientIp}` });
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

  const valid = await passwordsMatch(body.password, expectedPassword);
  if (!valid) {
    ctx.waitUntil(
      writeAuditLog(env, "admin.login_failed", null, `ip=${clientIp}`.slice(0, 500)).catch((error: unknown) => {
        console.error("Failed to write failed login audit log", error);
      }),
    );
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }

  const token = await createAdminSession(sessionSecret);
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
