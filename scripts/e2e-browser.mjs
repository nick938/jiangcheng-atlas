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
    "--enable-unsafe-swiftshader",
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

    // 1) 首页：地图 + 创建面板
    console.log("1) 地图首页");
    {
      const page = await openPage(`${BASE}/`);
      try {
        const mapReady = await page.cdp.waitFor("Boolean(document.querySelector('.maplibregl-canvas'))", 25000);
        report(mapReady, "地图实例已创建（WebGL canvas）", "");
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
        const postHref = await page.cdp.evaluate(`(() => {
          const link = document.querySelector('a[href^="/post/"]');
          return link ? link.getAttribute('href') : null;
        })()`);
        report(Boolean(postHref), "列表含帖子链接", String(postHref));
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
