"use client";

import { useState, type FormEvent } from "react";
import type { CommunityUser } from "@/lib/community-types";

export function ProfilePanel({ user, onClose, onUpdated, onDeleted, onNotice }: {
  user: CommunityUser; onClose: () => void; onUpdated: (user: CommunityUser) => void;
  onDeleted: () => void; onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const displayName = new FormData(event.currentTarget).get("displayName");
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName }) });
      const payload = await response.json() as { user?: CommunityUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error ?? "保存失败");
      onUpdated(payload.user); onNotice("个人资料已更新。"); onClose();
    } catch (error) { onNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const confirmation = new FormData(event.currentTarget).get("confirmation");
      const response = await fetch("/api/profile", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "注销失败");
      onDeleted(); onNotice("账号已注销，历史活动会保留为匿名记录。");
    } catch (error) { onNotice(error instanceof Error ? error.message : "注销失败"); }
    finally { setBusy(false); }
  }
  return <section className="profile-panel" aria-label="个人资料">
    <header><div><small>PLAYER PROFILE</small><h2>个人资料</h2></div><button type="button" onClick={onClose}>×</button></header>
    <form onSubmit={save}><label>账号<input value={user.username} disabled /></label><label>显示昵称<input name="displayName" defaultValue={user.displayName} minLength={2} maxLength={24} required /></label><button type="submit" disabled={busy}>保存昵称</button></form>
    <div className="profile-danger"><h3>注销账号</h3><p>会退出所有设备并解除微信绑定；历史活动和留言会匿名保留。</p>{confirming ? <form onSubmit={remove}><input name="confirmation" placeholder="输入“注销”" required /><button type="submit" disabled={busy}>确认注销</button></form> : <button type="button" onClick={() => setConfirming(true)}>申请注销</button>}</div>
  </section>;
}
