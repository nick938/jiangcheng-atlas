import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

export default function NotFound() {
  return (
    <main className="status-page">
      <div className="status-card">
        <p className="status-kicker">{SITE_NAME} · 404</p>
        <h1>没有找到这个坐标</h1>
        <p>链接可能已经失效，或者这个地点/活动已经下架。回到地图继续探索武汉。</p>
        <div className="status-actions">
          <Link className="status-primary" href="/">返回地图</Link>
          <Link href="/?category=event">看看正在召集的差事</Link>
          <Link href="/?category=landmark">从城市地标开始</Link>
        </div>
        <footer><Link href="/community-guidelines">社区公约</Link><Link href="/privacy">隐私说明</Link></footer>
      </div>
    </main>
  );
}
