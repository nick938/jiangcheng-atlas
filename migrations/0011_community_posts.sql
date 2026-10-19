PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'chat',
  image_key TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- published | hidden
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_status_time ON community_posts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author_time ON community_posts(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_topic_time ON community_posts(topic, status, created_at);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published', -- published | hidden
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments(user_id, created_at);

-- 帖子/评论接入举报与通知后，0008 里 community_reports.target_type 和
-- user_notifications.type 的 CHECK 取值需要扩容（SQLite 只能重建表）。
PRAGMA defer_foreign_keys = true;

CREATE TABLE community_reports_next (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('activity', 'comment', 'user', 'post', 'post_comment')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'unsafe', 'harassment', 'false_info', 'other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (reporter_id, target_type, target_id)
);
INSERT INTO community_reports_next
  (id, reporter_id, target_type, target_id, reason, details, status, handled_at, created_at)
SELECT id, reporter_id, target_type, target_id, reason, details, status, handled_at, created_at
FROM community_reports;
DROP TABLE community_reports;
ALTER TABLE community_reports_next RENAME TO community_reports;
CREATE INDEX IF NOT EXISTS idx_reports_status_time ON community_reports(status, created_at);

CREATE TABLE user_notifications_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  activity_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('activity_joined', 'activity_updated', 'activity_cancelled', 'new_comment', 'moderation', 'post_comment')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
INSERT INTO user_notifications_next
  (id, user_id, activity_id, type, title, body, read_at, created_at)
SELECT id, user_id, activity_id, type, title, body, read_at, created_at
FROM user_notifications;
DROP TABLE user_notifications;
ALTER TABLE user_notifications_next RENAME TO user_notifications;
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON user_notifications(user_id, read_at, created_at);
