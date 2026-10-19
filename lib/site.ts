export const SITE_NAME = "江城图志";
export const SITE_URL = "https://atlas.sololeveling.top";
export const SITE_TAGLINE = "武汉城市互动地图与线下活动社区";
export const SITE_DESCRIPTION = "沿江穿城，发现武汉值得抵达、停留与讲述的城市坐标，并发起或加入本地线下活动。";
export const SITE_OG_IMAGE = "/og.png";

/**
 * R2 媒体直出域名（Cloudflare 自定义域，绑定 jiangcheng-atlas-media 桶）。
 *
 * 取值优先级：
 * 1. 运行时变量 MEDIA_PUBLIC_BASE（wrangler.jsonc 的 vars；本地可用 .dev.vars 覆盖为空串）
 * 2. 生产构建默认 CDN；开发环境默认空（走 Worker 的 /media/<key> 路由，上传后立即可见）
 *
 * 置空即整体回退到 /media，方便未绑定域名或本地 preview 时使用。
 */
const MEDIA_CDN_DEFAULT = "https://media.atlas.sololeveling.top";
const mediaBaseFromEnv = process.env.MEDIA_PUBLIC_BASE;
export const MEDIA_PUBLIC_BASE = mediaBaseFromEnv !== undefined
  ? mediaBaseFromEnv
  : (process.env.NODE_ENV === "production" ? MEDIA_CDN_DEFAULT : "");

export function placeUrl(slug: string) {
  return `/place/${slug}`;
}

export function activityUrl(id: string) {
  return `/event/${id}`;
}
