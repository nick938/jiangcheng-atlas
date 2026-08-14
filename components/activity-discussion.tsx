"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ActivityComment, CityActivity, CommunityUser } from "@/lib/community-types";

type Props = {
  activity: CityActivity;
  user: CommunityUser | null;
  onRequireAuth: () => void;
  onNotice: (message: string) => void;
  onChanged: () => unknown;
};

export function ActivityDiscussion({ activity, user, onRequireAuth, onNotice, onChanged }: Props) {
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/comments`, { cache: "no-store" });
      const payload = await response.json() as { comments?: ActivityComment[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "留言加载失败");
      setComments(payload.comments ?? []);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "留言加载失败");
    } finally {
      setLoading(false);
    }
  }, [activity.id, onNotice]);

  useEffect(() => { void load(); }, [load]);

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { onRequireAuth(); return; }
    setBusy(true);
    const form = event.currentTarget;
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: new FormData(form).get("body") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "留言失败");
      form.reset();
      await Promise.all([load(), onChanged()]);
      onNotice("留言已发布。发起人会在消息中心看到提醒。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "留言失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(comment: ActivityComment) {
    if (!window.confirm("删除这条留言？")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/comments?comment=${encodeURIComponent(comment.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "删除失败");
      await Promise.all([load(), onChanged()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { onRequireAuth(); return; }
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "activity", targetId: activity.id, reason: form.get("reason"), details: form.get("details") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "举报提交失败");
      setReporting(false);
      onNotice("举报已提交，管理员会在治理后台处理。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "举报提交失败");
    } finally {
      setBusy(false);
    }
  }

  const mayComment = activity.isOwner || activity.joinedByMe;
  return (
    <section className="activity-discussion">
      <header><div><small>ACTIVITY BOARD</small><strong>活动留言</strong></div><span>{comments.length}</span></header>
      <div className="activity-comments">
        {loading && <p>正在读取留言…</p>}
        {!loading && comments.length === 0 && <p>还没有留言，参加后可以和发起人确认细节。</p>}
        {comments.map((comment) => (
          <article key={comment.id}>
            <i style={{ background: comment.author.avatarColor }}>{comment.author.displayName.slice(0, 1)}</i>
            <div><b>{comment.author.displayName}</b><time>{new Date(comment.createdAt).toLocaleString("zh-CN")}</time><p>{comment.body}</p></div>
            {comment.isOwner && <button type="button" disabled={busy} onClick={() => void deleteComment(comment)}>删除</button>}
          </article>
        ))}
      </div>
      {mayComment ? (
        <form className="activity-comment-form" onSubmit={submitComment}>
          <textarea name="body" maxLength={300} placeholder="确认集合细节、装备或临时安排……" required />
          <button type="submit" disabled={busy}>发布留言</button>
        </form>
      ) : <button type="button" className="activity-comment-gate" onClick={user ? undefined : onRequireAuth} disabled={Boolean(user)}>报名参加后可以留言</button>}
      <button type="button" className="activity-report-toggle" onClick={() => user ? setReporting((value) => !value) : onRequireAuth()}>举报这个活动</button>
      {reporting && <form className="activity-report-form" onSubmit={submitReport}>
        <select name="reason" defaultValue="unsafe"><option value="unsafe">存在安全风险</option><option value="spam">广告或刷屏</option><option value="harassment">骚扰或攻击</option><option value="false_info">虚假信息</option><option value="other">其他</option></select>
        <textarea name="details" maxLength={500} placeholder="补充具体情况（选填）" />
        <button type="submit" disabled={busy}>提交举报</button>
      </form>}
    </section>
  );
}
