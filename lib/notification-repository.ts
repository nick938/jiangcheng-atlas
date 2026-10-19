/**
 * 通知写入的唯一入口。
 *
 * 站内通知是「提醒」而不是「流水账」：同一个接收人在短时间内被同一目标反复触发
 * （连续评论、反复加入/退出、活动反复编辑）时，只保留冷却窗口内的第一条，
 * 否则消息中心会被刷屏。去重条件固定在数据库里做（INSERT ... SELECT ... WHERE NOT EXISTS），
 * 避免「先查后插」在并发请求下仍然写重。
 */

import type { CommunityNotification } from "@/lib/community-types";

export type NotificationType = CommunityNotification["type"];

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  activityId?: string | null;
  postId?: string | null;
  /** 冷却窗口（分钟）：窗口内同一 (接收人, 类型, 目标) 只写第一条。 */
  cooldownMinutes?: number;
};

export const DEFAULT_NOTIFICATION_COOLDOWN_MINUTES = 5;

/**
 * 构造「冷却窗口内去重」的通知插入语句，不直接执行。
 *
 * 需要和业务写入放进同一个 `db.batch` 时用这个（保证评论与通知同事务）；
 * 单独插入用 `insertNotificationIfNotRecent`。
 *
 * SQLite 的 `IS ?` 是 NULL 安全比较，因此 activity_id / post_id 为 NULL 时
 * 也能正确命中（普通 `=` 在 NULL 上永远为假，会退化成不去重）。
 */
export function notificationInsertStatement(db: D1Database, input: NotificationInput): D1PreparedStatement {
  const cooldownMinutes = Math.max(
    Math.floor(input.cooldownMinutes ?? DEFAULT_NOTIFICATION_COOLDOWN_MINUTES),
    0,
  );
  const activityId = input.activityId ?? null;
  const postId = input.postId ?? null;
  return db.prepare(
    `INSERT INTO user_notifications (id, user_id, activity_id, post_id, type, title, body)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM user_notifications
       WHERE user_id = ? AND type = ?
         AND activity_id IS ? AND post_id IS ?
         AND created_at > datetime('now', ?)
     )`,
  ).bind(
    crypto.randomUUID(),
    input.userId,
    activityId,
    postId,
    input.type,
    input.title,
    input.body,
    input.userId,
    input.type,
    activityId,
    postId,
    `-${cooldownMinutes} minutes`,
  );
}

/**
 * 写入一条通知；若冷却窗口内已有同 (接收人, 类型, 目标) 的通知则跳过。
 *
 * @returns 是否真的插入了新通知
 */
export async function insertNotificationIfNotRecent(
  db: D1Database,
  input: NotificationInput,
): Promise<boolean> {
  const result = await notificationInsertStatement(db, input).run();
  return Boolean(result.meta.changes);
}
