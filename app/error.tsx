"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({
      event: "client_render_failed",
      digest: error.digest ?? null,
      message: error.message,
    }));
  }, [error]);

  return (
    <main className="status-page">
      <div className="status-card">
        <p className="status-kicker">ERROR · 暂时无法加载</p>
        <h1>这一页暂时打不开</h1>
        <p>可能是网络波动或数据服务短暂不可用。可以重试一次，或者先回到地图。</p>
        {error.digest && <p className="status-hint">错误编号：{error.digest}</p>}
        <div className="status-actions">
          <button type="button" className="status-primary" onClick={() => retry()}>重新加载</button>
          <Link href="/">返回地图</Link>
          <Link href="/?category=event">正在召集的差事</Link>
        </div>
      </div>
    </main>
  );
}
