import { getCloudflareContext } from "@opennextjs/cloudflare";
import { seedPlaces, withDefaultPlaceMedia } from "@/lib/places";
import { listPublishedPlaces } from "@/lib/place-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const places = (await listPublishedPlaces(env.DB)).map(withDefaultPlaceMedia);

    return Response.json(
      { places, source: "d1" },
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
