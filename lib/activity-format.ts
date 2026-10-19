import type { ActivityType, CityActivity } from "@/lib/community-types";

/**
 * 活动时间统一按武汉（Asia/Shanghai）显示。
 * 服务端渲染（Cloudflare Workers 运行在 UTC）与浏览器本地时区因此保持一致，
 * 不会出现同一个活动在活动页与地图上相差数小时的情况。
 */
const ACTIVITY_TIME_ZONE = "Asia/Shanghai";

export const activityTypeMeta: Record<ActivityType, { label: string; short: string }> = {
  ride: { label: "骑行", short: "骑" },
  walk: { label: "散步 / City Walk", short: "走" },
  sports: { label: "运动", short: "动" },
  food: { label: "吃喝", short: "食" },
  photo: { label: "拍照", short: "拍" },
  other: { label: "其他召集", short: "集" },
};

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: ACTIVITY_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function dateRangeLabel(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay = calendarDay(start) === calendarDay(end);
  const endLabel = new Intl.DateTimeFormat("zh-CN", sameDay
    ? { timeZone: ACTIVITY_TIME_ZONE, hour: "2-digit", minute: "2-digit" }
    : { timeZone: ACTIVITY_TIME_ZONE, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }
  ).format(end);
  return `${dateLabel(startsAt)} – ${endLabel}`;
}

function calendarDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ACTIVITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function activityStatusLabel(activity: CityActivity, currentTime: number) {
  if (activity.status === "cancelled") return "已取消";
  if (activity.status === "completed") return "已完成";
  if (new Date(activity.endsAt).getTime() <= currentTime) return "已结束";
  if (new Date(activity.startsAt).getTime() <= currentTime) return "进行中";
  if (activity.joinedCount >= activity.capacity) return "已满员";
  return "正在召集";
}
