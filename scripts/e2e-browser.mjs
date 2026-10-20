#!/usr/bin/env node
/**
 * 浏览器端真实渲染/交互检查（headless Chrome + CDP，无需安装 Playwright）
 *
 * 覆盖：
 *   - 首页地图是否真的初始化（WebGL canvas）与关键交互（打开创建面板、深链选中地点）
 *   - 内容页是否真的可滚动（scrollHeight vs innerHeight + overflow）
 *   - 社区列表 → 帖子详情 的真实跳转
 *   - 每页未捕获异常 / console.error / CSP 违规
 *   - 可选截图
 *
 * 用法：
 *   node scripts/e2e-browser.mjs --base http://localhost:3000
 *   node scripts/e2e-browser.mjs --base http://localhost:3000 --screenshot /tmp/atlas-shots
 *
 * 依赖：本机 Google Chrome（CHROME_BIN 可覆盖）。使用 `--enable-unsafe-swiftshader` 让
 * headless 也能提供 WebGL2（否则 MapLibre 无法初始化，属于预期环境差异）。
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const BASE = (arg("base", process.env.BASE_URL ?? "http://localhost:3000")).replace(/\/$/, "");
const SHOT_DIR = arg("screenshot", null);
const RUN = Date.now().toString(36);
/** --lite：用 --disable-gpu 启动（模拟无 WebGL 设备），只跑精简模式兜底用例 */
const LITE = argv.includes("--lite");
const BENIGN_CONSOLE = [/Download the React DevTools/, /\[HMR\]/, /\[Fast Refresh\]/, /Download React DevTools/];

let failed = 0;
function report(ok, name, detail = "") {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 25000);
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "evaluate failed");
    }
    return result.result?.value;
  }
  async waitFor(expression, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(`(() => { try { return ${expression}; } catch { return false; } })()`)) return true;
      } catch {
        // 页面导航中，忽略并重试
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return response.json();
}

async function waitForDevtools(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Chrome DevTools 端口未就绪");
}

