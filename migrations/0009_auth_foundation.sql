ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE TABLE oauth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('wechat')),
  provider_user_id TEXT NOT NULL,
  union_id TEXT,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_oauth_wechat_union_id
  ON oauth_identities(provider, union_id)
  WHERE union_id IS NOT NULL;
