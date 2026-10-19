import type { MetadataRoute } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { listActivities } from "@/lib/community-repository";
import { listPublishedPlaces } from "@/lib/place-repository";
import { seedPlaces } from "@/lib/places";
import { listPosts } from "@/lib/post-repository";
import { SITE_URL, activityUrl, placeUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const MAX_POST_ENTRIES = 200;
const POST_PAGE_SIZE = 50;

/** 帖子分页拉取到上限（listPosts 单页最多 50 条），任何一页失败都只影响帖子条目。 */
async function collectPostEntries(db: D1Database): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  let cursor: string | null = null;
  while (entries.length < MAX_POST_ENTRIES) {
    const page = await listPosts(db, null, { cursor, limit: POST_PAGE_SIZE });
    for (const post of page.posts) {
      if (entries.length >= MAX_POST_ENTRIES) break;
      entries.push({
        url: `${SITE_URL}/post/${post.id}`,
        lastModified: new Date(post.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.5,
      });
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/community`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/community-guidelines`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  try {
    const { env } = await getCloudflareContext({ async: true });
    const [places, activities] = await Promise.all([
      listPublishedPlaces(env.DB),
      listActivities(env.DB, null),
    ]);
    // D1 可达时它就是唯一事实来源：列表为空说明确实没有已发布地点，
    // 此时不能再回退到内置数据，否则会收录实际返回 404 的链接。
    entries.push(
      ...places.map((place) => ({
        url: `${SITE_URL}${placeUrl(place.slug)}`,
        lastModified: now,
        changeFrequency: "monthly" as const,
        priority: place.featured ? 0.8 : 0.6,
      })),
      ...activities.map((activity) => ({
        url: `${SITE_URL}${activityUrl(activity.id)}`,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    );

    // 帖子单独兜底：即使帖子查询失败，地点与活动条目照常收录。
    try {
      entries.push(...await collectPostEntries(env.DB));
    } catch (error) {
      console.warn(JSON.stringify({
        event: "sitemap_posts_unavailable",
        error: error instanceof Error ? error.message : "unknown",
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      event: "sitemap_db_unavailable",
      error: error instanceof Error ? error.message : "unknown",
    }));
    entries.push(...seedPlaces.map((place) => ({
      url: `${SITE_URL}${placeUrl(place.slug)}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: place.featured ? 0.8 : 0.6,
    })));
  }

  return entries;
}
