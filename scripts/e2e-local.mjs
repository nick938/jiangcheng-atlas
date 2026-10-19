#!/usr/bin/env node
/**
 * 本地端到端流程验证（真实运行环境：Next dev 或 OpenNext preview + 本地 D1/R2）
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:3000 node scripts/e2e-local.mjs
 *   BASE_URL=http://127.0.0.1:8787 node scripts/e2e-local.mjs   # opennextjs-cloudflare preview
 *
 * 依赖：
 *   - 服务端已启动，且本地 D1 已迁移（bun run db:migrate:local）
 *   - 服务端进程能读到 .dev.vars（ADMIN_PASSWORD 等）
 *   - 社区帖子功能若尚未实现，会显示为 SKIP，不影响其它用例
 *
 * 退出码：0 = 全部通过；1 = 有失败
 */

import { readFileSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ORIGIN = process.env.E2E_ORIGIN ?? BASE;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const results = [];
let failed = 0;

function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  failed += 1;
  results.push({ ok: false, name, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}
function skip(name, reason = "") {
  results.push({ ok: true, skipped: true, name, detail: reason });
  console.log(`  ⏭️  ${name}${reason ? ` — ${reason}` : ""}`);
}
function check(name, condition, detail = "") {
  if (condition) pass(name, detail);
  else fail(name, detail);
  return Boolean(condition);
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
  }

  async req(path, { method = "GET", json, form, headers = {}, omitOrigin = false, redirect = "manual" } = {}) {
    const h = { ...headers };
    let body;
    if (json !== undefined) {
      h["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      body = form;
    }
    if (!omitOrigin && method !== "GET" && method !== "HEAD" && !h.Origin) h.Origin = ORIGIN;
    if (this.cookies.size > 0) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(`${BASE}${path}`, { method, headers: h, body, redirect });
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /Max-Age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async json(path, options) {
    const response = await this.req(path, options);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data, headers: response.headers };
  }
}

function futureIso(hoursFromNow, durationHours = 2) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const end = new Date(start.getTime() + durationHours * 3600_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function pngForm(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("image", new File([TINY_PNG], "cover.png", { type: "image/png" }));
  return form;
}

let adminClientPromise = null;
function getAdminClient(password) {
  if (!adminClientPromise) {
    adminClientPromise = (async () => {
      const client = new Client("admin");
      await client.json("/api/admin/session", { method: "POST", json: { password } });
      return client;
    })();
  }
  return adminClientPromise;
}

function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const match = text.match(/^ADMIN_PASSWORD=(.*)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n🔎 E2E ${BASE}（run ${RUN}）\n`);

  // ---------- 1. 基础可用性 ----------
  console.log("1. 基础可用性");
  {
    const response = await fetch(`${BASE}/api/health`);
    const data = await response.json().catch(() => null);
    check("GET /api/health → 200 ok", response.status === 200 && data?.status === "ok", JSON.stringify(data));

    const home = await fetch(`${BASE}/`);
    const html = await home.text();
    check("GET / → 200 且站点文案存在", home.status === 200 && html.includes("江城图志"), `status=${home.status}`);

    const places = await (await fetch(`${BASE}/api/places`)).json().catch(() => null);
    check("GET /api/places → 有地点数据", Array.isArray(places?.places) && places.places.length > 0, `count=${places?.places?.length}`);
  }

  // ---------- 2. 注册 / 会话 ----------
  console.log("\n2. 注册与会话");
  const alice = new Client("alice");
  const bob = new Client("bob");
  const carol = new Client("carol");
  const credentials = {
    alice: { username: `e2e_a_${RUN}`.slice(0, 24), displayName: "E2E 测试甲", password: "e2e-password-123" },
    bob: { username: `e2e_b_${RUN}`.slice(0, 24), displayName: "E2E 测试乙", password: "e2e-password-123" },
    carol: { username: `e2e_c_${RUN}`.slice(0, 24), displayName: "E2E 测试丙", password: "e2e-password-123" },
  };
  {
    for (const [key, client] of Object.entries({ alice, bob, carol })) {
      const { status } = await client.json("/api/auth/register", { method: "POST", json: credentials[key] });
      check(`注册 ${key} → 201`, status === 201, `status=${status}`);
    }
    const { status, data } = await alice.json("/api/auth/session");
    check("GET /api/auth/session → 当前用户正确", status === 200 && data?.user?.username === credentials.alice.username);
    const badOrigin = await fetch(`${BASE}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "x" }),
    });
    check("无 Origin 的写请求 → 403（CSRF 防护）", badOrigin.status === 403, `status=${badOrigin.status}`);
  }

  // ---------- 3. 活动生命周期 ----------
  console.log("\n3. 活动生命周期");
  let activityId = null;
  {
    const { startsAt, endsAt } = futureIso(48);
    const created = await alice.json("/api/activities", {
      method: "POST",
      json: {
        activityType: "walk",
        title: `E2E 测试活动 ${RUN}`,
        details: "自动化测试创建的活动，用于验证创建、报名、评论、导出与治理流程。",
        startsAt,
        endsAt,
        meetingName: "东湖绿道梨园入口",
        meetingLongitude: 114.386,
        meetingLatitude: 30.5794,
        capacity: 2,
      },
    });
    activityId = created.data?.id ?? null;
    check("创建活动 → 201", created.status === 201 && Boolean(activityId), `status=${created.status}`);

    const list = await (await fetch(`${BASE}/api/activities`)).json().catch(() => null);
    check("活动列表包含新建活动", Array.isArray(list?.activities) && list.activities.some((a) => a.id === activityId));

    const joinBob = await bob.json(`/api/activities/${activityId}/join`, { method: "POST" });
    check("乙报名 → 200", joinBob.status === 200, `status=${joinBob.status}`);
    const joinAgain = await bob.json(`/api/activities/${activityId}/join`, { method: "POST" });
    check("重复报名 → 409", joinAgain.status === 409, `status=${joinAgain.status}`);
    const joinCarol = await carol.json(`/api/activities/${activityId}/join`, { method: "POST" });
    check("满员后第三人报名 → 409（容量上限）", joinCarol.status === 409, `status=${joinCarol.status}`);

    const detail = await (await fetch(`${BASE}/api/activities/${activityId}/comments`)).json().catch(() => null);
    check("评论列表可访问", Array.isArray(detail?.comments), `count=${detail?.comments?.length}`);

    const comment = await bob.json(`/api/activities/${activityId}/comments`, { method: "POST", json: { body: "E2E 评论：周末见！" } });
    check("乙发表评论 → 201", comment.status === 201, `status=${comment.status}`);

    const anonComment = await fetch(`${BASE}/api/activities/${activityId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ body: "未登录评论" }),
    });
    check("未登录评论 → 401", anonComment.status === 401, `status=${anonComment.status}`);

    const calendar = await fetch(`${BASE}/api/activities/${activityId}/calendar`);
    const calendarType = calendar.headers.get("content-type") ?? "";
    check("日历导出 → text/calendar", calendar.status === 200 && calendarType.includes("text/calendar"), calendarType);

    const eventPage = await fetch(`${BASE}/event/${activityId}`);
    const eventHtml = await eventPage.text();
    check("活动分享页 → 200 且含标题", eventPage.status === 200 && eventHtml.includes("E2E 测试活动"), `status=${eventPage.status}`);
  }

  // ---------- 4. 图片上传 / 媒体 ----------
  console.log("\n4. 图片上传与媒体路由");
  let mediaKey = null;
  {
    const { startsAt, endsAt } = futureIso(72);
    const created = await alice.json("/api/activities", {
      method: "POST",
      form: pngForm({
        activityType: "photo",
        title: `E2E 带图活动 ${RUN}`,
        details: "自动化测试创建的带图活动，用于验证 R2 上传与媒体读取。",
        startsAt,
        endsAt,
        meetingName: "汉口江滩",
        meetingLongitude: 114.302,
        meetingLatitude: 30.601,
        capacity: 4,
      }),
    });
    check("创建带图活动 → 201", created.status === 201, `status=${created.status}`);

    const activity = created.data?.id;
    if (activity) {
      // 从分享页 HTML 中拿不到 imageUrl，改从列表接口读取
      const list = await (await fetch(`${BASE}/api/activities`)).json().catch(() => null);
      const found = list?.activities?.find((a) => a.id === activity);
      mediaKey = found?.imageUrl ?? null;
      check("活动列表返回封面 imageUrl", typeof mediaKey === "string" && mediaKey.startsWith("/media/"), String(mediaKey));
    }

    if (mediaKey) {
      const media = await fetch(`${BASE}${mediaKey}`);
      check("GET 媒体 → 200 且 Content-Type=image/png", media.status === 200 && (media.headers.get("content-type") ?? "").includes("image/png"), media.headers.get("content-type") ?? "");
      const etag = media.headers.get("etag");
      check("媒体返回 ETag", Boolean(etag), etag ?? "");
      if (etag) {
        const cached = await fetch(`${BASE}${mediaKey}`, { headers: { "If-None-Match": etag } });
        check("媒体条件请求 → 304", cached.status === 304, `status=${cached.status}`);
      }
      const traversal = await fetch(`${BASE}/media/%2e%2e/%2e%2e/.dev.vars`);
      check("媒体路径穿越被拒绝", traversal.status === 404 || traversal.status === 400, `status=${traversal.status}`);
    }
  }

  // ---------- 5. 举报与管理员治理 ----------
  console.log("\n5. 举报与管理员治理");
  {
    const password = adminPassword();
    if (!password) {
      skip("管理员治理", "未找到 ADMIN_PASSWORD");
    } else {
      const admin = await getAdminClient(password);
      const session = await admin.json("/api/admin/session");
      check("管理员登录与会话 → 200", session.status === 200 && session.data?.authenticated === true, `status=${session.status}`);

      const report = await carol.json("/api/reports", {
        method: "POST",
        json: { targetType: "activity", targetId: activityId, reason: "spam", details: "自动化测试举报" },
      });
      check("丙举报活动 → 201", report.status === 201, `status=${report.status}`);

      const governance = await admin.json("/api/admin/community");
      const reports = governance.data?.reports ?? [];
      const target = reports.find((r) => r.target_id === activityId);
      check("管理员治理列表包含举报", Boolean(target), `reports=${reports.length}`);

      if (target) {
        const resolved = await admin.json("/api/admin/community", {
          method: "PATCH",
          json: { action: "report.resolve", targetId: target.id },
        });
        check("管理员处理举报 → 200", resolved.status === 200, `status=${resolved.status}`);
      }
    }
  }

  // ---------- 6. 分享页 / SEO ----------
  console.log("\n6. 分享页与 SEO");
  {
    const placePage = await fetch(`${BASE}/place/east-lake`);
    const placeHtml = await placePage.text();
    check("地点分享页 → 200 且含地点名", placePage.status === 200 && placeHtml.includes("东湖"), `status=${placePage.status}`);
    check("地点页有 canonical", placeHtml.includes('rel="canonical"'), "");
    check("地点页有 JSON-LD", placeHtml.includes("application/ld+json"), "");

    const notFound = await fetch(`${BASE}/place/definitely-not-a-place-${RUN}`);
    check("不存在的地点 → 404", notFound.status === 404, `status=${notFound.status}`);

    const sitemap = await fetch(`${BASE}/sitemap.xml`);
    const sitemapText = await sitemap.text();
    check("sitemap.xml → 200 且含 urlset", sitemap.status === 200 && sitemapText.includes("<urlset"), `status=${sitemap.status}`);
    check("sitemap 收录地点与活动", sitemapText.includes("/place/") && sitemapText.includes("/event/"), "");

    const robots = await fetch(`${BASE}/robots.txt`);
    const robotsText = await robots.text();
    check("robots.txt → 200 且指向 sitemap", robots.status === 200 && robotsText.includes("sitemap"), `status=${robots.status}`);

    const privatePage = await fetch(`${BASE}/privacy`);
    check("隐私页 → 200", privatePage.status === 200, `status=${privatePage.status}`);
    const guidelines = await fetch(`${BASE}/community-guidelines`);
    check("社区公约页 → 200", guidelines.status === 200, `status=${guidelines.status}`);
  }

  // ---------- 7. 社区发帖（功能未实现时跳过） ----------
  console.log("\n7. 社区发帖");
  {
    const probe = await fetch(`${BASE}/api/posts`);
    if (probe.status === 404) {
      skip("社区发帖流程", "接口尚未实现");
    } else {
      const created = await alice.json("/api/posts", {
        method: "POST",
        json: { title: `E2E 社区帖子 ${RUN}`, body: "自动化测试创建的社区帖子，用于验证发帖、列表、详情、评论与治理流程。", topic: "chat" },
      });
      const postId = created.data?.id ?? null;
      check("发帖 → 201", created.status === 201 && Boolean(postId), `status=${created.status}`);

      const list = await (await fetch(`${BASE}/api/posts`)).json().catch(() => null);
      check("帖子列表包含新帖", Array.isArray(list?.posts) && list.posts.some((p) => p.id === postId));

      const badPost = await alice.json("/api/posts", { method: "POST", json: { title: "短", body: "太短", topic: "chat" } });
      check("超短帖子 → 400", badPost.status === 400, `status=${badPost.status}`);

      const anonPost = await fetch(`${BASE}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ title: "未登录发帖测试", body: "未登录应当被拒绝，这里只是测试文本。", topic: "chat" }),
      });
      check("未登录发帖 → 401", anonPost.status === 401, `status=${anonPost.status}`);

      if (postId) {
        const detailPage = await fetch(`${BASE}/post/${postId}`);
        const detailHtml = await detailPage.text();
        check("帖子详情页 → 200 且含标题", detailPage.status === 200 && detailHtml.includes(`E2E 社区帖子 ${RUN}`), `status=${detailPage.status}`);

        const bobComment = await bob.json(`/api/posts/${postId}/comments`, { method: "POST", json: { body: "E2E 帖子评论：写得好。" } });
        check("帖主以外用户评论 → 201", bobComment.status === 201, `status=${bobComment.status}`);

        const commentId = bobComment.data?.id;
        const forbidden = await carol.json(`/api/posts/${postId}/comments?comment=${commentId}`, { method: "DELETE" });
        check("删除他人评论 → 403", forbidden.status === 403, `status=${forbidden.status}`);
        const hidden = await bob.json(`/api/posts/${postId}/comments?comment=${commentId}`, { method: "DELETE" });
        check("删除自己的评论 → 200", hidden.status === 200, `status=${hidden.status}`);

        const report = await carol.json("/api/reports", {
          method: "POST",
          json: { targetType: "post", targetId: postId, reason: "spam" },
        });
        check("举报帖子 → 201", report.status === 201, `status=${report.status}`);

        const adminPasswordValue = adminPassword();
        if (adminPasswordValue) {
          const admin = await getAdminClient(adminPasswordValue);
          const listed = await admin.json("/api/admin/community");
          check("治理后台返回帖子列表", Array.isArray(listed.data?.posts), `count=${listed.data?.posts?.length}`);
          const hide = await admin.json("/api/admin/community", { method: "PATCH", json: { action: "post.hide", targetId: postId } });
          check("管理员隐藏帖子 → 200", hide.status === 200, `status=${hide.status}`);
          const gone = await fetch(`${BASE}/api/posts/${postId}`);
          check("隐藏后帖子接口 → 404", gone.status === 404, `status=${gone.status}`);
          const gonePage = await fetch(`${BASE}/post/${postId}`);
          check("隐藏后帖子页面 → 404", gonePage.status === 404, `status=${gonePage.status}`);
          const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
          check("sitemap 收录 /community", sitemap.includes("/community"), "");
        }
      }

      // 带图发帖
      const imagePost = await alice.json("/api/posts", {
        method: "POST",
        form: (() => {
          const form = new FormData();
          form.set("title", `E2E 带图帖子 ${RUN}`);
          form.set("body", "自动化测试创建的带图帖子，用于验证帖子封面图上传与读取流程。");
          form.set("topic", "photo");
          form.set("image", new File([TINY_PNG], "post.png", { type: "image/png" }));
          return form;
        })(),
      });
      check("带图发帖 → 201", imagePost.status === 201, `status=${imagePost.status}`);
      if (imagePost.data?.id) {
        const listAfter = await (await fetch(`${BASE}/api/posts`)).json().catch(() => null);
        const createdPost = listAfter?.posts?.find((p) => p.id === imagePost.data.id);
        const imageUrl = createdPost?.imageUrl ?? null;
        check("帖子详情返回封面图 URL", typeof imageUrl === "string" && imageUrl.startsWith("/media/posts/"), String(imageUrl));
        if (imageUrl) {
          const media = await fetch(`${BASE}${imageUrl}`);
          check("帖子封面可访问且为图片", media.status === 200 && (media.headers.get("content-type") ?? "").includes("image/png"), `status=${media.status}`);
        }
      }
    }
  }

  // ---------- 8. 用户资料 / 通知 ----------
  console.log("\n8. 用户资料与通知");
  {
    const profile = await bob.json("/api/profile", { method: "PATCH", json: { displayName: "E2E 测试乙改" } });
    check("修改昵称 → 200", profile.status === 200, `status=${profile.status}`);

    const notifications = await alice.json("/api/notifications");
    const items = notifications.data?.notifications ?? [];
    check("发帖人收到站内通知", notifications.status === 200 && items.length > 0, `count=${items.length}`);
    const read = await alice.json("/api/notifications", { method: "PATCH" });
    check("标记通知已读 → 200", read.status === 200, `status=${read.status}`);

    const logout = await bob.json("/api/auth/session", { method: "DELETE" });
    check("退出登录 → 200", logout.status === 200, `status=${logout.status}`);
    const after = await bob.json("/api/auth/session");
    check("退出后会话为空", after.data?.user === null);
  }

  // ---------- 汇总 ----------
  const skipped = results.filter((item) => item.skipped).length;
  console.log(`\n${failed === 0 ? "✅" : "❌"} E2E 完成：${results.length - failed - skipped} 通过 / ${failed} 失败 / ${skipped} 跳过\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nE2E 运行异常：", error);
  process.exitCode = 1;
});
