import { activityTypeMeta } from "@/lib/activity-format";
import type { CityActivity } from "@/lib/community-types";
import { SITE_URL, activityUrl } from "@/lib/site";

const PRODUCT_ID = "-//Jiangcheng Atlas//City Activities//CN";
const DEFAULT_DURATION_MS = 2 * 60 * 60_000;

export type CalendarBuildOptions = {
  origin?: string;
  now?: Date;
};

export function escapeCalendarText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utcStamp(date: Date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** RFC 5545 折行：每行不超过 75 个八位组，续行以空格开头，且不切断多字节字符。 */
export function foldCalendarLine(line: string, limit = 75) {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      chunks.push(current);
      current = char;
      bytes = size + 1;
      continue;
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

export function calendarFileName(activityId: string) {
  const safe = activityId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  return `jiangcheng-atlas-${safe || "activity"}.ics`;
}

export function calendarContentDisposition(title: string, activityId: string) {
  const asciiName = calendarFileName(activityId);
  // 按码点截断，避免把 emoji 的代理对切成孤立代理导致 encodeURIComponent 抛错。
  const shortTitle = Array.from(title).slice(0, 60).join("");
  let encodedName: string;
  try {
    encodedName = encodeURIComponent(`${shortTitle}.ics`)
      .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    encodedName = asciiName;
  }
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

function originHost(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return new URL(SITE_URL).host;
  }
}

export function buildActivityCalendar(activity: CityActivity, options: CalendarBuildOptions = {}) {
  const origin = (options.origin ?? SITE_URL).replace(/\/+$/, "");
  const now = options.now ?? new Date();
  const start = new Date(activity.startsAt);
  const rawEnd = new Date(activity.endsAt);
  const end = rawEnd.getTime() > start.getTime() ? rawEnd : new Date(start.getTime() + DEFAULT_DURATION_MS);
  const url = `${origin}${activityUrl(activity.id)}`;
  const cancelled = activity.status === "cancelled";
  const summary = cancelled ? `[已取消] ${activity.title}` : activity.title;
  const description = [
    activity.details,
    `类型：${activityTypeMeta[activity.activityType].label}`,
    `队伍：${activity.joinedCount} / ${activity.capacity} 人`,
    `发起人：${activity.creator.displayName}`,
    `活动页：${url}`,
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${activity.id}@${originHost(origin)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeCalendarText(summary)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    `LOCATION:${escapeCalendarText(`${activity.meetingName}（武汉市）`)}`,
    `GEO:${activity.meetingLatitude.toFixed(6)};${activity.meetingLongitude.toFixed(6)}`,
    `URL:${url}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map((line) => foldCalendarLine(line)).join("\r\n")}\r\n`;
}
