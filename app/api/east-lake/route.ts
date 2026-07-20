import { NextResponse, type NextRequest } from "next/server";
import { listCyclingRoutes, listRideActivities } from "@/lib/community-repository";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { env, user } = await currentUser(request);
  const [routes, activities] = await Promise.all([listCyclingRoutes(env.DB), listRideActivities(env.DB, user)]);
  return NextResponse.json({ routes, activities, user }, { headers: { "Cache-Control": "no-store" } });
}
