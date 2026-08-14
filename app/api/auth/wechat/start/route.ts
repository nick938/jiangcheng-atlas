import { NextResponse, type NextRequest } from "next/server";
import { oauthState, WECHAT_STATE_COOKIE, wechatBindings, wechatConfigured, wechatStateCookieOptions } from "@/lib/wechat-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const env = await wechatBindings();
  if (!wechatConfigured(env)) return NextResponse.redirect(new URL("/?wechat=unavailable", request.url));
  const state = oauthState();
  const callback = new URL("/api/auth/wechat/callback", request.url).toString();
  const authorize = new URL("https://open.weixin.qq.com/connect/qrconnect");
  authorize.search = new URLSearchParams({
    appid: env.WECHAT_APP_ID!,
    redirect_uri: callback,
    response_type: "code",
    scope: "snsapi_login",
    state,
  }).toString();
  authorize.hash = "wechat_redirect";
  const response = NextResponse.redirect(authorize);
  response.cookies.set(WECHAT_STATE_COOKIE, state, wechatStateCookieOptions(request.url));
  return response;
}
