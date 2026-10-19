# 前端 / 性能 / 交互审计 · 江城图志

审计对象：工作树（未提交改动为准），只读。基线：lint 0 error / 5 warning、tsc 通过、bun test 37 pass。
首屏 = `/`（`app/page.tsx` → `components/map-explorer.tsx`，1443 行 client 组件）。

## 一、量化证据（可复现）

| 指标 | 数值 | 来源 |
|---|---|---|
| 首页 first-load JS | **1.68 MB raw / 493 KB gzip**（12 个 chunk） | 解析 `.next/server/app/index.html` 的 `<script src>` 后逐个 gzip |
| 其中 `36ou2_z9y85hl.js` | **1,158,735 B raw / 317,824 B gzip**，其中 maplibre-gl 约 276 KB gz、gsap 约 28 KB gz（合计占该 chunk 97.5% raw / 96% gz，余下约 29 KB 为 map-explorer 应用代码） | 对照 `maplibre-gl.js` 1,056,837 B→276,110 gz、`gsap.min.js` 72,927 B→28,356 gz；chunk 内含 `LngLat`×91、`cooperativeGestures`×14、`_gsap`×24、`timeline`×16，同时含 `mission-radar-marker`×1、`legend-launcher`×1 |
| maplibre + gsap 占首页 JS | **约 62%（gzip 口径：276 KB + 28 KB / 493 KB）** | 上两行数据 |
| 字体构建产物 | **106 个 `@font-face` / 104 个 woff2 / 4.34 MB** | `.next/static/chunks/1lygnpdpp58b5.css` 解析 |
| 站点文案（源码 + SSR HTML）触发的字体下载 | 唯一汉字 781 个 → 按 `unicode-range` 命中 **27 个 woff2 ≈ 1.35 MB** | 取字集后与 106 条 `unicode-range` 逐个求交 |
| 全站阻塞 CSS | 字体 CSS 95 KB raw / 33.5 KB gz，**每个页面**都加载 | `community-guidelines.html` 实测同样引 3 个 CSS |
| maplibre CSS | 70 KB raw / **10.2 KB gz，每个页面**（含纯文本页） | `app/layout.tsx:3` 全局 import；`2onuoye2b_g2z.css` 含 330 个 `maplibregl-` 规则 |
| Tailwind 实际注入 | 仅 ~7.4 KB raw（`@layer properties` 的 99 个 `--tw-*`），**0 个工具类被使用** | `.next/static/chunks/1mxd4e8iwa1w2.css` 首个应用规则（`.atlas-shell`）前 7,417 B |

---

## P0

### P0-1 首屏 JS 493 KB gz，其中 310 KB 是 maplibre + gsap，且两者被压进同一个 chunk
`components/map-explorer.tsx:3-4` 在文件顶部静态 `import maplibregl from "maplibre-gl"` / `import { gsap } from "gsap"`；
`app/page.tsx:1` 静态 import 该组件且未用 `next/dynamic` 拆包，所以 map+gsap 必然落在首页同步加载链路里。
证据：`36ou2_z9y85hl.js` 同时含 maplibre 与 gsap 标识符，体积 1.16 MB raw / 310 KB gz，被 `index.html` 直接 `<script src>`；对照上游 min 产物，maplibre 约 **276 KB gz**、gsap 约 **28 KB gz**，两者合计占首页 493 KB gz 的 **约 62%**。

**收益**：gsap 全站只用于 3 处 effect、6 次动画调用（`:950`、`:958`、`:980`、`:985`、`:1011`、`:1019`，均为 `autoAlpha/scale` 类装饰动画，`app/globals.css:617-619` 已用纯 CSS 覆盖 reduced-motion），把 gsap 换成 CSS 动画或 `await import("gsap")` 可省 **约 28 KB gz**；把地图初始化改为「骨架/静态首屏 → 空闲时加载 maplibre」，首屏 JS 可从 493 KB 降到 ~180 KB（**-63%**），LCP 从依赖 310 KB 脚本解析转为纯 CSS 绘制。

**改法**（示例）：
```tsx
// components/map-explorer.tsx —— 改为惰性引入，onload 后再建图
const [maplibregl, setMaplibregl] = useState<typeof import("maplibre-gl") | null>(null);
useEffect(() => {
  let alive = true;
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
  const id = idle(() => { void import("maplibre-gl").then((m) => { if (alive) setMaplibregl(m); }); });
  return () => { alive = false; if (typeof id === "number") clearTimeout(id); };
}, []);
```
并同步把 `app/layout.tsx:3` 的 `import "maplibre-gl/dist/maplibre-gl.css"` 移到 map-explorer 内部（或 `app/(map)/layout.tsx`），让非地图页面不再付 10.2 KB gz。