async function main() {
  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = `/tmp/chrome-e2e-${RUN}`;
  console.log(`\n🌐 浏览器检查 ${BASE}（run ${RUN}）\n`);

  const chrome = spawn(CHROME, [
    "--headless=new",
    "--no-sandbox",
    ...(LITE ? ["--disable-gpu"] : ["--enable-unsafe-swiftshader"]),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=390,844",
    "--hide-scrollbars",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeLog = "";
  chrome.stderr.on("data", (chunk) => {
    chromeLog += chunk.toString();
  });

  async function openPage(url) {
    const target = await fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    return {
      cdp,
      close: async () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => null);
      },
    };
  }

  function collectProblems(cdp) {
    const exceptions = cdp.events
      .filter((event) => event.method === "Runtime.exceptionThrown")
      .map((event) => event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text ?? "exception");
    const consoleErrors = cdp.events
      .filter((event) => event.method === "Runtime.consoleAPICalled" && event.params.type === "error")
      .map((event) => event.params.args.map((item) => item.value ?? item.description ?? "").join(" "))
      .filter((text) => !BENIGN_CONSOLE.some((pattern) => pattern.test(text)));
    const logErrors = cdp.events
      .filter((event) => event.method === "Log.entryAdded" && event.params.entry.level === "error")
      .map((event) => event.params.entry.text)
      .filter((text) => !BENIGN_CONSOLE.some((pattern) => pattern.test(text)));
    return [...exceptions, ...consoleErrors, ...logErrors].filter(Boolean);
  }

  async function visit({ url, name, waitExpression = "document.readyState === 'complete'", expectText = [], scroll = false, screenshot = null }) {
    const page = await openPage(url);
    try {
      const ready = await page.cdp.waitFor(waitExpression, 20000);
      if (!ready) {
        report(false, `${name} 页面加载`, `等待超时：${waitExpression}`);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      const info = await page.cdp.evaluate(`(() => {
        const html = document.documentElement;
        const body = document.body;
        return {
          title: document.title,
          text: (body?.innerText ?? "").slice(0, 40000),
          innerHeight: window.innerHeight,
          scrollHeight: html.scrollHeight,
          htmlOverflow: getComputedStyle(html).overflow,
          bodyOverflow: body ? getComputedStyle(body).overflow : "",
        };
      })()`);
      const problems = collectProblems(page.cdp);
      const missing = expectText.filter((text) => !info.text.includes(text));
      report(missing.length === 0, `${name} 渲染`, `title=${JSON.stringify(info.title)}${missing.length ? ` 缺少文案=${missing.join(",")}` : ""}`);
      report(problems.length === 0, `${name} 无控制台错误`, problems.slice(0, 3).join(" | "));
      if (scroll) {
        const needsScroll = info.scrollHeight > info.innerHeight + 1;
        const locked = info.htmlOverflow === "hidden" || info.bodyOverflow === "hidden";
        report(needsScroll ? !locked : true, `${name} 内容可滚动`, `scrollHeight=${info.scrollHeight} innerHeight=${info.innerHeight} htmlOverflow=${info.htmlOverflow} bodyOverflow=${info.bodyOverflow}`);
      }
      if (screenshot && SHOT_DIR) {
        const shot = await page.cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(SHOT_DIR, `${screenshot}.png`), Buffer.from(shot.data, "base64"));
      }
      return { page, info };
    } catch (error) {
      report(false, `${name} 检查`, String(error));
      return null;
    } finally {
      await page.close();
    }
  }

  try {
    await waitForDevtools(port);

    if (LITE) {
      // 无 WebGL 设备：只验证精简模式兜底选点链路
      console.log("Lite 模式（禁用 GPU）");
      const page = await openPage(`${BASE}/`);
      try {
        await page.cdp.waitFor("document.body.innerText.includes('精简模式') || Boolean(document.querySelector('.atlas-map canvas'))", 25000);
        const text = await page.cdp.evaluate("document.body.innerText.slice(0, 20000)");
        report(text.includes("精简模式"), "无 WebGL 时进入精简模式", text.includes("这一页暂时打不开") ? "却出现错误页" : "");
        report(!text.includes("这一页暂时打不开"), "精简模式没有落入错误页", "");
        const opened = await page.cdp.evaluate(`(() => { const button = document.querySelector(".create-event-link"); if (!button) return false; button.click(); return true; })()`);
        report(opened, "精简模式可打开创建面板", "");
        const picked = await page.cdp.evaluate(`(() => {
          const select = document.querySelector('[data-testid="draft-place-select"]');
          if (!select) return null;
          const option = [...select.options].find((item) => item.value && item.value !== "__center");
          if (!option) return null;
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return { value: option.value, label: (option.textContent ?? "").trim() };
        })()`);
        await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 500))");
        const afterPick = await page.cdp.evaluate(`(() => ({
          text: document.body.innerText.slice(0, 20000),
          meetingName: document.querySelector('input[name="meetingName"]')?.value ?? "",
          hasManualInputs: Boolean(document.querySelector('[data-testid="draft-longitude"]') && document.querySelector('[data-testid="draft-latitude"]')),
        }))()`);
        report(Boolean(picked), "精简模式提供地点下拉", JSON.stringify(picked));
        report(afterPick.text.includes("集合位置已选择"), "选择地点后标记为已选择", "");
        report(
          afterPick.meetingName.trim().length > 0 && (picked?.label ?? "").includes(afterPick.meetingName.trim()),
          "选择地点自动带入集合地点名",
          `input=${afterPick.meetingName}`,
        );
        report(afterPick.hasManualInputs, "精简模式提供手填经纬度", "");
        const applied = await page.cdp.evaluate(`(() => {
          const lon = document.querySelector('[data-testid="draft-longitude"]');
          const lat = document.querySelector('[data-testid="draft-latitude"]');
          const button = document.querySelector('[data-testid="apply-coordinates"]');
          if (!lon || !lat || !button) return false;
          lon.value = "114.3020";
          lat.value = "30.6010";
          lon.dispatchEvent(new Event("input", { bubbles: true }));
          lat.dispatchEvent(new Event("input", { bubbles: true }));
          button.click();
          return true;
        })()`);
        await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 500))");
        const manualText = await page.cdp.evaluate("document.body.innerText.slice(0, 20000)");
        report(applied && (manualText.includes("集合位置已选择") || manualText.includes("已更新")), "手填坐标可应用", "");
        const problems = collectProblems(page.cdp);
        report(problems.length === 0, "精简模式无控制台错误", problems.slice(0, 3).join(" | "));
        if (SHOT_DIR) {
          const shot = await page.cdp.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(SHOT_DIR, "home-lite.png"), Buffer.from(shot.data, "base64"));
        }
      } finally {
        await page.close();
      }
    } else {

    // 1) 首页：地图 + 创建面板
    console.log("1) 地图首页");
    {
      const page = await openPage(`${BASE}/`);
      try {
        const mapReady = await page.cdp.waitFor("Boolean(document.querySelector('.maplibregl-canvas'))", 25000);
        report(mapReady, "地图实例已创建（WebGL canvas）", "");
        const mapSize = await page.cdp.evaluate(`(() => {
          const canvas = document.querySelector(".maplibregl-canvas");
          const box = document.querySelector(".atlas-map");
          return {
            canvasW: canvas?.clientWidth ?? 0, canvasH: canvas?.clientHeight ?? 0,
            boxW: box?.clientWidth ?? 0, boxH: box?.clientHeight ?? 0,
            innerW: window.innerWidth, innerH: window.innerHeight,
          };
        })()`);
        // maplibre-gl.css 的 .maplibregl-map{position:relative} 曾把容器压成 0 高：canvas 会退回默认 300px
        report(
          mapSize.boxH > 200 && mapSize.canvasH > 200 && mapSize.canvasW > 300,
          "地图容器铺满视口（canvas 非默认 300 高）",
          JSON.stringify(mapSize),
        );
        // MapLibre 在 Web Worker 里拉样式与瓦片，主线程 performance entries 看不到；
        // 用 attribution 控件证明样式解析成功（无头 SwiftShader 不保证截图里能看到瓦片画面）。
        // 样式是异步加载的：等 attribution（来自 style JSON）出现，证明远端样式真正解析成功
        const styleLoaded = await page.cdp.waitFor(
          "document.body.textContent.includes('OpenFreeMap')",
          20000,
        );
        report(styleLoaded, "地图样式已加载（attribution 出现）", "");
        await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 800))");
        const info = await page.cdp.evaluate(`(() => ({
          text: document.body.innerText.slice(0, 20000),
          title: document.title,
        }))()`);
        report(info.text.includes("江城图志") && info.text.includes("创建差事"), "首页关键文案渲染", JSON.stringify(info.title));
        report(!info.text.includes("这一页暂时打不开"), "首页没有落入错误页", "");
        const problems = collectProblems(page.cdp);
        report(problems.length === 0, "首页无控制台错误", problems.slice(0, 3).join(" | "));

        const opened = await page.cdp.evaluate(`(() => {
          const button = document.querySelector(".create-event-link");
          if (!button) return false;
          button.click();
          return true;
        })()`);
        const panelVisible = opened && await page.cdp.waitFor("Boolean(document.querySelector('.create-event-panel'))", 5000);
        report(panelVisible, "点击「创建差事」打开面板", "");
        const notice = await page.cdp.evaluate("document.body.innerText.includes('集合位置')");
        report(notice, "创建面板提示地图选点", "");

        // 用大一点的视口做选点交互（避免创建面板遮住要点的地图区域）
        await page.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
        await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 700))");
        // 选一个真正落在 .atlas-map 上、且没有被浮层挡住的点（生产上固定坐标会被提示条/面板吃掉）
        const clickTarget = await page.cdp.evaluate(`(() => {
          const box = document.querySelector(".atlas-map")?.getBoundingClientRect();
          if (!box) return null;
          const candidates = [
            [box.left + box.width * 0.35, box.top + box.height * 0.55],
            [box.left + box.width * 0.3, box.top + box.height * 0.35],
            [box.left + box.width * 0.5, box.top + box.height * 0.3],
            [box.left + box.width * 0.4, box.top + box.height * 0.7],
          ];
          for (const [x, y] of candidates) {
            const el = document.elementFromPoint(x, y);
            if (el && (el.tagName === "CANVAS" || el.closest(".atlas-map"))) {
              return { x: Math.round(x), y: Math.round(y), hit: String(el.className || el.tagName) };
            }
          }
          return null;
        })()`);
        let markerAppeared = false;
        if (clickTarget) {
          for (let attempt = 1; attempt <= 3 && !markerAppeared; attempt += 1) {
            await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: clickTarget.x, y: clickTarget.y, button: "left", buttons: 1, clickCount: 1 });
            await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickTarget.x, y: clickTarget.y, button: "left", buttons: 0, clickCount: 1 });
            markerAppeared = await page.cdp.waitFor("Boolean(document.querySelector('.draft-location-marker'))", 4000);
            if (!markerAppeared) await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 300))");
          }
        }
        report(markerAppeared, "地图点击后出现集合旗标", JSON.stringify(clickTarget));
        const pickedState = await page.cdp.evaluate("document.body.innerText.includes('集合位置已选择')");
        report(pickedState, "创建面板标记「集合位置已选择」", "");

        // 拖拽旗标微调：位置或提示发生变化即视为成功
        const markerRect = await page.cdp.evaluate(`(() => {
          const el = document.querySelector(".draft-location-marker");
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, transform: el.style.transform };
        })()`);
        if (markerRect) {
          const startX = Math.round(markerRect.x);
          const startY = Math.round(markerRect.y);
          await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1 });
          for (let step = 1; step <= 5; step += 1) {
            await page.cdp.send("Input.dispatchMouseEvent", {
              type: "mouseMoved", x: startX + step * 14, y: startY + step * 9, button: "left", buttons: 1,
            });
          }
          await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: startX + 70, y: startY + 45, button: "left", buttons: 0, clickCount: 1 });
          await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 500))");
          const dragResult = await page.cdp.evaluate(`(() => ({
            transform: document.querySelector(".draft-location-marker")?.style.transform ?? "",
            text: document.body.innerText.slice(0, 20000),
          }))()`);
          report(
            dragResult.transform !== markerRect.transform || dragResult.text.includes("集合位置已更新"),
            "旗标可拖拽微调",
            `before=${markerRect.transform} after=${dragResult.transform}`,
          );
        } else {
          report(false, "旗标可拖拽微调", "找不到 .draft-location-marker");
        }

        // 常态显示的「从已收录地点选择」下拉：选一个地点，坐标与集合地点名都应被带入
        const placePick = await page.cdp.evaluate(`(() => {
          const select = document.querySelector('[data-testid="draft-place-select"]');
          if (!select) return null;
          const option = [...select.options].find((item) => item.value && item.value !== "__center");
          if (!option) return null;
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return { value: option.value, label: (option.textContent ?? "").trim() };
        })()`);
        await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 500))");
        const meetingNameValue = await page.cdp.evaluate(`document.querySelector('input[name="meetingName"]')?.value ?? ""`);
        report(
          Boolean(placePick) && meetingNameValue.trim().length > 0 && (placePick?.label ?? "").includes(meetingNameValue.trim()),
          "从地点下拉选择会带入坐标与集合地点名",
          `option=${placePick?.label ?? "<无>"} input=${meetingNameValue}`,
        );
        if (SHOT_DIR) {
          const shot = await page.cdp.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(SHOT_DIR, "home-map.png"), Buffer.from(shot.data, "base64"));
        }
      } finally {
        await page.close();
      }
    }

    // 2) 深链：/?place=east-lake 打开地点详情
    console.log("\n2) 深链与详情卡");
    {
      const page = await openPage(`${BASE}/?place=east-lake`);
      try {
        const panel = await page.cdp.waitFor("Boolean(document.querySelector('.place-detail'))", 25000);
        report(panel, "深链 ?place=east-lake 打开地点详情", "");
        const text = await page.cdp.evaluate("document.querySelector('.place-detail')?.innerText ?? ''");
        report(text.includes("东湖"), "详情卡内容来自地点数据", text.slice(0, 40).replace(/\n/g, " "));
        // 等 gsap 入场动画与 flyTo 结束，测“稳定态”的位置
        await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 2600))");
        const rect = await page.cdp.evaluate(`(() => {
          const el = document.querySelector(".place-detail");
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), innerW: window.innerWidth, innerH: window.innerHeight, cardH: Math.round(r.height), inlineTransform: el.style.transform, computedTransform: getComputedStyle(el).transform };
        })()`);
        const fullyVisible = rect && rect.top >= -1 && rect.bottom <= rect.innerH + 1 && rect.left >= -1 && rect.right <= rect.innerW + 1;
        report(fullyVisible, "详情卡完整落在视口内（深链首屏）", JSON.stringify(rect));
        const clicked = await page.cdp.evaluate(`(() => { const b = document.querySelector('.detail-close'); if (!b) return false; b.click(); return true; })()`);
        const closed = clicked && await page.cdp.waitFor("!document.querySelector('.place-detail')", 5000);
        report(closed, "关闭详情卡", "");
        const urlAfter = await page.cdp.evaluate("location.href");
        report(!urlAfter.includes("place="), "关闭后 URL 清理 place 参数", urlAfter.replace(BASE, ""));
      } finally {
        await page.close();
      }
    }

    // 3) 地点 / 隐私 / 社区公约页滚动
    console.log("\n3) 内容页滚动");
    for (const item of [
      { path: "/place/east-lake", name: "地点分享页", expectText: ["东湖"], shot: "place" },
      { path: "/privacy", name: "隐私页", expectText: ["隐私"], shot: "privacy" },
      { path: "/community-guidelines", name: "社区公约", expectText: ["社区"], shot: "guidelines" },
    ]) {
      await visit({ url: `${BASE}${item.path}`, name: item.name, expectText: item.expectText, scroll: true, screenshot: item.shot });
    }

    // 4) 社区列表 → 帖子详情
    console.log("\n4) 社区发帖流程");
    {
      const page = await openPage(`${BASE}/community`);
      try {
        const ready = await page.cdp.waitFor("document.body.innerText.includes('社区')", 25000);
        report(ready, "社区列表渲染", "");
        const problems = collectProblems(page.cdp);
        report(problems.length === 0, "社区列表无控制台错误", problems.slice(0, 3).join(" | "));
        // 生产环境可能还没有任何帖子：先探一下接口，空态时跳过帖子详情链路（避免误报）
        const feedCount = await page.cdp.evaluate(`fetch("/api/posts?limit=1", { cache: "no-store" })
          .then((response) => response.json())
          .then((payload) => (Array.isArray(payload.posts) ? payload.posts.length : -1))
          .catch(() => -1)`);
        let postHref = null;
        if (feedCount === 0) {
          const emptyText = await page.cdp.evaluate("document.body.innerText.slice(0, 20000)");
          report(/还没有|第一帖|暂无|空/.test(emptyText), "社区空态正常（当前无帖子，跳过帖子详情链路）", "");
        } else {
          postHref = await page.cdp.evaluate(`(() => {
            const link = document.querySelector('a[href^="/post/"]');
            return link ? link.getAttribute('href') : null;
          })()`);
          report(Boolean(postHref), "列表含帖子链接", String(postHref));
        }
        if (SHOT_DIR) {
          const shot = await page.cdp.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(SHOT_DIR, "community-list.png"), Buffer.from(shot.data, "base64"));
        }
        if (postHref) {
          await page.cdp.send("Page.navigate", { url: `${BASE}${postHref}` });
          await page.cdp.waitFor("document.readyState === 'complete'", 20000);
          await page.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 800))");
          const detail = await page.cdp.evaluate(`(() => ({
            text: document.body.innerText.slice(0, 20000),
            title: document.title,
            hasCommentArea: document.body.innerText.includes("评论") || Boolean(document.querySelector("textarea")),
            scrollHeight: document.documentElement.scrollHeight,
            innerHeight: window.innerHeight,
            htmlOverflow: getComputedStyle(document.documentElement).overflow,
            bodyOverflow: getComputedStyle(document.body).overflow,
          }))()`);
          const detailProblems = collectProblems(page.cdp);
          report(detail.text.length > 40, "帖子详情页渲染正文", `title=${JSON.stringify(detail.title)} textLen=${detail.text.length}`);
          report(detail.hasCommentArea, "帖子详情页有评论区", "");
          report(detailProblems.length === 0, "帖子详情页无控制台错误", detailProblems.slice(0, 3).join(" | "));
          const detailNeedsScroll = detail.scrollHeight > detail.innerHeight + 1;
          const detailLocked = detail.htmlOverflow === "hidden" || detail.bodyOverflow === "hidden";
          report(detailNeedsScroll ? !detailLocked : true, "帖子详情页可滚动", `scrollHeight=${detail.scrollHeight} innerHeight=${detail.innerHeight} 内容是否需要滚动=${detailNeedsScroll}`);
          if (SHOT_DIR) {
            const shot = await page.cdp.send("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(SHOT_DIR, "post-detail.png"), Buffer.from(shot.data, "base64"));
          }
        }
      } finally {
        await page.close();
      }
    }
    }
  } catch (error) {
    report(false, "浏览器检查运行", String(error));
    console.error(chromeLog.split("\n").filter((line) => /CONSOLE|DevTools|Uncaught/i.test(line)).slice(0, 10).join("\n"));
  } finally {
    try {
      chrome.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  console.log(`\n${failed === 0 ? "✅" : "❌"} 浏览器检查完成：${failed} 处失败\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("浏览器检查异常：", error);
  process.exitCode = 1;
});
