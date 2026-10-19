import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaImageProps } from "@/components/media-thumbnail";
import { amapLocationUrl, baiduNavigationUrl } from "@/lib/navigation";
import { listPublishedPlaces } from "@/lib/place-repository";
import { categoryMeta, seedPlaces, withDefaultPlaceMedia, type Place } from "@/lib/places";
import { SITE_NAME, SITE_OG_IMAGE, SITE_URL, placeUrl } from "@/lib/site";

// 已启用 R2 增量缓存：按需生成后缓存，降低爬虫与分享链接带来的 D1 读放大。
export const revalidate = 300;

// 空数组表示构建期不预渲染任何 slug，但让动态段启用 ISR：
// 首次请求按需生成并写入 R2 增量缓存，之后由 revalidate 与 revalidatePath 控制刷新。
export function generateStaticParams() {
  return [];
}

type PlacePageProps = { params: Promise<{ slug: string }> };

/**
 * D1 可达时以数据库为准（下架地点即 404），仅当 D1 不可用时退回到内置地点数据。
 * 同一次请求内 generateMetadata 与页面共用 React cache，只查一次库。
 */
const loadPublishedPlaces = cache(async (): Promise<Place[]> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const places = await listPublishedPlaces(env.DB);
    return places.map(withDefaultPlaceMedia);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "place_detail_db_unavailable",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return seedPlaces;
  }
});

const loadPlace = cache(async (slug: string): Promise<Place | null> => {
  const places = await loadPublishedPlaces();
  return places.find((place) => place.slug === slug) ?? null;
});

function relatedPlaces(places: Place[], current: Place) {
  const others = places.filter((place) => place.id !== current.id);
  const sameCategory = others.filter((place) => place.categoryId === current.categoryId);
  const sameDistrict = others.filter(
    (place) => place.district === current.district && place.categoryId !== current.categoryId,
  );
  return [...sameCategory, ...sameDistrict].slice(0, 4);
}

function placeSchema(place: Place) {
  return {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    name: place.name,
    alternateName: place.subtitle,
    description: place.description,
    url: `${SITE_URL}${placeUrl(place.slug)}`,
    ...(place.imageUrl ? { image: place.imageUrl.startsWith("http") ? place.imageUrl : `${SITE_URL}${place.imageUrl}` } : {}),
    geo: { "@type": "GeoCoordinates", latitude: place.latitude, longitude: place.longitude },
    address: {
      "@type": "PostalAddress",
      addressCountry: "CN",
      addressRegion: "湖北省",
      addressLocality: "武汉市",
      streetAddress: `${place.district}${place.address}`,
    },
    isAccessibleForFree: true,
  };
}

export async function generateMetadata({ params }: PlacePageProps): Promise<Metadata> {
  const { slug } = await params;
  const place = await loadPlace(slug);
  if (!place) return { title: `地点未收录 · ${SITE_NAME}`, robots: { index: false, follow: true } };

  const canonical = placeUrl(place.slug);
  const description = `${place.subtitle}。${place.description}`;
  return {
    title: `${place.name} · ${categoryMeta[place.categoryId].label}`,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title: `${place.name} · ${place.subtitle}`,
      description,
      url: canonical,
      // 没有实景图时退回站点统一 OG 图，避免分享卡片空白。
      images: place.imageUrl
        ? [{ url: place.imageUrl, alt: `${place.name}实景` }]
        : [{ url: SITE_OG_IMAGE, width: 1200, height: 630, alt: `${place.name} · ${place.subtitle}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${place.name} · ${place.subtitle}`,
      description,
      images: [place.imageUrl ?? SITE_OG_IMAGE],
    },
  };
}

export default async function PlacePage({ params }: PlacePageProps) {
  const { slug } = await params;
  const [place, places] = await Promise.all([loadPlace(slug), loadPublishedPlaces()]);
  if (!place) notFound();

  const category = categoryMeta[place.categoryId];
  const related = relatedPlaces(places, place);
  const navigationTarget = { name: place.name, longitude: place.longitude, latitude: place.latitude };

  return (
    <main className="detail-page">
      <nav className="detail-page-nav">
        <Link className="detail-page-brand" href="/">
          <b>江</b>
          <span><strong>{SITE_NAME}</strong><small>JIANGCHENG ATLAS</small></span>
        </Link>
        <Link className="detail-page-cta" href={`/?place=${encodeURIComponent(place.slug)}`}>在地图中打开 →</Link>
      </nav>

      <article className="detail-page-card">
        <header className="detail-page-hero" style={{ "--detail-color": category.color } as React.CSSProperties}>
          {place.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 远端/R2 图片无法走 Workers 上的按需优化，直接用原图与本地缩略图拼 srcSet
            <img
              {...mediaImageProps(place.imageUrl)}
              alt={`${place.name} · ${place.subtitle}`}
              width={1280}
              height={720}
              sizes="(max-width: 760px) 100vw, 880px"
              decoding="async"
            />
          )}
          <div className="detail-page-hero-text">
            <div className="detail-tags">
              <span>{category.label}</span>
              <span>{place.district}</span>
              {place.featured && <span>本期推荐</span>}
            </div>
            <h1>{place.name}</h1>
            <p className="detail-page-subtitle">{place.subtitle}</p>
          </div>
        </header>

        <div className="detail-page-body">
          <p className="detail-page-lead">{place.description}</p>

          <dl className="detail-page-facts">
            <div><dt>地址</dt><dd>{place.district} · {place.address}</dd></div>
            <div><dt>坐标</dt><dd>{place.latitude.toFixed(4)}°N · {place.longitude.toFixed(4)}°E</dd></div>
            <div><dt>分类</dt><dd>{category.label}</dd></div>
          </dl>

          <div className="detail-page-actions">
            <Link className="detail-page-primary" href={`/?place=${encodeURIComponent(place.slug)}`}>在地图上查看</Link>
            <a href={baiduNavigationUrl(navigationTarget)} target="_blank" rel="noreferrer">百度导航</a>
            <a href={amapLocationUrl(navigationTarget)} target="_blank" rel="noreferrer">高德地图</a>
          </div>

          {place.imageSourceUrl && (
            <p className="detail-page-credit">
              图片来源：
              <a href={place.imageSourceUrl} target="_blank" rel="noreferrer">{place.imageCredit ?? "Wikimedia Commons"} ↗</a>
            </p>
          )}

          {related.length > 0 && (
            <section className="detail-page-related">
              <h2>继续走这条线</h2>
              <ul>
                {related.map((item) => (
                  <li key={item.id}>
                    <Link href={placeUrl(item.slug)}>
                      <span style={{ background: categoryMeta[item.categoryId].color }} />
                      <strong>{item.name}</strong>
                      <small>{item.subtitle}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="detail-page-footer">
            <Link href="/">← 返回地图</Link>
            <Link href="/community-guidelines">社区公约</Link>
            <Link href="/privacy">隐私说明</Link>
          </footer>
        </div>
      </article>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(placeSchema(place)).replace(/</g, "\\u003c") }}
      />
    </main>
  );
}