### P0-2 `subsets: ["latin"]` 对中文站点完全无效：构建产出 4.34 MB 字体，首页实际拉 ~1.35 MB
`app/layout.tsx:7-11` 只声明 `subsets: ["latin"]`，但被 `app/globals.css:15,22` 的 `--font-cn` 用作正文首选（中文字形命中即下载）。
证据：构建 CSS 里 **101 个 `Noto Sans SC` face**，其中 87 个覆盖 CJK `U+4E00-9FFF`，合计 **4.12 MB**；`subsets` 只影响是否加 `<link rel=preload>`（首页仅 2 个 preload），**不影响 self-host 与按需下载**。首页可见文本 781 个汉字命中 27 个 subset 文件 = **1.35 MB**，且 `font-display: swap` 会在中文字形下载完成后二次重排（每次 subset 到货都可能触发重排）。

**收益**：改用系统 CJK 栈可省 **1.35 MB 首屏字节 + 33.5 KB gz 阻塞 CSS + 4.34 MB 构建产物 + 消除中文 FOUT/重排**；`--font-cn` 里已有 `"PingFang SC", "Microsoft YaHei"` 兜底，中文观感基本不变。

**改法**（二选一）：
```ts
// 方案 A（最省，推荐）：去掉 Noto_Sans_SC，仅保留 latin 装饰字体
// app/layout.tsx
// 删除 notoSans，<html className={spaceGrotesk.variable}>
// app/globals.css:15
--font-cn: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
```
```bash
# 方案 B（要统一字体时）：按站点实际字集自建子集，产物约 60–150 KB
# 抓取站点文案 → pyftsubset/glyphhanger 生成 woff2，再用 next/font/local 引入
```
若采取方案 B，务必同时把字体 CSS 从 render-blocking 路径移出（`preload: false` 并异步注入样式）。

---

## P1

### P1-1 地图拖动时每帧 `setState`，且每帧改 `left/top` 的是一张 `backdrop-filter: blur(26px)` 卡片
`components/map-explorer.tsx:921-931`：`map.on("move", updatePosition)` 内 `map.project()` + `setDetailPosition({x,y})`，拖拽/惯性期间可达 60 fps；消费点在 `:1277`、`:1320` 的 `style={{ left: detailPosition.x, top: detailPosition.y }}`；卡片样式见 `app/globals.css:210,219-220`（`backdrop-filter: blur(26px)`）。
`reactCompiler` 已开启，JSX 子树会被自动 memo，但「每帧一次 React 渲染 + 一次 `left/top` 触发 backdrop-filter 区域重绘」的开销仍在（blur 面板逐帧重采样是明确的掉帧来源）；`:1138` 的 `places.filter(...)`×8 分类计数也在渲染体内。

**收益**：拖动/缩放期间掉帧明显减少（从每帧一次 React commit + blur 重绘，降到 0 次 React 渲染、纯 transform/合成）。
**改法**：把详情卡改成「只定位一次的 DOM 节点」——
```tsx
// 用 ref 直写 transform，绕开 React 渲染
const detailElRef = useRef<HTMLElement>(null);
useEffect(() => { /* 在 move 回调里 */ detailElRef.current?.style.setProperty(
  "transform", `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, calc(-100% - 20px))`); }, []);
```
或直接用 `new maplibregl.Marker({ element: detailNode })` 承载详情卡（MapLibre 自己按帧更新，无 React 参与）。同时给卡片在拖动期间加 `will-change: transform` 并避免每帧改 `left/top`。

### P1-2 模态/菜单无焦点管理，键盘用户会被困在背景页面
- `components/community-auth-modal.tsx:56` `role="dialog" aria-modal="true"`，但**无焦点陷阱、无 Esc 关闭、打开时不移动焦点**（`role="presentation"` 的遮罩只处理 `onMouseDown`，`:53`）。lint 亦报 `prefer-tag-over-role`。
- `components/map-explorer.tsx:1071-1090` `role="menu"` / `role="menuitem"` 自建菜单：打开不聚焦、无方向键、无 Esc、关闭不归还焦点。
- 详情面板 `:1276-1317`、`:1319-1404` 是 `aria-live="polite"` 的整块内容（含 `ActivityDiscussion` 全部留言），选中地点时读屏会整段播报，而 `detail-close`（`:1278`）焦点不可达。

**收益**：可键盘完成「登录/报名/关闭详情」全流程，读屏不再被上千字打断。
**改法**：`<dialog>` + `showModal()`（自带焦点陷阱与 Esc，也满足 lint 的 `prefer-tag-over-role`）；菜单用 `onKeyDown` 处理 `ArrowUp/Down/Escape` 并把 `aria-live` 从详情卡移到一行 `role="status"` 摘要。

