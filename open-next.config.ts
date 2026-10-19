import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

/**
 * 站点规模小、只用时间驱动与按需再验证，因此采用官方文档 “Small site using revalidation” 组合：
 * - incrementalCache: R2（binding NEXT_INC_CACHE_R2_BUCKET）
 * - queue: Durable Object 队列（binding NEXT_CACHE_DO_QUEUE）——时间驱动 revalidate 必需，
 *   缺省 dummy 队列会在过期后只记录 "Failed to revalidate stale page" 而永不刷新
 * - tagCache: D1 Next 模式（binding NEXT_TAG_CACHE_D1，复用现有 DB，需要 revalidations 表）
 *
 * 页面需要 export const revalidate 才会写入这份缓存；未声明 revalidate 的路由行为不变。
 * 参考：https://opennext.js.org/cloudflare/caching
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: doQueue,
  tagCache: d1NextTagCache,
});
