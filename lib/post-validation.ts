import { POST_TOPICS, type PostTopic } from "@/lib/post-types";

export const POST_VALIDATION_ERROR = "请检查标题、正文和话题";

export type PostInput = { title: string; body: string; topic: PostTopic };

export function validatePostInput(payload: Record<string, unknown> | null):
  | { ok: true; data: PostInput }
  | { ok: false; error: string } {
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  const rawTopic = payload?.topic;
  const topic = rawTopic === undefined || rawTopic === null || rawTopic === "" ? "chat" : rawTopic;
  if (title.length < 4 || title.length > 60) return { ok: false, error: POST_VALIDATION_ERROR };
  if (body.length < 10 || body.length > 3000) return { ok: false, error: POST_VALIDATION_ERROR };
  if (typeof topic !== "string" || !(POST_TOPICS as readonly string[]).includes(topic)) {
    return { ok: false, error: POST_VALIDATION_ERROR };
  }
  return { ok: true, data: { title, body, topic: topic as PostTopic } };
}

export const POST_COMMENT_MIN_LENGTH = 1;
export const POST_COMMENT_MAX_LENGTH = 500;

export function validatePostCommentInput(payload: { body?: unknown } | null):
  | { ok: true; data: { body: string } }
  | { ok: false; error: string } {
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (body.length < POST_COMMENT_MIN_LENGTH || body.length > POST_COMMENT_MAX_LENGTH) {
    return { ok: false, error: `评论需为 ${POST_COMMENT_MIN_LENGTH}–${POST_COMMENT_MAX_LENGTH} 个字符` };
  }
  return { ok: true, data: { body } };
}
