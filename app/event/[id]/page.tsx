import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaImageProps } from "@/components/media-thumbnail";
import { activityStatusLabel, activityTypeMeta, dateRangeLabel } from "@/lib/activity-format";
import { calendarFileName } from "@/lib/calendar";
import type { CityActivity } from "@/lib/community-types";
import { findActivityById } from "@/lib/community-repository";
import { amapLocationUrl, baiduNavigationUrl } from "@/lib/navigation";
import { SITE_NAME, SITE_OG_IMAGE, SITE_URL, activityUrl } from "@/lib/site";

// 活动信息会随报名/编辑变化，缓存时间短一些。
export const revalidate = 120;

// 同 /place：让动态段启用 ISR，按需生成后进 R2 缓存。
export function generateStaticParams() {
  return [];
}

type EventPageProps = { params: Promise<{ id: string }> };

async function loadActivity(id: string): Promise<CityActivity | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return await findActivityById(env.DB, id, null);
  } catch (error) {
    // 与 /place/[slug] 对齐：D1 短暂不可用时返回 null → notFound()，
    // 而不是把 500 抛给搜索引擎和分享出去的链接。
    console.warn(JSON.stringify({
      event: "event_detail_db_unavailable",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return null;
  }
}

function eventSchema(activity: CityActivity) {
  const cancelled = activity.status === "cancelled";
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: activity.title,
    description: activity.details,
    startDate: activity.startsAt,
    endDate: activity.endsAt,
    eventStatus: cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    maximumAttendeeCapacity: activity.capacity,
    url: `${SITE_URL}${activityUrl(activity.id)}`,
    ...(activity.imageUrl
      ? { image: activity.imageUrl.startsWith("http") ? activity.imageUrl : `${SITE_URL}${activity.imageUrl}` }
      : {}),
    location: {
      "@type": "Place",
      name: activity.meetingName,
      geo: {
        "@type": "GeoCoordinates",
        latitude: activity.meetingLatitude,
        longitude: activity.meetingLongitude,
      },
      address: {
        "@type": "PostalAddress",
        addressCountry: "CN",
        addressRegion: "湖北省",
        addressLocality: "武汉市",
      },
    },
    organizer: { "@type": "Person", name: activity.creator.displayName },
  };
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { id } = await params;
  const activity = await loadActivity(id);
  if (!activity) return { title: `活动不存在 · ${SITE_NAME}`, robots: { index: false, follow: true } };

  const type = activityTypeMeta[activity.activityType].label;
  const when = dateRangeLabel(activity.startsAt, activity.endsAt);
  const canonical = activityUrl(activity.id);
  const title = `${activity.title} · ${when}`;
  const description = `${type} · 集合地点：${activity.meetingName} · ${activity.details}`;
  const dead = activity.status !== "open";

  return {
    title,
    description,
    alternates: { canonical },
    robots: dead ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      type: "article",
      title,
      description,
      url: canonical,
      // 没有活动封面时退回站点统一 OG 图。
      images: activity.imageUrl
        ? [{ url: activity.imageUrl, alt: `${activity.title}活动图片` }]
        : [{ url: SITE_OG_IMAGE, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [activity.imageUrl ?? SITE_OG_IMAGE],
    },
  };
}

export default async function EventPage({ params }: EventPageProps) {
  const { id } = await params;
  const activity = await loadActivity(id);
  if (!activity) notFound();

  const type = activityTypeMeta[activity.activityType];
  const statusLabel = activityStatusLabel(activity, Date.now());
  const navigationTarget = {
    name: activity.meetingName,
    longitude: activity.meetingLongitude,
    latitude: activity.meetingLatitude,
  };
  const mapHref = `/?event=${encodeURIComponent(activity.id)}`;

  return (
    <main className="detail-page">
      <nav className="detail-page-nav">
        <Link className="detail-page-brand" href="/">
          <b>江</b>
          <span><strong>{SITE_NAME}</strong><small>JIANGCHENG ATLAS</small></span>
        </Link>
        <Link className="detail-page-cta" href={mapHref}>在地图中打开 →</Link>
      </nav>

      <article className="detail-page-card">
        <header className="detail-page-hero is-event" style={{ "--detail-color": "#88b800" } as React.CSSProperties}>
          {activity.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 远端/R2 图片无法走 Workers 上的按需优化，直接用原图与本地缩略图拼 srcSet
            <img
              {...mediaImageProps(activity.imageUrl)}
              alt={`${activity.title}活动图片`}
              width={1280}
              height={720}
              sizes="(max-width: 760px) 100vw, 880px"
              decoding="async"
            />
          )}
          <div className="detail-page-hero-text">
            <div className="detail-tags">
              <span>差事</span>
              <span>{type.label}</span>
              <span>{statusLabel}</span>
            </div>
            <h1>{activity.title}</h1>
            <p className="detail-page-subtitle">{dateRangeLabel(activity.startsAt, activity.endsAt)}</p>
          </div>
        </header>

        <div className="detail-page-body">
          {activity.status === "cancelled" && (
            <p className="detail-page-alert">这个活动已由发起人取消，链接仅作记录。</p>
          )}
          {activity.status !== "cancelled" && new Date(activity.endsAt).getTime() <= Date.now() && (
            <p className="detail-page-alert">这个活动已经结束，链接仅作记录。</p>
          )}

          <p className="detail-page-lead">{activity.details}</p>

          <dl className="detail-page-facts">
            <div><dt>时间段</dt><dd>{dateRangeLabel(activity.startsAt, activity.endsAt)}</dd></div>
            <div><dt>集合地点</dt><dd>{activity.meetingName}</dd></div>
            <div><dt>队伍</dt><dd>{activity.joinedCount} / {activity.capacity} 人 · {statusLabel}</dd></div>
            <div><dt>发起人</dt><dd>{activity.creator.displayName}</dd></div>
          </dl>

          <div className="detail-page-actions">
            <Link className="detail-page-primary" href={mapHref}>在地图中查看 / 报名</Link>
            <a href={`/api/activities/${activity.id}/calendar`} download={calendarFileName(activity.id)}>加入日历 (.ics)</a>
            <a href={baiduNavigationUrl(navigationTarget)} target="_blank" rel="noreferrer">百度导航</a>
            <a href={amapLocationUrl(navigationTarget)} target="_blank" rel="noreferrer">高德地图</a>
          </div>

          <p className="detail-page-credit">
            报名、留言和退出都需要登录，请在打开地图后使用右上角账号入口。
          </p>

          <section className="detail-page-related">
            <h2>继续看看</h2>
            <ul>
              <li>
                <Link href="/?category=event">
                  <span style={{ background: "#88b800" }} />
                  <strong>全部差事</strong>
                  <small>在地图上查看正在召集的武汉线下活动</small>
                </Link>
              </li>
              <li>
                <Link href="/">
                  <span style={{ background: "#49635e" }} />
                  <strong>城市地点图鉴</strong>
                  <small>地标、江湖公园、人文街区、高校与美食坐标</small>
                </Link>
              </li>
            </ul>
          </section>

          <footer className="detail-page-footer">
            <Link href="/">← 返回地图</Link>
            <Link href="/community-guidelines">社区公约</Link>
            <Link href="/privacy">隐私说明</Link>
          </footer>
        </div>
      </article>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(eventSchema(activity)).replace(/</g, "\\u003c") }}
      />
    </main>
  );
}