### P1-3 任意一次地图错误都永久显示「底图暂时无法加载」
`components/map-explorer.tsx:853-856` 对**所有** `error` 事件 `setMapError(true)`，而 `mapError` 没有任何复位路径（`1413` 的提示常驻）。MapLibre 的 `error` 覆盖瓦片 404、sprite 缺图、矿点字体等瞬时/局部失败——弱网手机上极易误报。
**收益**：消除误报横幅；同时避免每次瓦片错误触发一次全组件渲染。
**改法**：只在 `map.on("style.load")` 未发生、或连续 N 次错误时置位；加 `errorCount` 与 `setTimeout` 复位，并区分 `event.error?.message`（如 `style` 加载失败才提示刷新）。

### P1-4 深链与浏览器前进/后退不联动
URL 全部由 `window.history.replaceState` 手写（`:344-348`、`:361-364`、`:377-380`），且 `?place=`/`?event=` 只在 `map.on("load")`（`:845-851`）和挂载时（`:1031-1036`）读一次，**全文件无 `popstate` 监听**。
**用户可见后果**：点开地点 → 按浏览器后退 → 详情卡不关闭、URL 与 UI 不一致；直接粘贴 `?place=xxx` 时若 `/api/activities` 尚未返回也会漏掉活动深链。
**改法**：改用 `useSearchParams()` + `router.replace(url, { scroll: false })`，并订阅 `usePathname/useSearchParams` 的变化驱动选中态（App Router 下同一套状态即可支撑前进/后退与分享）。

### P1-5 首屏无骨架、地图色主题在 `load` 之后才应用（可见闪白/闪亮）
`components/map-explorer.tsx:696-697` 在 `load` 之后才跑 `applyMissionMapTheme()`，而 `MAP_STYLE`（`:26`）是第三方亮色 style；页面底色 `#0e1514`（`app/globals.css:27` 的 `.atlas-shell`）与亮色底图之间会出现一次明显跳变；同时容器 `:1040` 在 `mapReady` 之前无任何占位。
**收益**：消除首帧亮色闪变；mapReady 前后视觉连续。
**改法**：`.atlas-map` 上加一层深色占位（纯 CSS 渐晕即可），并把主题应用提前到 `style.load`；或直接换成自定义深色 style JSON，省掉 `applyMissionMapTheme`（`:90-136`）对 style 内**全部 symbol 图层**逐个 `setPaintProperty`/`setLayoutProperty` 的开销——liberty style 的图层数是百级，这段同步循环发生在 `load` 回调里，直接推迟首帧可交互时间。

### P1-6 详情卡为一个 98 px 高的色带下载 237–632 KB 的原图
`components/map-explorer.tsx:1283`（地点）与 `:1325`（差事）把 `imageUrl` 直接写进 `backgroundImage`；承载它的 `.detail-visual` / `.mission-visual` 高度只有 **98 px / 92 px**（`app/globals.css:239,270`，移动端 `:597` 降到 82 px）。
证据：`public/places/*.jpg` 共 9 张、合计 **3.5 MB**，单张 **237 KB（east-lake）～632 KB（yellow-crane-tower）**；无 `srcset`、无预生成缩略图、无 `next/image`。`app/place/[slug]/page.tsx:117` 与 `app/event/[id]/page.tsx:116` 复用同一张原图（那里有注释说明远端图无法走 Workers 按需优化，属于有意选择，但本仓库图片是同源 `public/` 静态资源，不适用该限制）。
**收益**：点开一次地点从最多 **632 KB 降到 ~15–25 KB（-96%）**，且不阻塞详情卡首帧（当前背景图解码在 98 px 容器里做 1280 px 解码，移动端主线程可见卡顿）。
**改法**：构建期生成 `-320.jpg` / `-640.jpg` 变体，卡片用 320 宽即可；或配置 `next.config.ts` 的 `images.loader`（自定义 loader 生成固定尺寸 URL）后改用 `next/image` 并给 `sizes="180px"`。

---

## P2

