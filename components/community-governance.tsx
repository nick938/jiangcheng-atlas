"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin-console.module.css";

type AdminUser = {
  id: string; username: string; display_name: string; status: "active" | "suspended";
  created_at: string; activity_count: number; report_count: number;
};
type AdminActivity = {
  id: string; title: string; status: string; moderation_status: "visible" | "hidden";
  starts_at: string; ends_at: string; created_at: string; creator_name: string;
  member_count: number; open_reports: number;
};
type AdminReport = {
  id: string; target_type: "activity" | "comment" | "user"; target_id: string;
  reason: string; details: string; status: "open" | "resolved" | "dismissed";
  created_at: string; reporter_name: string; target_label: string;
};
type Snapshot = { users: AdminUser[]; activities: AdminActivity[]; reports: AdminReport[]; error?: string };

const reasonLabels: Record<string, string> = {
  spam: "广告或刷屏", unsafe: "存在安全风险", harassment: "骚扰或攻击", false_info: "虚假信息", other: "其他",
};

export function CommunityGovernance({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ users: [], activities: [], reports: [] });
  const [tab, setTab] = useState<"reports" | "activities" | "users">("reports");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/community", { cache: "no-store" });
    if (response.status === 401) {
      onUnauthorized();
      return;
    }
    const payload = await response.json() as Snapshot;
    if (!response.ok) throw new Error(payload.error ?? "社区数据加载失败");
    setSnapshot(payload);
  }, [onUnauthorized]);

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "社区数据加载失败"));
  }, [load]);

  async function mutate(targetId: string, action: string, confirmation: string) {
    if (!window.confirm(confirmation)) return;
    setBusyId(targetId);
    setError("");
    try {
      const response = await fetch("/api/admin/community", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId, action }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "操作失败");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusyId("");
    }
  }

  const openReports = useMemo(() => snapshot.reports.filter((report) => report.status === "open").length, [snapshot.reports]);

  return (
    <section className={styles.governance}>
      <div className={styles.governanceHeading}>
        <div><p className={styles.eyebrow}>COMMUNITY SAFETY</p><h2>社区治理</h2><span>审核举报、活动与账号状态，所有操作写入审计日志。</span></div>
        <button type="button" onClick={() => void load()} disabled={Boolean(busyId)}>刷新数据</button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <nav className={styles.governanceTabs} aria-label="社区治理分类">
        <button type="button" className={tab === "reports" ? styles.active : ""} onClick={() => setTab("reports")}>待处理举报 <em>{openReports}</em></button>
        <button type="button" className={tab === "activities" ? styles.active : ""} onClick={() => setTab("activities")}>活动 <em>{snapshot.activities.length}</em></button>
        <button type="button" className={tab === "users" ? styles.active : ""} onClick={() => setTab("users")}>用户 <em>{snapshot.users.length}</em></button>
      </nav>

      <div className={styles.governanceList}>
        {tab === "reports" && snapshot.reports.map((report) => (
          <article key={report.id}>
            <div className={styles.governanceMeta}><b>{reasonLabels[report.reason] ?? report.reason}</b><span>{report.target_type} · {new Date(report.created_at).toLocaleString("zh-CN")}</span><em data-status={report.status}>{report.status === "open" ? "待处理" : report.status === "resolved" ? "已处理" : "已驳回"}</em></div>
            <h3>{report.target_label}</h3>
            <p>{report.details || "举报人未补充说明。"}</p>
            <small>举报人：{report.reporter_name}</small>
            {report.status === "open" && <div className={styles.governanceActions}>
              {report.target_type === "activity" && <button type="button" disabled={busyId === report.id} onClick={() => void mutate(report.target_id, "activity.hide", "确认先下架该活动？")}>下架活动</button>}
              {report.target_type === "comment" && <button type="button" disabled={busyId === report.id} onClick={() => void mutate(report.target_id, "comment.hide", "确认隐藏该留言？")}>隐藏留言</button>}
              {report.target_type === "user" && <button type="button" disabled={busyId === report.id} onClick={() => void mutate(report.target_id, "user.suspend", "确认停用该账号并清除其登录会话？")}>停用账号</button>}
              <button type="button" disabled={busyId === report.id} onClick={() => void mutate(report.id, "report.resolve", "确认将举报标记为已处理？")}>标记已处理</button>
              <button type="button" className={styles.subtle} disabled={busyId === report.id} onClick={() => void mutate(report.id, "report.dismiss", "确认驳回这条举报？")}>驳回</button>
            </div>}
          </article>
        ))}
        {tab === "activities" && snapshot.activities.map((activity) => (
          <article key={activity.id}>
            <div className={styles.governanceMeta}><b>{activity.status}</b><span>{new Date(activity.starts_at).toLocaleString("zh-CN")}</span><em data-status={activity.moderation_status}>{activity.moderation_status === "visible" ? "公开" : "已下架"}</em></div>
            <h3>{activity.title}</h3><p>发起人：{activity.creator_name} · {activity.member_count} 人参加 · {activity.open_reports} 条待处理举报</p>
            <div className={styles.governanceActions}>
              <button type="button" disabled={busyId === activity.id} onClick={() => void mutate(activity.id, activity.moderation_status === "visible" ? "activity.hide" : "activity.show", activity.moderation_status === "visible" ? "确认下架该活动？" : "确认恢复公开该活动？")}>{activity.moderation_status === "visible" ? "下架" : "恢复公开"}</button>
            </div>
          </article>
        ))}
        {tab === "users" && snapshot.users.map((user) => (
          <article key={user.id}>
            <div className={styles.governanceMeta}><b>@{user.username}</b><span>{new Date(user.created_at).toLocaleDateString("zh-CN")} 注册</span><em data-status={user.status}>{user.status === "active" ? "正常" : "已停用"}</em></div>
            <h3>{user.display_name}</h3><p>{user.activity_count} 个活动 · {user.report_count} 次举报记录</p>
            <div className={styles.governanceActions}>
              <button type="button" disabled={busyId === user.id} onClick={() => void mutate(user.id, user.status === "active" ? "user.suspend" : "user.activate", user.status === "active" ? "确认停用该账号并清除其登录会话？" : "确认恢复该账号？")}>{user.status === "active" ? "停用账号" : "恢复账号"}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
