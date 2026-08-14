import { getCloudflareContext } from "@opennextjs/cloudflare";

export const WECHAT_STATE_COOKIE = "jc_wechat_oauth_state";
export const WECHAT_STATE_SECONDS = 10 * 60;

type WechatBindings = CloudflareEnv & {
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
};

export async function wechatBindings() {
  const { env } = await getCloudflareContext({ async: true });
  return env as WechatBindings;
}

export function wechatConfigured(env: WechatBindings) {
  return Boolean(env.WECHAT_APP_ID?.trim() && env.WECHAT_APP_SECRET?.trim());
}

export function oauthState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function wechatStateCookieOptions(requestUrl: string) {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "lax" as const,
    path: "/api/auth/wechat",
    maxAge: WECHAT_STATE_SECONDS,
    priority: "high" as const,
  };
}
