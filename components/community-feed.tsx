"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dateLabel } from "@/lib/activity-format";
import type { CommunityUser } from "@/lib/community-types";
import { POST_TOPICS, POST_TOPIC_LABELS, type PostSummary, type PostTopic } from "@/lib/post-types";
import { CommunityAuthModal } from "./community-auth-modal";
import { PostComposer } from "./post-composer";
import styles from "./community.module.css";

type Props = {
  initialPosts: PostSummary[];
  initialCursor: string | null;
  topic: PostTopic | null;
  user: CommunityUser | null;
  /** D1 暂时不可用时的提示文案 */
  unavailable?: string;
};

export function CommunityFeed({ initialPosts, initialCursor, topic, user, unavailable }: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState<PostSummary[]>(initialPosts);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [viewer, setViewer] = useState<CommunityUser | null>(user);
  const [composerOpen, setComposerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setPosts(initialPosts); }, [initialPosts]);
  useEffect(() => { setCursor(initialCursor); }, [initialCursor]);
  useEffect(() => { setViewer(user); }, [user]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (topic) params.set("topic", topic);
      params.set("cursor", cursor);
      const response = await fetch(`/api/posts?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { posts?: PostSummary[]; nextCursor?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "加载失败");
      const known = new Set(posts.map((post) => post.id));
      setPosts((current) => [...current, ...(payload.posts ?? []).filter((post) => !known.has(post.id))]);
      setCursor(payload.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  function startComposing() {
    if (viewer) {
      setComposerOpen(true);
      return;
    }
    setAuthOpen(true);
  }

  return (
    <div className={styles.body}>
      {unavailable && <p className={styles.notice}>{unavailable}</p>}
      {error && <p className={styles.notice} role="alert">{error}</p>}

      <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 18 }}>
        <nav className={styles.topics} aria-label="帖子话题筛选">
          <Link className={`${styles.topic} ${topic === null ? styles.topicActive : ""}`} href="/community">全部</Link>
          {POST_TOPICS.map((item) => (
            <Link
              key={item}
              className={`${styles.topic} ${topic === item ? styles.topicActive : ""}`}
              href={`/community?topic=${item}`}
            >
              {POST_TOPIC_LABELS[item]}
            </Link>
          ))}
        </nav>
        {!composerOpen && (
          <button type="button" className={styles.primaryButton} onClick={startComposing}>
            {viewer ? "发帖" : "登录后发帖"}
          </button>
        )}
      </div>

      {composerOpen && viewer && (
        <PostComposer
          defaultTopic={topic ?? "chat"}
          onCancel={() => setComposerOpen(false)}
          onDone={() => setComposerOpen(false)}
        />
      )}

      {posts.length === 0 ? (
        <div className={styles.empty}>
          <strong>{topic ? `「${POST_TOPIC_LABELS[topic]}」还没有帖子` : "社区还没有帖子"}</strong>
          <p>发第一帖，聊聊武汉的路线、吃处和周末安排。</p>
          <button type="button" className={styles.primaryButton} onClick={startComposing}>发第一帖</button>
        </div>
      ) : (
        <ul className={styles.posts}>
          {posts.map((post) => (
            <li key={post.id} className={styles.post}>
              <i className={styles.avatar} style={{ background: post.author.avatarColor }} aria-hidden="true">
                {post.author.displayName.slice(0, 1)}
              </i>
              <div className={styles.postMain}>
                <h3 className={styles.postTitle}>
                  <Link href={`/post/${encodeURIComponent(post.id)}`}>{post.title}</Link>
                </h3>
                <p className={styles.postExcerpt}>{post.excerpt}</p>
                {post.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- 帖子封面由 Workers 上的 R2 直接返回，无需按需优化
                  <img className={styles.thumb} src={post.imageUrl} alt="" loading="lazy" />
                )}
                <div className={styles.postMeta}>
                  <span className={styles.chip}>{POST_TOPIC_LABELS[post.topic]}</span>
                  <b>{post.author.displayName}</b>
                  <time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time>
                  <span>{post.commentCount} 条评论</span>
                  {post.isMine && <span className={styles.mineTag}>我的</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className={styles.pager}>
          <button type="button" className={styles.button} onClick={() => void loadMore()} disabled={loading}>
            {loading ? "正在加载…" : "加载更多"}
          </button>
        </div>
      )}

      {authOpen && (
        <CommunityAuthModal
          onClose={() => setAuthOpen(false)}
          onAuthenticated={(authenticated) => {
            setViewer(authenticated);
            setAuthOpen(false);
            setComposerOpen(true);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
