import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PostThread } from "@/components/post-thread";
import styles from "@/components/community.module.css";
import { dateLabel } from "@/lib/activity-format";
import type { CommunityUser } from "@/lib/community-types";
import { findPostById, listPostComments } from "@/lib/post-repository";
import { POST_TOPIC_LABELS, type CommunityPost, type PostComment } from "@/lib/post-types";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { resolveViewer } from "@/app/community/viewer";

// 帖子详情按需缓存，发帖/编辑/隐藏会通过 revalidatePath 立即失效。
export const revalidate = 60;

// 同 /place：动态段启用 ISR；隐藏/编辑帖子时通过 revalidatePath 立即失效。
export function generateStaticParams() {
  return [];
}

type PostPageProps = { params: Promise<{ id: string }> };

type PostData = { post: CommunityPost; comments: PostComment[]; viewer: CommunityUser | null };

/** 同一次请求内 generateMetadata 与页面共用，只查一次库。 */
const loadPost = cache(async (id: string): Promise<PostData | null> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const viewer = await resolveViewer();
    const post = await findPostById(env.DB, id, viewer?.id ?? null);
    if (!post) return null;
    const comments = await listPostComments(env.DB, id, viewer?.id ?? null);
    return { post, comments, viewer };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "post_detail_db_unavailable",
      postId: id,
      error: error instanceof Error ? error.message : "unknown",
    }));
    return null;
  }
});

function postExcerpt(post: CommunityPost) {
  return post.body.replace(/\s+/g, " ").trim().slice(0, 120);
}

function postSchema(post: CommunityPost) {
  return {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: post.title,
    text: post.body,
    url: `${SITE_URL}/post/${post.id}`,
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    commentCount: post.commentCount,
    ...(post.imageUrl
      ? { image: post.imageUrl.startsWith("http") ? post.imageUrl : `${SITE_URL}${post.imageUrl}` }
      : {}),
    author: { "@type": "Person", name: post.author.displayName },
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/CommentAction",
      userInteractionCount: post.commentCount,
    },
  };
}

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadPost(id);
  if (!data) return { title: "帖子不存在", robots: { index: false, follow: true } };

  const { post } = data;
  const canonical = `/post/${post.id}`;
  const description = postExcerpt(post);

  return {
    title: `${post.title} · 社区`,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: post.title,
      description,
      url: canonical,
      publishedTime: post.createdAt,
      modifiedTime: post.updatedAt,
      authors: [post.author.displayName],
      ...(post.imageUrl ? { images: [{ url: post.imageUrl, alt: post.title }] } : {}),
    },
    twitter: {
      card: post.imageUrl ? "summary_large_image" : "summary",
      title: post.title,
      description,
    },
  };
}

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;
  const data = await loadPost(id);
  if (!data) notFound();

  const { post, comments, viewer } = data;
  const edited = post.updatedAt !== post.createdAt;

  return (
    <main className="detail-page">
      <nav className="detail-page-nav">
        <Link className="detail-page-brand" href="/">
          <b>江</b>
          <span><strong>{SITE_NAME}</strong><small>JIANGCHENG ATLAS</small></span>
        </Link>
        <Link className="detail-page-cta" href="/community">社区列表 →</Link>
      </nav>

      <article className="detail-page-card">
        <header className={styles.head}>
          <div className={styles.postTags}>
            <span className={styles.chip}>{POST_TOPIC_LABELS[post.topic]}</span>
            {post.isMine && <span className={styles.mineTag}>我的帖子</span>}
          </div>
          <h1 className={styles.heading}>{post.title}</h1>
          <div className={styles.postAuthor}>
            <i className={styles.avatar} style={{ background: post.author.avatarColor }} aria-hidden="true">
              {post.author.displayName.slice(0, 1)}
            </i>
            <span>
              <b>{post.author.displayName}</b>
              <small>
                @{post.author.username} · 发表于 {dateLabel(post.createdAt)}
                {edited ? ` · 更新于 ${dateLabel(post.updatedAt)}` : ""}
              </small>
            </span>
          </div>
        </header>

        <div className={styles.body}>
          {post.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 帖子图片直接由 Workers 上的 R2 返回，无需按需优化
            <img className={styles.postImage} src={post.imageUrl} alt={`${post.title}封面图`} loading="lazy" />
          )}

          <p className={styles.postText}>{post.body}</p>

          <div className="detail-page-actions">
            <Link className="detail-page-primary" href="/community">← 返回社区列表</Link>
            <Link href="/">在地图中打开</Link>
          </div>

          <PostThread postId={post.id} comments={comments} user={viewer} canModerate={post.isMine} />

          <footer className={styles.footer} style={{ padding: 0 }}>
            <Link href="/">← 返回地图</Link>
            <Link href="/community-guidelines">社区公约</Link>
            <Link href="/privacy">隐私说明</Link>
          </footer>
        </div>
      </article>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(postSchema(post)).replace(/</g, "\\u003c") }}
      />
    </main>
  );
}
