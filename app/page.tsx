import type { Metadata } from "next";
import { MapExplorer } from "@/components/map-explorer";
import { seedPlaces } from "@/lib/places";

// 只有首页需要地图样式与 maplibre 的控件样式，放在这里而不是 root layout，
// 让 /privacy、/place、/event 等页面不再加载 maplibre-gl.css（gzip 约 10 KB）。
// Next 16 文档：global styles 可以 import 到 app 目录下任意 layout/page/component。
import "maplibre-gl/dist/maplibre-gl.css";

// layout 不再声明 canonical（否则所有页面都指向首页），首页自己声明。
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <MapExplorer initialPlaces={seedPlaces} />;
}
