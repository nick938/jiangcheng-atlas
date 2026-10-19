import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  etagMatches,
  mediaCacheControl,
  mediaContentDisposition,
  mediaContentType,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/** 只有这些前缀下的对象允许经本路由读取；posts/ 供社区帖子图片使用。 */
const keyPrefixes = ["places/", "activities/", "posts/"] as const;

/**
 * 本地 dev / preview 环境可能没有 Cache API，任何不可用都直接回源，
 * 不允许因为缓存层异常让请求 500。
 */
function edgeCache(): Cache | null {
  try {
    return (caches as unknown as { default?: Cache }).default ?? null;
  } catch {
    return null;
  }
}

function mediaHeaders(object: R2Object): Headers {
  const headers = new Headers();
  const metadata = object.httpMetadata;
  // 只按「存储的 Content-Type 是否在白名单内」决定类型与处置方式；
  // 其余内容一律 octet-stream + attachment，避免同源存储型 XSS。
  headers.set("Content-Type", mediaContentType(metadata?.contentType));
  headers.set("Content-Disposition", mediaContentDisposition(metadata?.contentType));
  headers.set("Cache-Control", mediaCacheControl(metadata?.cacheControl));
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", object.uploaded.toUTCString());
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function notModified(etag: string | null, cacheControl: string | null): Response {
  const headers = new Headers();
  if (etag) headers.set("ETag", etag);
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(null, { status: 304, headers });
}

export async function GET(request: Request, context: RouteContext<"/media/[...key]">) {
  const { key: segments } = await context.params;
  if (!segments?.length || segments.some((segment) => !segment || segment === ".." || segment === ".")) {
    return new Response("Not found", { status: 404 });
  }

  const key = segments.join("/");
  if (!keyPrefixes.some((prefix) => key.startsWith(prefix))) {
    return new Response("Not found", { status: 404 });
  }

  const cache = edgeCache();
  if (cache) {
    try {
      const cached = await cache.match(request);
      if (cached) {
        if (etagMatches(request.headers.get("if-none-match"), cached.headers.get("ETag"))) {
          return notModified(cached.headers.get("ETag"), cached.headers.get("Cache-Control"));
        }
        return cached;
      }
    } catch {
      // 缓存不可用时静默回源
    }
  }

  const { env, ctx } = await getCloudflareContext({ async: true });
  const object = await env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = mediaHeaders(object);
  if (etagMatches(request.headers.get("if-none-match"), headers.get("ETag"))) {
    return notModified(headers.get("ETag"), headers.get("Cache-Control"));
  }

  const response = new Response(object.body, { headers });
  if (cache) {
    try {
      const stored = cache.put(request, response.clone());
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(stored);
      else void stored.catch(() => undefined);
    } catch {
      // 忽略写入失败（例如本地环境不支持）
    }
  }
  return response;
}
