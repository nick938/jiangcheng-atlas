// 详情图缩略图工具（纯函数，服务端/客户端都能用）。
//
// public/places/*.jpg 单张 237–632 KB，但地图详情卡的图片色带只有 98px 高、
// 独立详情页 hero 也只有 ~296px 高。缩略图由 scripts/generate-place-thumbnails.py 生成：
//   public/places/thumbs/<slug>-320.jpg / -640.jpg / -320.webp / -640.webp
//
// 外部图片（用户上传到 R2 的封面等）没有缩略图，原样返回，调用方要能接受没有 srcSet。

const LOCAL_PLACE_IMAGE = /^\/places\/([^/]+)\.(?:jpe?g|png|webp|avif)$/i;

function thumbBase(url: string): string | null {
  const match = LOCAL_PLACE_IMAGE.exec(url);
  return match ? `/places/thumbs/${match[1]}` : null;
}

/** 98px 高的小卡片用 320 宽即可。 */
export function mediaThumbnail(url: string): string {
  const base = thumbBase(url);
  return base ? `${base}-320.jpg` : url;
}

/** 详情页 hero：提供 320/640/原图 三档。 */
export function mediaImageProps(url: string): { src: string; srcSet?: string } {
  const base = thumbBase(url);
  if (!base) return { src: url };
  return {
    src: `${base}-640.jpg`,
    srcSet: `${base}-320.jpg 320w, ${base}-640.jpg 640w, ${url} 1280w`,
  };
}
