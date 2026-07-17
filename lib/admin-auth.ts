import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE_NAME = "jc_admin_session";
const SESSION_SECONDS = 60 * 60 * 8;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function passwordsMatch(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([digest(candidate), digest(expected)]);
  return equalBytes(candidateHash, expectedHash);
}

export async function createAdminSession(secret: string): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, v: 1 })),
  );
  const signature = toBase64Url(await hmac(payload, secret));
  return `${payload}.${signature}`;
}

export async function verifyAdminSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;

  const providedSignature = fromBase64Url(signature);
  if (!providedSignature) return false;
  const expectedSignature = await hmac(payload, secret);
  if (providedSignature.byteLength !== expectedSignature.byteLength) return false;
  if (!equalBytes(providedSignature, expectedSignature)) return false;

  const payloadBytes = fromBase64Url(payload);
  if (!payloadBytes) return false;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: unknown; v?: unknown };
    return parsed.v === 1 && typeof parsed.exp === "number" && parsed.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function getCookieValue(request: NextRequest, name: string): string | undefined {
  return request.cookies.get(name)?.value;
}

export async function requireAdmin(request: NextRequest): Promise<CloudflareEnv | null> {
  const { env } = await getCloudflareContext({ async: true });
  const valid = await verifyAdminSession(getCookieValue(request, ADMIN_COOKIE_NAME), env.ADMIN_SESSION_SECRET);
  return valid ? env : null;
}

export async function mutationAllowed(env: CloudflareEnv): Promise<boolean> {
  const outcome = await env.ADMIN_MUTATION_RATE_LIMITER.limit({ key: "admin-mutation" });
  return outcome.success;
}

export function sessionCookieOptions(requestUrl: string) {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_SECONDS,
    priority: "high" as const,
  };
}

export async function writeAuditLog(
  env: CloudflareEnv,
  action: string,
  placeId: string | null,
  detail = "",
) {
  await env.DB.prepare(
    "INSERT INTO admin_audit_logs (id, action, place_id, detail) VALUES (?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), action, placeId, detail.slice(0, 500)).run();
}
