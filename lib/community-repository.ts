import type { ActivityType, CityActivity, CommunityUser, CyclingRoute } from "@/lib/community-types";

type RouteRow = {
  id: string; slug: string; name: string; subtitle: string; description: string;
  distance_km: number; duration_minutes: number; difficulty: CyclingRoute["difficulty"];
  color: string; start_name: string; start_longitude: number; start_latitude: number;
  geometry_json: string; highlights_json: string; tips_json: string;
};

function jsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}

export async function listCyclingRoutes(db: D1Database): Promise<CyclingRoute[]> {
  const rows = await db.prepare(
    `SELECT id, slug, name, subtitle, description, distance_km, duration_minutes, difficulty,
      color, start_name, start_longitude, start_latitude, geometry_json, highlights_json, tips_json
     FROM cycling_routes WHERE status = 'published' ORDER BY sort_order, name`,
  ).all<RouteRow>();
  return rows.results.map((row) => ({
    id: row.id, slug: row.slug, name: row.name, subtitle: row.subtitle, description: row.description,
    distanceKm: row.distance_km, durationMinutes: row.duration_minutes, difficulty: row.difficulty,
    color: row.color, startName: row.start_name, startLongitude: row.start_longitude,
    startLatitude: row.start_latitude, geometry: jsonArray<[number, number]>(row.geometry_json),
    highlights: jsonArray<string>(row.highlights_json), tips: jsonArray<string>(row.tips_json),
  }));
}

type ActivityRow = {
  id: string; activity_type: ActivityType; route_id: string | null; route_name: string | null;
  route_color: string | null; title: string; details: string;
  starts_at: string; meeting_name: string; meeting_longitude: number; meeting_latitude: number;
  capacity: number; pace: CityActivity["pace"]; status: CityActivity["status"];
  creator_id: string; username: string; display_name: string; avatar_color: string;
  joined_count: number; joined_by_me: number;
};

export async function listActivities(db: D1Database, user: CommunityUser | null): Promise<CityActivity[]> {
  const rows = await db.prepare(
    `SELECT a.id, a.activity_type, a.route_id, r.name AS route_name, r.color AS route_color, a.title, a.details,
      a.starts_at, a.meeting_name, a.meeting_longitude, a.meeting_latitude, a.capacity, a.pace, a.status,
      u.id AS creator_id, u.username, u.display_name, u.avatar_color,
      (SELECT COUNT(*) FROM activity_members m WHERE m.activity_id = a.id) AS joined_count,
      (SELECT COUNT(*) FROM activity_members m WHERE m.activity_id = a.id AND m.user_id = ?) AS joined_by_me
     FROM activities a JOIN users u ON u.id = a.creator_id LEFT JOIN cycling_routes r ON r.id = a.route_id
     WHERE a.starts_at > datetime('now', '-12 hours') ORDER BY a.starts_at ASC LIMIT 50`,
  ).bind(user?.id ?? "").all<ActivityRow>();
  return rows.results.map((row) => ({
    id: row.id, activityType: row.activity_type, routeId: row.route_id,
    routeName: row.route_name, routeColor: row.route_color,
    title: row.title, details: row.details, startsAt: row.starts_at, meetingName: row.meeting_name,
    meetingLongitude: row.meeting_longitude, meetingLatitude: row.meeting_latitude,
    capacity: row.capacity, pace: row.pace, status: row.status,
    creator: { id: row.creator_id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color },
    joinedCount: Number(row.joined_count), joinedByMe: Number(row.joined_by_me) > 0, isOwner: user?.id === row.creator_id,
  }));
}
