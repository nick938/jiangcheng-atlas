import { categoryMeta, type CategoryId, type PlaceStatus } from "@/lib/places";

export type PlaceInput = {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  longitude: number;
  latitude: number;
  district: string;
  address: string;
  categoryId: CategoryId;
  featured: boolean;
  status: Exclude<PlaceStatus, "archived">;
};

type ValidationResult =
  | { ok: true; data: PlaceInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export function validatePlaceInput(value: unknown): ValidationResult {
  if (!isRecord(value)) return { ok: false, error: "地点数据格式不正确" };

  const slug = text(value.slug, 80);
  const name = text(value.name, 80);
  const subtitle = text(value.subtitle, 120);
  const description = text(value.description, 1200);
  const district = text(value.district, 40);
  const address = text(value.address, 160);
  const longitude = typeof value.longitude === "number" ? value.longitude : Number(value.longitude);
  const latitude = typeof value.latitude === "number" ? value.latitude : Number(value.latitude);
  const categoryId = value.categoryId;
  const status = value.status;

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: "Slug 只能使用小写字母、数字和连字符" };
  }
  if (!name || !subtitle || !description || !district || !address) {
    return { ok: false, error: "请完整填写地点名称、简介、描述、行政区和地址" };
  }
  if (!Number.isFinite(longitude) || longitude < 113 || longitude > 116) {
    return { ok: false, error: "经度应位于武汉周边的 113–116 范围" };
  }
  if (!Number.isFinite(latitude) || latitude < 29 || latitude > 32) {
    return { ok: false, error: "纬度应位于武汉周边的 29–32 范围" };
  }
  if (typeof categoryId !== "string" || categoryId === "all" || !(categoryId in categoryMeta)) {
    return { ok: false, error: "地点分类无效" };
  }
  if (status !== "draft" && status !== "published") {
    return { ok: false, error: "发布状态无效" };
  }

  return {
    ok: true,
    data: {
      slug,
      name,
      subtitle,
      description,
      longitude,
      latitude,
      district,
      address,
      categoryId: categoryId as CategoryId,
      featured: value.featured === true,
      status,
    },
  };
}
