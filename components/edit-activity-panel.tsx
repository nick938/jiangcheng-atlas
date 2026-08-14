"use client";

import { useState, type FormEvent } from "react";
import type { ActivityType, CityActivity } from "@/lib/community-types";

const typeLabels: Record<ActivityType, string> = { ride: "骑行", walk: "散步 / City Walk", sports: "运动", food: "吃喝", photo: "拍照", other: "其他召集" };
function localDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function formString(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function EditActivityPanel({ activity, onClose, onSaved, onNotice }: { activity: CityActivity; onClose: () => void; onSaved: () => void | Promise<void>; onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = new Date(formString(form, "startsAt"));
    const end = new Date(formString(form, "endsAt"));
    setBusy(true);
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType: form.get("activityType"), title: form.get("title"), details: form.get("details"),
          startsAt: start.toISOString(), endsAt: end.toISOString(), meetingName: form.get("meetingName"),
          meetingLongitude: activity.meetingLongitude, meetingLatitude: activity.meetingLatitude, capacity: Number(form.get("capacity")),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "活动更新失败");
      await onSaved();
      onClose();
      onNotice("活动已更新，参加者会在消息中心收到提醒。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "活动更新失败");
    } finally { setBusy(false); }
  }
  return <section className="edit-activity-panel" aria-label="编辑活动">
    <header><div><small>EDIT EVENT</small><h2>编辑活动</h2></div><button type="button" onClick={onClose}>×</button></header>
    <form onSubmit={submit}>
      <div className="create-form-row"><label>活动类型<select name="activityType" defaultValue={activity.activityType}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>人数上限<input name="capacity" type="number" min={activity.joinedCount} max={50} defaultValue={activity.capacity} /></label></div>
      <label>标题<input name="title" minLength={4} maxLength={48} defaultValue={activity.title} required /></label>
      <div className="create-form-row"><label>开始时间<input name="startsAt" type="datetime-local" defaultValue={localDateTime(activity.startsAt)} required /></label><label>结束时间<input name="endsAt" type="datetime-local" defaultValue={localDateTime(activity.endsAt)} required /></label></div>
      <label>集合地点<input name="meetingName" minLength={2} maxLength={80} defaultValue={activity.meetingName} required /></label>
      <label>活动详情<textarea name="details" minLength={10} maxLength={600} defaultValue={activity.details} required /></label>
      <small>地图集合点保持不变；需要改集合坐标时，可取消后重新发布。</small>
      <button type="submit" disabled={busy}>{busy ? "正在保存…" : "保存并通知参加者"}</button>
    </form>
  </section>;
}
