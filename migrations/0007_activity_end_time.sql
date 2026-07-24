ALTER TABLE activities ADD COLUMN ends_at TEXT;

UPDATE activities
SET ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', datetime(starts_at, '+2 hours'))
WHERE ends_at IS NULL;

CREATE INDEX idx_activities_end_time ON activities(status, ends_at);
