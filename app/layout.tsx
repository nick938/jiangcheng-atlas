import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG_IMAGE, SITE_TAGLINE, SITE_URL } from "@/lib/site";

// P1 字体：不再自托管 Noto Sans SC。subsets:["latin"] 只影响 <link rel=preload>，
// Google 的 CJK unicode-range 分片仍会被 self-host 并按需下载（构建产物 104 个 woff2 / 4.34 MB）。
// 中文改用系统 CJK 栈（globals.css 的 --font-cn），只保留 Space Grotesk 做 latin 装饰。
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} · 武汉城市互动地图`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["武汉地图", "武汉旅行", "武汉城市图鉴", "江城图志", "武汉线下活动", "武汉骑行"],
  authors: [{ name: "我独自升级", url: "https://sololeveling.top" }],
  creator: "我独自升级",
  // 不在 layout 声明 canonical：否则 /privacy、/community-guidelines 等页面会全部指向首页。
  // 首页的 canonical 由 app/page.tsx 自行声明。
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_CN",
    url: "/",
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [{ url: SITE_OG_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} · ${SITE_TAGLINE}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={spaceGrotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
