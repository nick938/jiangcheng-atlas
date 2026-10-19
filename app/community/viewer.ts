import { headers } from "next/headers";
import { NextRequest } from "next/server";
import type { CommunityUser } from "@/lib/community-types";
import { currentUser } from "@/lib/user-auth";

/**
 * 服务端页面没有 request 对象，这里用当前请求头重建一个 NextRequest，
 * 复用 currentUser() 的会话校验（读取 httpOnly 的会话 cookie），
 * 让 SSR 就能拿到 viewer，从而正确标记 isMine。
 * 任何异常都退化为未登录，不影响页面渲染。
 */
export async function resolveViewer(): Promise<CommunityUser | null> {
  try {
    const requestHeaders = await headers();
    const request = new NextRequest("http://localhost/community", { headers: new Headers(requestHeaders) });
    const { user } = await currentUser(request);
    return user;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "community_viewer_unavailable",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return null;
  }
}
