"use client";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#0e1514", color: "#eef3f1", fontFamily: "system-ui, -apple-system, 'Noto Sans SC', sans-serif" }}>
        <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "32px 20px" }}>
          <div style={{ width: "min(520px, 100%)", padding: "28px", border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", background: "rgba(255,255,255,.04)", textAlign: "center" }}>
            <p style={{ margin: 0, color: "#d8ff3e", fontSize: ".8125rem", fontWeight: 700, letterSpacing: ".14em" }}>JIANGCHENG ATLAS</p>
            <h1 style={{ margin: "10px 0 8px", fontSize: "1.75rem" }}>页面加载失败</h1>
            <p style={{ margin: 0, color: "#a8b6b2", lineHeight: 1.7 }}>站点外壳没有正常渲染，请重试；如果持续失败，稍后再访问。</p>
            {error.digest && <p style={{ margin: "10px 0 0", color: "#72817c", fontSize: ".8125rem" }}>错误编号：{error.digest}</p>}
            <button
              type="button"
              onClick={() => retry()}
              style={{ marginTop: "18px", height: "42px", padding: "0 22px", border: 0, borderRadius: "11px", background: "#d8ff3e", color: "#16201d", fontSize: "1rem", fontWeight: 800, cursor: "pointer" }}
            >
              重新加载
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
