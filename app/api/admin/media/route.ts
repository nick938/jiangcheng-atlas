import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, mutationAllowed, requireAdmin } from "@/lib/admin-auth";
import {
  inspectUploadedImage,
  MAX_IMAGE_REQUEST_BYTES,
} from "@/lib/image-upload";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await mutationAllowed(env))) {
    return NextResponse.json({ error: "操作过于频繁" }, { status: 429 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_IMAGE_REQUEST_BYTES) {
    return NextResponse.json({ error: "图片不能超过 5 MB" }, { status: 413 });
  }

  const form = await request.formData();
  const placeId = form.get("placeId");
  const file = form.get("file");
  if (typeof placeId !== "string" || !placeId || placeId.length > 100 || !(file instanceof File)) {
    return NextResponse.json({ error: "请选择地点和图片" }, { status: 400 });
  }
  const inspected = await inspectUploadedImage(file);
  if (!inspected) {
    return NextResponse.json({ error: "仅支持 5 MB 内、内容有效的 JPEG、PNG、WebP 或 AVIF" }, { status: 400 });
  }

  const place = await env.DB.prepare(
    "SELECT id FROM places WHERE id = ? AND status != 'archived'",
  ).bind(placeId).first<{ id: string }>();
  if (!place) return NextResponse.json({ error: "地点不存在" }, { status: 404 });

  const imageId = crypto.randomUUID();
  const key = `places/${placeId}/${imageId}.${inspected.extension}`;
  const object = await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: inspected.contentType,
      cacheControl: "public, max-age=31536000, immutable",
      contentDisposition: "inline",
    },
    customMetadata: { placeId, originalName: file.name.slice(0, 120) },
  });

  if (!object) return NextResponse.json({ error: "图片存储失败" }, { status: 500 });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO place_images (id, place_id, object_key, alt_text, sort_order)
         VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM place_images WHERE place_id = ?), 0))`,
      ).bind(imageId, placeId, key, file.name.slice(0, 160), placeId),
      env.DB.prepare(
        "INSERT INTO admin_audit_logs (id, action, place_id, detail) VALUES (?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), "media.upload", placeId, key),
    ]);
  } catch (error) {
    await env.MEDIA.delete(key);
    console.error("Failed to attach uploaded media", error);
    return NextResponse.json({ error: "图片关联失败，已回滚上传" }, { status: 500 });
  }

  return NextResponse.json({ imageUrl: `/media/${key}` }, { status: 201 });
}
