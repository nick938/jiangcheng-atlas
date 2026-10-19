import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/http";
import { findPostById, hidePost, listPostComments, updatePost } from "@/lib/post-repository";
import { validatePostInput } from "@/lib/post-validation";
import { currentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  const post = await findPostById(env.DB, id, user?.id ?? null);
  if (!post) return NextResponse.json({ error: "帖子不存在或已隐藏" }, { status: 404 });
  const comments = await listPostComments(env.DB, id, user?.id ?? null);
  return NextResponse.json({ post, comments }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  const body = await readJsonBody<Record<string, unknown>>(request, 32 * 1024);
  const validation = validatePostInput(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  if (await updatePost(env.DB, id, user.id, validation.data)) {
    revalidatePath(`/post/${id}`);
    return NextResponse.json({ updated: true });
  }
  const existing = await env.DB.prepare("SELECT author_id, status FROM community_posts WHERE id = ?")
    .bind(id).first<{ author_id: string; status: string }>();
  if (!existing || existing.status !== "published") {
    return NextResponse.json({ error: "帖子不存在或已隐藏" }, { status: 404 });
  }
  return NextResponse.json({ error: "只能编辑自己的帖子" }, { status: 409 });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { id } = await context.params;
  const { env, user } = await currentUser(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!(await env.USER_ACTION_RATE_LIMITER.limit({ key: user.id })).success) {
    return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  }
  if (await hidePost(env.DB, id, { userId: user.id, isAdmin: false })) {
    revalidatePath(`/post/${id}`);
    return NextResponse.json({ hidden: true });
  }
  const existing = await env.DB.prepare("SELECT author_id, status FROM community_posts WHERE id = ?")
    .bind(id).first<{ author_id: string; status: string }>();
  if (!existing || existing.status !== "published") {
    return NextResponse.json({ error: "帖子不存在或已隐藏" }, { status: 404 });
  }
  return NextResponse.json({ error: "只能删除自己的帖子" }, { status: 403 });
}
