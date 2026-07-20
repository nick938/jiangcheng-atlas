import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";
import type { CommunityUser } from "@/lib/community-types";
import { getCookieValue } from "@/lib/admin-auth";

export const USER_COOKIE_NAME = "jc_user_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function passwordFingerprint(username: string, password: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${username.toLowerCase()}\0${password}`),
  );
  return toHex(new Uint8Array(signature));
}

export function fingerprintsMatch(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function newSession() {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(random);
  return {
    token,
    tokenHash: await sha256(token),
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
  };
}

export async function currentUser(request: NextRequest): Promise<{ env: CloudflareEnv; user: CommunityUser | null; tokenHash: string | null }> {
  const { env } = await getCloudflareContext({ async: true });
  const token = getCookieValue(request, USER_COOKIE_NAME);
  if (!token) return { env, user: null, tokenHash: null };
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_color
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
  ).bind(tokenHash, new Date().toISOString()).first<{
    id: string; username: string; display_name: string; avatar_color: string;
  }>();
  return {
    env,
    tokenHash,
    user: row ? { id: row.id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color } : null,
  };
}

export function userCookieOptions(requestUrl: string) {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_SECONDS,
    priority: "high" as const,
  };
}

export function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "local";
}
