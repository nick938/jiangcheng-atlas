export type NavigationTarget = {
  name: string;
  longitude: number;
  latitude: number;
};

export function baiduNavigationUrl(target: NavigationTarget) {
  const query = new URLSearchParams({
    origin: "我的位置",
    destination: `latlng:${target.latitude},${target.longitude}|name:${target.name}`,
    mode: "driving",
    region: "武汉",
    coord_type: "wgs84",
    output: "html",
    src: "webapp.jiangcheng.atlas",
  });
  return `https://api.map.baidu.com/direction?${query}`;
}

export function amapLocationUrl(target: NavigationTarget) {
  const query = new URLSearchParams({
    position: `${target.longitude},${target.latitude}`,
    name: target.name,
    coordinate: "wgs84",
    callnative: "1",
    src: "jiangcheng-atlas",
  });
  return `https://uri.amap.com/marker?${query}`;
}
