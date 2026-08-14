import { NextResponse, type NextRequest } from "next/server";
import { newSession, USER_COOKIE_NAME, userCookieOptions } from "@/lib/user-auth";
import { safeEqual, WECHAT_STATE_COOKIE, wechatBindings, wechatConfigured, wechatStateCookieOptions } from "@/lib/wechat-auth";

export const dynamic = "force-dynamic";

type TokenPayload = { access_token?: string; openid?: string; unionid?: string; errcode?: number; errmsg?: string };
type ProfilePayload = { openid?: string; unionid?: string; nickname?: string; headimgurl?: string; errcode?: number; errmsg?: string };

function redirectWith(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/?wechat=${encodeURIComponent(status)}`, request.url));
}

export async function GET(request: NextRequest) {
  const env = await wechatBindings();
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState = request.cookies.get(WECHAT_STATE_COOKIE)?.value ?? "";
  if (!wechatConfigured(env) || !code || !state || !expectedState || !safeEqual(state, expectedState)) {
    return redirectWith(request, "invalid");
  }
  try {
    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.search = new URLSearchParams({
      appid: env.WECHAT_APP_ID!,
      secret: env.WECHAT_APP_SECRET!,
      code,
      grant_type: "authorization_code",
    }).toString();
    const tokenResponse = await fetch(tokenUrl, { headers: { Accept: "application/json" } });
    const token = await tokenResponse.json() as TokenPayload;
    if (!tokenResponse.ok || !token.access_token || !token.openid || token.errcode) throw new Error(token.errmsg ?? "微信授权失败");

    const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
    profileUrl.search = new URLSearchParams({ access_token: token.access_token, openid: token.openid, lang: "zh_CN" }).toString();
    const profileResponse = await fetch(profileUrl, { headers: { Accept: "application/json" } });
    const profile = await profileResponse.json() as ProfilePayload;
    if (!profileResponse.ok || !profile.openid || profile.errcode) throw new Error(profile.errmsg ?? "微信资料读取失败");

    let row = await env.DB.prepare(`SELECT u.id, u.status FROM oauth_identities o
      JOIN users u ON u.id = o.user_id WHERE o.provider = 'wechat' AND o.provider_user_id = ?`)
      .bind(profile.openid).first<{ id: string; status: string }>();
    if (!row && (profile.unionid ?? token.unionid)) {
      row = await env.DB.prepare(`SELECT u.id, u.status FROM oauth_identities o
        JOIN users u ON u.id = o.user_id WHERE o.provider = 'wechat' AND o.union_id = ?`)
        .bind(profile.unionid ?? token.unionid).first<{ id: string; status: string }>();
    }
    if (row?.status === "suspended") return redirectWith(request, "suspended");
    const userId = row?.id ?? crypto.randomUUID();
    if (!row) {
      const suffix = profile.openid.slice(-12).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const username = `wx_${suffix || crypto.randomUUID().slice(0, 12)}`;
      const displayName = (profile.nickname?.trim() || "微信用户").slice(0, 24);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users
          (id, username, display_name, password_hash, avatar_color, avatar_url)
          VALUES (?, ?, ?, 'oauth:wechat', '#45c486', ?)`)
          .bind(userId, username, displayName, profile.headimgurl?.slice(0, 500) ?? null),
        env.DB.prepare(`INSERT INTO oauth_identities
          (provider, provider_user_id, union_id, user_id) VALUES ('wechat', ?, ?, ?)`)
          .bind(profile.openid, profile.unionid ?? token.unionid ?? null, userId),
      ]);
    } else {
      await env.DB.prepare(`UPDATE oauth_identities SET union_id = COALESCE(union_id, ?), updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'wechat' AND user_id = ?`).bind(profile.unionid ?? token.unionid ?? null, userId).run();
    }
    const session = await newSession();
    await env.DB.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(session.tokenHash, userId, session.expiresAt).run();
    const response = redirectWith(request, "success");
    response.cookies.set(WECHAT_STATE_COOKIE, "", { ...wechatStateCookieOptions(request.url), maxAge: 0 });
    response.cookies.set(USER_COOKIE_NAME, session.token, userCookieOptions(request.url));
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "wechat_oauth_failed", error: error instanceof Error ? error.message : "unknown" }));
    return redirectWith(request, "failed");
  }
}