1. **死代码：`visibleActivities` 计算完全被下一行抵消** —— `:872-874` 构造的数组在 `:875-877` 又 `filter` 掉了 `selectedActivity`，两种分支结果都等价于 `activities`。直接删掉 3 行，改为 `toActivityFeatureCollection(activities.filter(a => a.id !== selectedActivity?.id))`。
2. **`currentTime` 冻结在挂载时刻** —— `:268` `useState(() => Date.now())`，用于 `:1330` 状态文案与 `:1363-1391` 报名按钮「活动进行中」。地图是长驻页面，挂机数小时后状态会失真。改法：`useState` + 每 60 s 定时刷新，或按需读取 `Date.now()`。
3. **`getCoreMapPadding()` 只在建图时算一次** —— `:201-205` 用 `matchMedia("(max-width:760px)")`，`:678` 与 `:406` 各自取值一次；手机横竖屏旋转后 padding 与 maxBounds 不再匹配（`resetCoreView` 还会用旧值）。改法：监听 `matchMedia(...).addEventListener("change")` 后重新 `setPadding`。
4. **`registerMapIcons` 失败会静默废掉整张地图** —— `:241-256` 的 Promise 无 catch，`:699` `await` 一旦 reject：`:701-843` 的所有 layer/layer 事件都不注册、`:844` `setMapReady(true)` 不执行、`:845-851` 深链失效，且产生未处理的 Promise rejection。改法：`await registerMapIcons(map).catch((e) => console.warn(...))`，把 `setMapReady(true)` 移到 await 之前或用 `finally`。
5. **`notifications-panel` / `activity-discussion` 卸载后仍可能 setState** —— `components/notifications-panel.tsx:9-18` 与 `components/activity-discussion.tsx:20-34` 的 fetch 无 `AbortController`（对比 `map-explorer.tsx:628-642` 已正确使用）。快速开关面板时会产生无用渲染与「操作已卸载组件」风险。
6. **Tailwind v4 引入但 0 工具类使用** —— `app/globals.css:1` `@import "tailwindcss"` + `postcss.config.mjs`，实测 className 中无任何工具类（唯一疑似命中是 `legend-category-grid` 里的 `grid` 子串）。成本：~7.4 KB raw 的 `@layer properties`，其中 `*,:before,:after,::backdrop` 上声明 99 个 `--tw-*` 自定义属性——字节不大，但在大 DOM 上会拖慢样式重算。若继续手写 CSS，建议移除 Tailwind；若保留，则应开始真正使用它。
7. **`globals.css` 死代码极少（结论：总体健康）** —— 124 个类名中仅 `mission-cta` 无引用；`status-cancelled/status-completed` 由 `components/my-activities-panel.tsx:113` 动态拼接，`maplibregl-ctrl-*` 由 MapLibre 生成，均非死代码。重复选择器只有 2 处（`.my-activities-panel`、`.legend-result-list > button`），建议合并。
8. **lint 5 条 warning 逐条定性**：`map-explorer.tsx:1051`（brand 按钮「缺少标签」）为**误报**（按钮内有 `江城图志` 文本），但该按钮行为是「重置到全图」（`:1051` → `resetCoreView`），建议补 `aria-label="返回全图视图"` 让读屏知道动作；`:1414` `role="group"` 可用 `<fieldset>`/`<div>` 语义化替代；`community-auth-modal.tsx:56` 见 P1-2；`admin-console.tsx:214` `autoFocus` 建议移除；`next.config.ts:4` 的 floating promise 用 `void` 包一下即可。

---

## 三、已核对、**不构成问题**（避免误报）

- **地图不会被重复创建**：`:861` 的依赖 `[focusActivity, focusPlace]` 两者都是 `useCallback(..., [])`（`:351-381`），引用稳定；StrictMode 下也有 `:668` 的 `mapRef.current` 守卫与 `:857-860` 的 `map.remove()` 清理。
- **监听器清理完整**：图层 click/mouseenter/mouseleave（`:814-843`）挂在 map 实例上，随 `map.remove()` 一并释放；创建面板的落点拾取监听 `off` 正确且还原了 cursor 与 class（`:903-907`）；`move`/`resize`（`:928-931`）成对释除。
- **GSAP 无泄漏**：三处动画都用 `gsap.context(..., scope)` 且 `context.revert()`（`:969-973`、`:1004`、`:1028`），Marker 在 `:935-936` 与 `:971-972` 双路径移除；`prefers-reduced-motion` 在 `:949`、`:983`、`:1009` 与 `app/globals.css:617-619` 双层覆盖。
- **无需自建 ResizeObserver**：MapLibre 自带容器 resize 监听（dist 中存在 `ResizeObserver`，`trackResize` 选项默认开启）。
- **`dangerouslySetInnerHTML`（`:152-153`）** 只注入本地常量图标路径，无 XSS 面。

## 四、建议修复顺序

1. P0-2 字体（改 1 个文件、风险极低、省 1.35 MB）→ 2. P1-6 详情图缩略图（省最多 632 KB/次点击）→ 3. P0-1 gsap 动态化（省 28 KB gz，易做）→ 4. P1-1 详情卡直写 transform（掉帧体感最明显）→ 5. P1-4 深链/后退 → 6. P1-2 焦点管理 → 7. P0-1 的 maplibre 惰性化（改动最大、收益也最大，需重跑 e2e 与首屏回归）。
