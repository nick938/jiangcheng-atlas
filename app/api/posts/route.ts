import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { inspectUploadedImage, MAX_IMAGE_REQUEST_BYTES } from "@/lib/image-upload";
import { createPost, listPosts } from "@/lib/post-repository";
import { POST_TOPICS, type PostTopic } from "@/lib/post-types";
import { validatePostInput } from "@/lib/post-validation";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

const MAX_POST_JSON_BYTES = 32 * 1024;

function readTopicFilter(value: string | null): PostTopic | null {
  return value && (POST_TOPICS as readonly string[]).includes(value) ? (value as PostTopic) : null;
}

function readLimit(value: string | null): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(Math.floor(parsed), 50);
}

export async function GET(request: NextRequest) {
  const { env, user } = await currentUser(request);
  const params = new URL(request.url).searchParams;
  const { posts, nextCursor } = await listPosts(env.DB, user?.id ?? null, {
    topic: readTopicFilter(params.get("topic")),
    cursor: params.get("cursor"),
    limit: readLimit(params.get("limit")),
  });
  return NextResponse.json({ posts, nextCursor }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> | null;
  let image: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_IMAGE_REQUEST_BYTES) {
      return NextResponse.json({ error: "图片不能超过 5 MB" }, { status: 413 });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }
    body = Object.fromEntries(
      [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    const uploaded = form.get("image");
    image = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  } else {
    body = await readJsonBody<Record<string, unknown>>(request, MAX_POST_JSON_BYTES);
  }

  const validation = validatePostInput(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { title, body: content, topic } = validation.data;

  const id = crypto.randomUUID();
  const inspectedImage = image ? await inspectUploadedImage(image) : null;
  if (image && !inspectedImage) {
    return NextResponse.json({ error: "仅支持 5 MB 内、内容有效的 JPEG、PNG、WebP 或 AVIF" }, { status: 400 });
  }
  const imageKey = inspectedImage ? `posts/${id}/${crypto.randomUUID()}.${inspectedImage.extension}` : null;

  if (image && inspectedImage && imageKey) {
    try {
      const object = await env.MEDIA.put(imageKey, await image.arrayBuffer(), {
        httpMetadata: {
          contentType: inspectedImage.contentType,
          cacheControl: "public, max-age=31536000, immutable",
          contentDisposition: "inline",
        },
        customMetadata: { postId: id, originalName: image.name.slice(0, 120) },
      });
      if (!object) return NextResponse.json({ error: "图片存储失败" }, { status: 500 });
    } catch (error) {
      console.error("Failed to upload post image", error);
      return NextResponse.json({ error: "图片存储失败，请稍后重试" }, { status: 500 });
    }
  }

  try {
    await createPost(env.DB, { id, authorId: user.id, title, body: content, topic, imageKey });
  } catch (error) {
    if (imageKey) await env.MEDIA.delete(imageKey);
    console.error("Failed to create post", error);
    return NextResponse.json({ error: "发布失败，图片已回滚" }, { status: 500 });
  }
  return NextResponse.json({ id }, { status: 201 });
}
