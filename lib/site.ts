export const SITE_NAME = "江城图志";
export const SITE_URL = "https://atlas.sololeveling.top";
export const SITE_TAGLINE = "武汉城市互动地图与线下活动社区";
export const SITE_DESCRIPTION = "沿江穿城，发现武汉值得抵达、停留与讲述的城市坐标，并发起或加入本地线下活动。";
export const SITE_OG_IMAGE = "/og.png";

export function placeUrl(slug: string) {
  return `/place/${slug}`;
}

export function activityUrl(id: string) {
  return `/event/${id}`;
}
