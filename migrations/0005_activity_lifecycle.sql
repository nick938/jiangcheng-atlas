ALTER TABLE activities ADD COLUMN completed_at TEXT;
ALTER TABLE activities ADD COLUMN cancelled_at TEXT;

CREATE INDEX idx_activities_creator_time ON activities(creator_id, starts_at);
