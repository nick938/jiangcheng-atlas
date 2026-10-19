"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { dateLabel } from "@/lib/activity-format";
import type { CommunityUser } from "@/lib/community-types";
import type { PostComment } from "@/lib/post-types";
import { CommunityAuthModal } from "./community-auth-modal";
import styles from "./community.module.css";

const COMMENT_MAX = 500;

type Props = {
  postId: string;
  comments: PostComment[];
  user: CommunityUser | null;
  /** 帖子作者可以删除自己帖子下的任何评论 */
  canModerate: boolean;
};

export function PostThread({ postId, comments, user, canModerate }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<PostComment[]>(comments);
  const [viewer, setViewer] = useState<CommunityUser | null>(user);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => { setItems(comments); }, [comments]);
  useEffect(() => { setViewer(user); }, [user]);

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!viewer) {
      setAuthOpen(true);
      return;
    }
    const body = draft.trim();
    if (body.length < 1 || body.length > COMMENT_MAX) {
      setError(`评论需为 1–${COMMENT_MAX} 个字符`);
      return;
    }
    setBusy("create");
    setError("");
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json() as { id?: string; error?: string };
      if (response.status === 401) { setAuthOpen(true); setBusy(""); return; }
      if (!response.ok || !payload.id) throw new Error(payload.error ?? "评论发布失败");
      setDraft("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "评论发布失败");
    } finally {
      setBusy("");
    }
  }

  async function deleteComment(comment: PostComment) {
    if (!window.confirm("删除这条评论？")) return;
    setBusy(comment.id);
    setError("");
    try {
      const response = await fetch(
        `/api/posts/${encodeURIComponent(postId)}/comments?comment=${encodeURIComponent(comment.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as { hidden?: boolean; error?: string };
      if (response.status === 401) { setAuthOpen(true); return; }
      if (!response.ok) throw new Error(payload.error ?? "删除失败");
      setItems((current) => current.filter((item) => item.id !== comment.id));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.thread} aria-label="帖子评论">
      <div className={styles.threadHead}>
        <h2>评论</h2>
        <span>{items.length} 条</span>
      </div>

      {items.length === 0
        ? <p className={styles.hint} style={{ marginTop: 12 }}>还没有评论，来说说你的想法。</p>
        : (
          <ul className={styles.comments}>
            {items.map((comment) => (
              <li key={comment.id} className={styles.comment}>
                <i className={styles.commentAvatar} style={{ background: comment.author.avatarColor }} aria-hidden="true">
                  {comment.author.displayName.slice(0, 1)}
                </i>
                <div className={styles.commentMain}>
                  <b>{comment.author.displayName}</b>
                  <time dateTime={comment.createdAt}>{dateLabel(comment.createdAt)}</time>
                  <p>{comment.body}</p>
                </div>
                {(comment.isMine || canModerate) && (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={busy === comment.id}
                    onClick={() => void deleteComment(comment)}
                  >
                    {busy === comment.id ? "删除中…" : "删除"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

      {error && <p className={styles.formError} role="alert" style={{ marginTop: 12 }}>{error}</p>}

      {viewer ? (
        <form className={styles.commentForm} onSubmit={submitComment}>
          <label className={styles.label} htmlFor="post-comment-body">以 {viewer.displayName} 的身份评论</label>
          <textarea
            id="post-comment-body"
            className={styles.textarea}
            name="body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={COMMENT_MAX}
            placeholder="友善、具体的回复更容易被看见……"
            required
          />
          <span className={styles.counter}>{draft.length}/{COMMENT_MAX}</span>
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton} disabled={busy === "create"}>
              {busy === "create" ? "正在发送…" : "发表评论"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.gate}>
          <p>登录后可以参与讨论，也能删除自己的评论。</p>
          <div className={styles.formActions}>
            <button type="button" className={styles.primaryButton} onClick={() => setAuthOpen(true)}>登录后评论</button>
          </div>
        </div>
      )}

      {authOpen && (
        <CommunityAuthModal
          onClose={() => setAuthOpen(false)}
          onAuthenticated={(authenticated) => {
            setViewer(authenticated);
            setAuthOpen(false);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
