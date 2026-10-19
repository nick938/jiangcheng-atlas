-- 帖子评论通知需要带上帖子 id，前端才能从消息中心跳转到 /post/<id>。
-- SQLite 的 ADD COLUMN 是纯元数据操作，不需要重建表（CHECK 约束不涉及新列）。
ALTER TABLE user_notifications ADD COLUMN post_id TEXT;

-- 去重冷却查询按 (user_id, type, 目标) 过滤最近记录；活动通知沿用 activity_id，
-- 帖子通知走 post_id。两个方向各建一个索引，避免通知表变大后全表扫。
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_activity
  ON user_notifications(user_id, type, activity_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_post
  ON user_notifications(user_id, type, post_id, created_at);
