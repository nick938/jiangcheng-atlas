import { getCloudflareContext } from "@opennextjs/cloudflare";
import { seedPlaces, type CategoryId, type Place } from "@/lib/places";

export const dynamic = "force-dynamic";

type D1PlaceRow = {
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
};

function toPlace(row: D1PlaceRow): Place {
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
  };
}

export async function GET() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const result = await env.DB.prepare(
      `SELECT id, slug, name, subtitle, description, longitude, latitude,
        district, address, category_id, featured
       FROM places
       WHERE status = 'published'
       ORDER BY featured DESC, name ASC`,
    ).all<D1PlaceRow>();

    return Response.json(
      { places: result.results.map(toPlace), source: "d1" },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
    );
  } catch (error) {
    console.warn("D1 is not ready; serving bundled seed places.", error);
    return Response.json(
      { places: seedPlaces, source: "seed" },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  }
}
