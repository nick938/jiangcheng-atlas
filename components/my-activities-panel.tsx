"use client";

import { useMemo, useState } from "react";
import type { ActivityType, CityActivity, CommunityUser } from "@/lib/community-types";

const activityLabels: Record<ActivityType, string> = {
  ride: "骑行",
  walk: "散步",
  sports: "运动",
  food: "吃喝",
  photo: "拍照",
  other: "其他",
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isCurrent(activity: CityActivity, currentTime: number) {
  return activity.status === "open" && new Date(activity.startsAt).getTime() > currentTime;
}

function statusLabel(activity: CityActivity, currentTime: number) {
  if (activity.status === "cancelled") return "已取消";
  if (activity.status === "completed") return "已完成";
  if (new Date(activity.startsAt).getTime() <= currentTime) return "已结束";
  if (activity.joinedCount >= activity.capacity) return "已满员";
  return "进行中";
}

type MyActivitiesPanelProps = {
  user: CommunityUser;
  activities: CityActivity[];
  busy: boolean;
  onClose: () => void;
  onSelect: (activity: CityActivity) => void;
  onComplete: (activity: CityActivity) => void;
  onCancel: (activity: CityActivity) => void;
};

export function MyActivitiesPanel({
  user,
  activities,
  busy,
  onClose,
  onSelect,
  onComplete,
  onCancel,
}: MyActivitiesPanelProps) {
  const [currentTime] = useState(() => Date.now());
  const [tab, setTab] = useState<"current" | "history">("current");
  const current = useMemo(
    () => activities.filter((activity) => isCurrent(activity, currentTime)),
    [activities, currentTime],
  );
  const history = useMemo(
    () => activities.filter((activity) => !isCurrent(activity, currentTime)),
    [activities, currentTime],
  );
  const visible = tab === "current" ? current : history;

  return (
    <section className="my-activities-panel" aria-label="我的差事">
      <header>
        <div className="my-activities-identity">
          <i style={{ background: user.avatarColor }}>{user.displayName.slice(0, 1)}</i>
          <span><small>MY EVENTS</small><h2>{user.displayName}的差事</h2></span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭我的差事">×</button>
      </header>

      <nav aria-label="差事记录分类">
        <button type="button" className={tab === "current" ? "active" : ""} onClick={() => setTab("current")}>
          进行中 <em>{current.length}</em>
        </button>
        <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          历史记录 <em>{history.length}</em>
        </button>
      </nav>

      <div className="my-activities-list">
        {visible.length === 0 && (
          <div className="my-activities-empty">
            <b>{tab === "current" ? "暂时没有进行中的差事" : "还没有历史记录"}</b>
            <span>{tab === "current" ? "去地图上发起或参加一件事吧。" : "完成、取消或已经结束的差事会留在这里。"}</span>
          </div>
        )}
        {visible.map((activity) => (
          <article key={activity.id}>
            <button type="button" className="my-activity-main" onClick={() => onSelect(activity)}>
              <span className="my-activity-meta">
                <i>{activityLabels[activity.activityType]}</i>
                <em className={`status-${activity.status}`}>{statusLabel(activity, currentTime)}</em>
                <small>{activity.isOwner ? "我发起的" : "我参加的"}</small>
              </span>
              <strong>{activity.title}</strong>
              <span className="my-activity-facts">
                <small>{dateLabel(activity.startsAt)}</small>
                <small>{activity.meetingName}</small>
                <small>{activity.joinedCount}/{activity.capacity} 人</small>
              </span>
            </button>
            {tab === "current" && activity.isOwner && (
              <div className="my-activity-actions">
                <button type="button" disabled={busy} onClick={() => onComplete(activity)}>标记完成</button>
                <button type="button" className="danger" disabled={busy} onClick={() => onCancel(activity)}>取消差事</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
