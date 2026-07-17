import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/media/[...key]">) {
  const { key: segments } = await context.params;
  if (!segments?.length || segments.some((segment) => !segment || segment === "..")) {
    return new Response("Not found", { status: 404 });
  }

  const key = segments.join("/");
  if (!key.startsWith("places/")) return new Response("Not found", { status: 404 });

  const { env } = await getCloudflareContext({ async: true });
  const object = await env.MEDIA.get(key, { onlyIf: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  if (!("body" in object)) return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
