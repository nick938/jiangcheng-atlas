import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { createPostComment, hidePostComment } from "@/lib/post-repository";
import { validatePostCommentInput } from "@/lib/post-validation";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const body = await readJsonBody<{ body?: unknown }>(request, 4096);
  const validation = validatePostCommentInput(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const post = await env.DB.prepare("SELECT author_id FROM community_posts WHERE id = ? AND status = 'published'")
    .bind(id).first<{ author_id: string }>();
  if (!post) return NextResponse.json({ error: "帖子不存在或已隐藏" }, { status: 404 });
  const commentId = await createPostComment(env.DB, {
    postId: id,
    userId: user.id,
    body: validation.data.body,
    notifyAuthorId: post.author_id,
  });
  if (!commentId) return NextResponse.json({ error: "帖子不存在或已隐藏" }, { status: 404 });
  return NextResponse.json({ id: commentId }, { status: 201 });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const commentId = new URL(request.url).searchParams.get("comment");
  if (!commentId) return NextResponse.json({ error: "缺少评论编号" }, { status: 400 });
  const hidden = await hidePostComment(env.DB, { postId: id, commentId, userId: user.id });
  if (hidden) return NextResponse.json({ hidden: true });
  const existing = await env.DB.prepare("SELECT id FROM post_comments WHERE id = ? AND post_id = ?")
    .bind(commentId, id).first<{ id: string }>();
  if (!existing) return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  return NextResponse.json({ error: "只能删除自己的评论或自己帖子下的评论" }, { status: 403 });
}
