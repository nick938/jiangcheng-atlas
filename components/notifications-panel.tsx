"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommunityNotification } from "@/lib/community-types";

export function NotificationsPanel({ onClose, onSelectActivity }: { onClose: () => void; onSelectActivity: (id: string) => void }) {
  const [notifications, setNotifications] = useState<CommunityNotification[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    const payload = await response.json() as { notifications?: CommunityNotification[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "消息加载失败");
    setNotifications(payload.notifications ?? []);
    if ((payload.notifications ?? []).some((item) => !item.readAt)) {
      await fetch("/api/notifications", { method: "PATCH" });
    }
  }, []);
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "消息加载失败")); }, [load]);
  return <section className="notifications-panel" aria-label="消息中心">
    <header><div><small>INBOX</small><h2>消息中心</h2></div><button type="button" onClick={onClose}>×</button></header>
    <div className="notifications-list">
      {error && <p>{error}</p>}
      {!error && notifications.length === 0 && <p>暂时没有新消息。</p>}
      {notifications.map((item) => <button type="button" key={item.id} className={!item.readAt ? "unread" : ""} onClick={() => item.activityId && onSelectActivity(item.activityId)}>
        <span><b>{item.title}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></span><p>{item.body}</p>
      </button>)}
    </div>
  </section>;
}
