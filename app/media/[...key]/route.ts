import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/media/[...key]">) {
  const { key: segments } = await context.params;
  if (!segments?.length || segments.some((segment) => !segment || segment === "..")) {
    return new Response("Not found", { status: 404 });
  }

  const key = segments.join("/");
  if (!key.startsWith("places/") && !key.startsWith("activities/")) {
    return new Response("Not found", { status: 404 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const object = await env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  const metadata = object.httpMetadata;
  if (metadata?.contentType) headers.set("Content-Type", metadata.contentType);
  if (metadata?.contentLanguage) headers.set("Content-Language", metadata.contentLanguage);
  if (metadata?.contentDisposition) headers.set("Content-Disposition", metadata.contentDisposition);
  if (metadata?.contentEncoding) headers.set("Content-Encoding", metadata.contentEncoding);
  if (metadata?.cacheExpiry) headers.set("Expires", metadata.cacheExpiry.toUTCString());
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", metadata?.cacheControl ?? "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
