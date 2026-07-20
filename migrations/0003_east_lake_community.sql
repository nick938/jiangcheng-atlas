PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cycling_routes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  description TEXT NOT NULL,
  distance_km REAL NOT NULL,
  duration_minutes INTEGER NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  color TEXT NOT NULL,
  start_name TEXT NOT NULL,
  start_longitude REAL NOT NULL,
  start_latitude REAL NOT NULL,
  geometry_json TEXT NOT NULL,
  highlights_json TEXT NOT NULL,
  tips_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  meeting_name TEXT NOT NULL,
  meeting_longitude REAL NOT NULL,
  meeting_latitude REAL NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 30),
  pace TEXT NOT NULL CHECK (pace IN ('relaxed', 'steady', 'sport')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (route_id) REFERENCES cycling_routes(id)
);

CREATE TABLE IF NOT EXISTS activity_members (
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id, user_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expiry ON user_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_activities_status_time ON activities(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_activities_route ON activities(route_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_activity_members_user ON activity_members(user_id, joined_at);

INSERT OR IGNORE INTO cycling_routes
  (id, slug, name, subtitle, description, distance_km, duration_minutes, difficulty, color,
   start_name, start_longitude, start_latitude, geometry_json, highlights_json, tips_json, sort_order)
VALUES
  (
    'route-lake-center', 'lake-center-classic', '湖中道经典线', '第一次骑东湖，就从湖光与杉林开始',
    '从梨园广场进入湖中道，经过湖光序曲、九女墩与磨山北门。路程适中、补给方便，适合新手和轻松骑。',
    13.6, 75, 'easy', '#d8ff3e', '梨园广场', 114.3782, 30.5866,
    '[[114.3782,30.5866],[114.3852,30.5809],[114.3918,30.5747],[114.3978,30.5688],[114.4058,30.5632],[114.4143,30.5581],[114.4206,30.5538],[114.4143,30.5581],[114.4048,30.5659],[114.3942,30.5741],[114.3848,30.5821],[114.3782,30.5866]]',
    '["湖光序曲","长堤杉影","九女墩","磨山北门"]',
    '["周末湖中道人多，建议早上 8 点前出发","共享单车以现场运营情况为准","线路为探索示意，请以绿道标识为准"]',
    10
  ),
  (
    'route-white-horse', 'white-horse-loop', '白马洲轻野环线', '人少、开阔，适合稳定巡航',
    '以白马洲头为起终点，串联白马道与生态运动公园一带。视野开阔、骑行节奏连续，适合有基础的骑友。',
    18.2, 100, 'medium', '#53d9ff', '白马洲头', 114.4471, 30.6080,
    '[[114.4471,30.608],[114.4384,30.6132],[114.4278,30.6138],[114.419,30.6078],[114.4152,30.5988],[114.4214,30.5905],[114.4337,30.5888],[114.4449,30.5948],[114.4512,30.6022],[114.4471,30.608]]',
    '["白马洲头","银河桥","生态运动公园","白马道湖湾"]',
    '["白马道、郊野道更适合连续骑行","绿道骑行请控制在现场规定速度内","集体骑行应关注景区最新报备要求"]',
    20
  ),
  (
    'route-wild-east', 'wild-east-challenge', '郊野道进阶线', '从落霞归雁骑进东湖深处',
    '从落霞归雁出发，沿郊野道串联湖湾、湿地和磨山方向。距离较长，返程前要确认体力、天气与补给。',
    31.8, 175, 'hard', '#ff6b4a', '落霞归雁驿站', 114.4737, 30.5748,
    '[[114.4737,30.5748],[114.463,30.5689],[114.4502,30.5662],[114.4398,30.559],[114.4296,30.5528],[114.4183,30.5502],[114.4073,30.5538],[114.4168,30.5628],[114.4304,30.5708],[114.4438,30.5784],[114.4569,30.5831],[114.4678,30.5812],[114.4737,30.5748]]',
    '["落霞归雁","郊野湿地","磨山林缘","东湖远眺点"]',
    '["至少携带一瓶水和基础补胎工具","高温、雷雨和大风天气不建议挑战","这不是专业导航轨迹，请勿脱离开放绿道"]',
    30
  );
