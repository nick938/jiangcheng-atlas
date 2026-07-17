import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, mutationAllowed, requireAdmin } from "@/lib/admin-auth";
import { validatePlaceInput } from "@/lib/place-validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/admin/places/[id]">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await mutationAllowed(env))) {
    return NextResponse.json({ error: "操作过于频繁" }, { status: 429 });
  }

  const { id } = await context.params;
  if (!id || id.length > 100) return NextResponse.json({ error: "地点 ID 无效" }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 16_384) {
    return NextResponse.json({ error: "请求数据过大" }, { status: 413 });
  }

  const payload = await request.json().catch(() => null);
  const validation = validatePlaceInput(payload);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const place = validation.data;

  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE places SET slug = ?, name = ?, subtitle = ?, description = ?, longitude = ?,
          latitude = ?, district = ?, address = ?, category_id = ?, featured = ?, status = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'archived'`,
      ).bind(
        place.slug, place.name, place.subtitle, place.description, place.longitude, place.latitude,
        place.district, place.address, place.categoryId, place.featured ? 1 : 0, place.status, id,
      ),
      env.DB.prepare(
        "INSERT INTO admin_audit_logs (id, action, place_id, detail) VALUES (?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), "place.update", id, place.name),
    ]);
    if ((results[0].meta.changes ?? 0) === 0) {
      return NextResponse.json({ error: "地点不存在" }, { status: 404 });
    }
  } catch (error) {
    console.error("Failed to update place", error);
    return NextResponse.json({ error: "保存失败，Slug 可能已经存在" }, { status: 409 });
  }

  return NextResponse.json({ id });
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/admin/places/[id]">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await mutationAllowed(env))) {
    return NextResponse.json({ error: "操作过于频繁" }, { status: 429 });
  }

  const { id } = await context.params;
  if (!id || id.length > 100) return NextResponse.json({ error: "地点 ID 无效" }, { status: 400 });
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE places SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'archived'",
    ).bind(id),
    env.DB.prepare(
      "INSERT INTO admin_audit_logs (id, action, place_id) VALUES (?, ?, ?)",
    ).bind(crypto.randomUUID(), "place.archive", id),
  ]);

  if ((results[0].meta.changes ?? 0) === 0) {
    return NextResponse.json({ error: "地点不存在" }, { status: 404 });
  }
  return NextResponse.json({ archived: true });
}
