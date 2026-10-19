import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { currentUser, USER_COOKIE_NAME, userCookieOptions } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { user } = await currentUser(request);
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}

/** 登出不接限流：仅删除自己的会话且幂等，无可被刷的副作用。 */
export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, tokenHash } = await currentUser(request);
  if (tokenHash) await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(tokenHash).run();
  const response = NextResponse.json({ user: null });
  response.cookies.set(USER_COOKIE_NAME, "", { ...userCookieOptions(request.url), maxAge: 0 });
  return response;
}
