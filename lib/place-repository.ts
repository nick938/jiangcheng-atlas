import type { AdminPlace, CategoryId, Place, PlaceStatus } from "@/lib/places";

type PlaceRow = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  longitude: number;
  latitude: number;
  district: string;
  address: string;
  category_id: CategoryId;
  featured: number;
  status: PlaceStatus;
  image_url: string | null;
};

const PLACE_SELECT = `
  SELECT p.id, p.slug, p.name, p.subtitle, p.description, p.longitude, p.latitude,
    p.district, p.address, p.category_id, p.featured, p.status,
    (
      SELECT '/media/' || pi.object_key
      FROM place_images pi
      WHERE pi.place_id = p.id
      ORDER BY pi.sort_order ASC, pi.created_at DESC
      LIMIT 1
    ) AS image_url
  FROM places p`;

function mapPlace(row: PlaceRow): AdminPlace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    longitude: row.longitude,
    latitude: row.latitude,
    district: row.district,
    address: row.address,
    categoryId: row.category_id,
    featured: row.featured === 1,
    status: row.status,
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
  };
}

export async function listPublishedPlaces(db: D1Database): Promise<Place[]> {
  const result = await db.prepare(
    `${PLACE_SELECT}
     WHERE p.status = 'published'
     ORDER BY p.featured DESC, p.name ASC`,
  ).all<PlaceRow>();
  return result.results.map(mapPlace);
}

export async function listAdminPlaces(db: D1Database): Promise<AdminPlace[]> {
  const result = await db.prepare(
    `${PLACE_SELECT}
     WHERE p.status != 'archived'
     ORDER BY p.updated_at DESC, p.name ASC`,
  ).all<PlaceRow>();
  return result.results.map(mapPlace);
}
