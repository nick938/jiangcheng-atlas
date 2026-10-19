import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { CommunityFeed } from "@/components/community-feed";
import styles from "@/components/community.module.css";
import { listPosts } from "@/lib/post-repository";
import { POST_TOPICS, type PostSummary, type PostTopic } from "@/lib/post-types";
import { SITE_NAME } from "@/lib/site";
import { resolveViewer } from "./viewer";

export const dynamic = "force-dynamic";

type CommunityPageProps = {
  searchParams: Promise<{ topic?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "社区",
  description: "江城图志社区：发帖聊路线、约伴、攻略与吃喝，和同城的人一起把武汉走深一点。",
  alternates: { canonical: "/community" },
  openGraph: {
    type: "website",
    title: `社区 · ${SITE_NAME}`,
    description: "发帖聊路线、约伴、攻略与吃喝，和同城的人一起把武汉走深一点。",
    url: "/community",
  },
  twitter: {
    card: "summary",
    title: `社区 · ${SITE_NAME}`,
    description: "发帖聊路线、约伴、攻略与吃喝，和同城的人一起把武汉走深一点。",
  },
};

function parseTopic(value: string | string[] | undefined): PostTopic | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  return (POST_TOPICS as readonly string[]).includes(raw) ? (raw as PostTopic) : null;
}

type FeedData = {
  posts: PostSummary[];
  nextCursor: string | null;
  unavailable: string;
};

async function loadFeed(topic: PostTopic | null, viewerId: string | null): Promise<FeedData> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const { posts, nextCursor } = await listPosts(env.DB, viewerId, { topic, limit: 20 });
    return { posts, nextCursor, unavailable: "" };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "community_feed_db_unavailable",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return { posts: [], nextCursor: null, unavailable: "社区数据暂时不可用，请稍后刷新重试。" };
  }
}

export default async function CommunityPage({ searchParams }: CommunityPageProps) {
  const params = await searchParams;
  const topic = parseTopic(params.topic);
  const viewer = await resolveViewer();
  const feed = await loadFeed(topic, viewer?.id ?? null);

  return (
    <main className="detail-page">
      <nav className="detail-page-nav">
        <Link className="detail-page-brand" href="/">
          <b>江</b>
          <span><strong>{SITE_NAME}</strong><small>JIANGCHENG ATLAS</small></span>
        </Link>
        <Link className="detail-page-cta" href="/">返回地图 →</Link>
      </nav>

      <section className="detail-page-card">
        <header className={styles.head}>
          <p className={styles.eyebrow}>COMMUNITY BOARD</p>
          <h1 className={styles.heading}>社区</h1>
          <p className={styles.subtitle}>
            聊路线、约同伴、写攻略、找吃处。发帖和评论需要登录，浏览不需要。
          </p>
        </header>

        <CommunityFeed
          initialPosts={feed.posts}
          initialCursor={feed.nextCursor}
          topic={topic}
          user={viewer}
          unavailable={feed.unavailable}
        />

        <footer className={styles.footer}>
          <Link href="/">← 返回地图</Link>
          <Link href="/community-guidelines">社区公约</Link>
          <Link href="/privacy">隐私说明</Link>
        </footer>
      </section>
    </main>
  );
}
