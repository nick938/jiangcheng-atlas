"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { POST_TOPICS, POST_TOPIC_LABELS, type PostTopic } from "@/lib/post-types";
import styles from "./community.module.css";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const TITLE_MIN = 4;
const TITLE_MAX = 60;
const BODY_MIN = 10;
const BODY_MAX = 3000;

type Props = {
  defaultTopic?: PostTopic;
  onCancel?: () => void;
  onDone?: () => void;
};

export function PostComposer({ defaultTopic = "chat", onCancel, onDone }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<PostTopic>(defaultTopic);
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();

  function pickImage(file: File | null) {
    setError("");
    if (!file) {
      setImage(null);
      return;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      setError("封面图仅支持 JPEG / PNG / WebP / AVIF 格式");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("封面图不能超过 5 MB");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setImage(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (trimmedTitle.length < TITLE_MIN || trimmedTitle.length > TITLE_MAX) {
      setError(`标题需为 ${TITLE_MIN}–${TITLE_MAX} 个字符`);
      return;
    }
    if (trimmedBody.length < BODY_MIN || trimmedBody.length > BODY_MAX) {
      setError(`正文需为 ${BODY_MIN}–${BODY_MAX} 个字符`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = image
        ? await fetch("/api/posts", { method: "POST", body: buildFormData() })
        : await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: trimmedTitle, body: trimmedBody, topic }),
          });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error ?? "发布失败，请稍后再试");
      onDone?.();
      router.refresh();
      router.push(`/post/${payload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布失败，请稍后再试");
      setBusy(false);
    }
  }

  function buildFormData() {
    const data = new FormData();
    data.set("title", trimmedTitle);
    data.set("body", trimmedBody);
    data.set("topic", topic);
    if (image) data.set("image", image);
    return data;
  }

  return (
    <form className={styles.composerOpen} onSubmit={submit}>
      <div className={styles.composerHead}>
        <strong>写新帖</strong>
        <small>标题 {TITLE_MIN}–{TITLE_MAX} 字 · 正文 {BODY_MIN}–{BODY_MAX} 字</small>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="post-title">标题</label>
          <input
            id="post-title"
            className={styles.input}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={TITLE_MIN}
            maxLength={TITLE_MAX}
            placeholder="例如：周末东湖绿道骑行约伴"
            required
          />
          <span className={styles.counter}>{title.length}/{TITLE_MAX}</span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="post-topic">话题</label>
          <select
            id="post-topic"
            className={styles.select}
            name="topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value as PostTopic)}
          >
            {POST_TOPICS.map((item) => (
              <option key={item} value={item}>{POST_TOPIC_LABELS[item]}</option>
            ))}
          </select>
          <span className={styles.hint}>话题决定帖子在社区列表里的归类。</span>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="post-body">正文</label>
        <textarea
          id="post-body"
          className={styles.textarea}
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          minLength={BODY_MIN}
          maxLength={BODY_MAX}
          placeholder="说说路线、时间、集合点，或者你想分享的武汉角落……"
          required
        />
        <span className={body.length > BODY_MAX ? styles.counterOver : styles.counter}>{body.length}/{BODY_MAX}</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="post-image">封面图（可选）</label>
        <input
          id="post-image"
          ref={fileRef}
          className={styles.input}
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={(event) => pickImage(event.target.files?.[0] ?? null)}
        />
        <span className={styles.hint}>支持 JPEG / PNG / WebP / AVIF，单张不超过 5 MB。</span>
      </div>

      {error && <p className={styles.formError} role="alert">{error}</p>}

      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? "正在发布…" : "发布帖子"}
        </button>
        {onCancel && <button type="button" className={styles.button} onClick={onCancel} disabled={busy}>取消</button>}
      </div>
    </form>
  );
}
