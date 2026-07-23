PRAGMA defer_foreign_keys = true;

CREATE TABLE activities_next (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  route_id TEXT,
  activity_type TEXT NOT NULL DEFAULT 'other'
    CHECK (activity_type IN ('ride', 'walk', 'sports', 'food', 'photo', 'other')),
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  meeting_name TEXT NOT NULL,
  meeting_longitude REAL NOT NULL,
  meeting_latitude REAL NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 50),
  pace TEXT CHECK (pace IN ('relaxed', 'steady', 'sport')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (route_id) REFERENCES cycling_routes(id)
);

INSERT INTO activities_next
  (id, creator_id, route_id, activity_type, title, details, starts_at, meeting_name,
   meeting_longitude, meeting_latitude, capacity, pace, status, created_at, updated_at)
SELECT
  id, creator_id, route_id, 'ride', title, details, starts_at, meeting_name,
  meeting_longitude, meeting_latitude, capacity, pace, status, created_at, updated_at
FROM activities;

DROP TABLE activities;
ALTER TABLE activities_next RENAME TO activities;

CREATE INDEX idx_activities_status_time ON activities(status, starts_at);
CREATE INDEX idx_activities_route ON activities(route_id, starts_at);
CREATE INDEX idx_activities_type_time ON activities(activity_type, starts_at);
