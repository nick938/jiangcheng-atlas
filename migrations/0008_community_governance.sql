ALTER TABLE activities ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'visible'
  CHECK (moderation_status IN ('visible', 'hidden'));

CREATE TABLE activity_comments (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE community_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('activity', 'comment', 'user')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'unsafe', 'harassment', 'false_info', 'other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE TABLE user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  activity_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('activity_joined', 'activity_updated', 'activity_cancelled', 'new_comment', 'moderation')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX idx_activities_moderation_time ON activities(moderation_status, status, ends_at);
CREATE INDEX idx_activity_comments_activity ON activity_comments(activity_id, status, created_at);
CREATE INDEX idx_reports_status_time ON community_reports(status, created_at);
CREATE INDEX idx_notifications_user_read ON user_notifications(user_id, read_at, created_at);
