import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { buildActivityCalendar, calendarContentDisposition } from "@/lib/calendar";
import { findActivityById } from "@/lib/community-repository";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/api/activities/[id]/calendar">) {
  const { id } = await context.params;
  const { env } = await getCloudflareContext({ async: true });
  const activity = await findActivityById(env.DB, id, null);
  if (!activity) return NextResponse.json({ error: "活动不存在或已下架" }, { status: 404 });

  return new Response(buildActivityCalendar(activity, { origin: SITE_URL }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": calendarContentDisposition(activity.title, activity.id),
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
