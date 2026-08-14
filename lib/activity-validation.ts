import type { ActivityType } from "@/lib/community-types";

const activityTypes = new Set<ActivityType>(["ride", "walk", "sports", "food", "photo", "other"]);

export type ActivityInput = {
  title: string;
  details: string;
  activityType: ActivityType;
  startsAt: string;
  endsAt: string;
  meetingName: string;
  meetingLongitude: number;
  meetingLatitude: number;
  capacity: number;
};

export function validateActivityInput(payload: Record<string, unknown> | null, now = Date.now()):
  | { ok: true; data: ActivityInput }
  | { ok: false; error: string } {
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const details = typeof payload?.details === "string" ? payload.details.trim() : "";
  const activityType = typeof payload?.activityType === "string" ? payload.activityType as ActivityType : "other";
  const startsAt = typeof payload?.startsAt === "string" ? payload.startsAt : "";
  const endsAt = typeof payload?.endsAt === "string" ? payload.endsAt : "";
  const meetingName = typeof payload?.meetingName === "string" ? payload.meetingName.trim() : "";
  const meetingLongitude = Number(payload?.meetingLongitude);
  const meetingLatitude = Number(payload?.meetingLatitude);
  const capacity = Number(payload?.capacity);
  const startTime = new Date(startsAt).getTime();
  const endTime = new Date(endsAt).getTime();
  const validLocation = Number.isFinite(meetingLongitude) && meetingLongitude >= 113.9 && meetingLongitude <= 114.8
    && Number.isFinite(meetingLatitude) && meetingLatitude >= 30.2 && meetingLatitude <= 30.9;
  if (title.length < 4 || title.length > 48 || details.length < 10 || details.length > 600
    || meetingName.length < 2 || meetingName.length > 80 || !Number.isInteger(capacity)
    || capacity < 2 || capacity > 50 || !activityTypes.has(activityType) || !validLocation
    || !Number.isFinite(startTime) || !Number.isFinite(endTime)
    || startTime < now + 30 * 60_000 || startTime > now + 90 * 86400_000
    || endTime < startTime + 15 * 60_000 || endTime > startTime + 7 * 86400_000) {
    return { ok: false, error: "请检查类型、标题、说明、时间、人数和地图位置" };
  }
  return {
    ok: true,
    data: {
      title, details, activityType,
      startsAt: new Date(startTime).toISOString(),
      endsAt: new Date(endTime).toISOString(),
      meetingName, meetingLongitude, meetingLatitude, capacity,
    },
  };
}
