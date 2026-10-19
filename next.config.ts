import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// 只在开发态初始化 wrangler/miniflare：该函数会读取 .dev.vars 并写 $HOME/.wrangler，
// 在生产构建（next build）里执行会让构建依赖本机密钥与 $HOME 可写性。
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev();
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  async headers() {
    // CSP 走 next.config 的 headers() 而不是根目录 proxy.ts：
    // Next 16 起 Proxy（原 Middleware）默认运行在 Node.js runtime，且 Proxy 文件不允许设 runtime
    // （node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:223），
    // 而 @opennextjs/cloudflare 1.20.2 会直接拒绝 Node.js middleware
    // （node_modules/@opennextjs/cloudflare/dist/cli/build/build.js:66-69）。
    // 现在没有用 nonce，静态响应头与 Proxy 等价；等适配器支持 Node middleware 或改用 nonce 时再迁回 proxy.ts。
    const contentSecurityPolicyReportOnly = [
      "default-src 'self'",
      // Next.js 会在 HTML 里内联启动脚本，未上 nonce 前必须允许 'unsafe-inline'；
      // 开发态 React/Turbopack 用 eval 重建错误栈，需要 'unsafe-eval'（生产不需要，见 Next CSP 文档）
      process.env.NODE_ENV === "development"
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      // Tailwind / MapLibre 会注入内联样式
      "style-src 'self' 'unsafe-inline'",
      // 地图瓦片/字形/雪碧图来自 OpenFreeMap；部分种子地点图片走 Wikimedia（Special:Redirect 会跳到 upload.wikimedia.org）
      "img-src 'self' data: blob: https://tiles.openfreemap.org https://commons.wikimedia.org https://upload.wikimedia.org",
      "font-src 'self' data:",
      "connect-src 'self' https://tiles.openfreemap.org",
      // MapLibre 用 blob: URL 创建解析瓦片的 Worker
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          // HSTS 与 Cloudflare 边缘的 SSL/TLS → Edge Certificates → HSTS 二选一，不要同时配。
          // 这里选应用层下发，好处是随代码可回滚；若以后改为边缘统一管理，删除本行即可。
          // 注意：next.config 的 headers 不覆盖 Workers 静态资源（/_next/static 与 public 文件），
          // 静态资源缓存头请用 public/_headers（见 OPERATIONS.md）。
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicyReportOnly },
        ],
      },
    ];
  },
};

export default nextConfig;
