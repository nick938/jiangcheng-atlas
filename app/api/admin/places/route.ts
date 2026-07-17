import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, mutationAllowed, requireAdmin } from "@/lib/admin-auth";
import { listAdminPlaces } from "@/lib/place-repository";
import { validatePlaceInput } from "@/lib/place-validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const places = await listAdminPlaces(env.DB);
  return NextResponse.json({ places }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const env = await requireAdmin(request);
  if (!env) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await mutationAllowed(env))) {
    return NextResponse.json({ error: "操作过于频繁" }, { status: 429 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 16_384) {
    return NextResponse.json({ error: "请求数据过大" }, { status: 413 });
  }

  const payload = await request.json().catch(() => null);
  const validation = validatePlaceInput(payload);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const id = crypto.randomUUID();
  const place = validation.data;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO places
          (id, slug, name, subtitle, description, longitude, latitude, district, address,
           category_id, featured, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ).bind(
        id, place.slug, place.name, place.subtitle, place.description,
        place.longitude, place.latitude, place.district, place.address,
        place.categoryId, place.featured ? 1 : 0, place.status,
      ),
      env.DB.prepare(
        "INSERT INTO admin_audit_logs (id, action, place_id, detail) VALUES (?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), "place.create", id, place.name),
    ]);
  } catch (error) {
    console.error("Failed to create place", error);
    return NextResponse.json({ error: "创建失败，Slug 可能已经存在" }, { status: 409 });
  }

  return NextResponse.json({ id }, { status: 201 });
}
