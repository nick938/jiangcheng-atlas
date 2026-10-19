-- OpenNext Cloudflare 的 D1 tag cache（NEXT_TAG_CACHE_D1）需要 revalidations 表，
-- 用于记录 revalidatePath/revalidateTag 的失效时间。建表 SQL 与
-- @opennextjs/cloudflare 的 populate-cache 命令保持一致。
CREATE TABLE IF NOT EXISTS revalidations (
  tag TEXT NOT NULL,
  revalidatedAt INTEGER NOT NULL DEFAULT 0,
  stale INTEGER,
  expire INTEGER DEFAULT NULL,
  UNIQUE(tag) ON CONFLICT REPLACE
);
