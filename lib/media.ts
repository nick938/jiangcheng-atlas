import { MEDIA_PUBLIC_BASE } from "@/lib/site";

/**
 * R2 对象键 → 可访问 URL。
 * 生产环境返回 CDN 直出地址；本地开发/未配置 CDN 时回退到 Worker 的 /media/<key> 路由。
 */
export function mediaUrl(key: string): string {
  return MEDIA_PUBLIC_BASE ? `${MEDIA_PUBLIC_BASE}/${key}` : `/media/${key}`;
}
