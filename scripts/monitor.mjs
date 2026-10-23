import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const paths = ["/api/health", "/", "/sitemap.xml", "/robots.txt"];

export async function checkEndpoint(url, { health = false, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 4, timeout = 20_000, log = console.log } = {}) {
  const history = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeout),
        redirect: "manual",
        headers: { "User-Agent": "JiangchengAtlas-HealthMonitor/1.0", "Accept": health ? "application/json" : "*/*" },
      });
      const body = await response.text();
      let valid = response.status === 200;
      if (valid && health) {
        try { valid = JSON.parse(body).status === "ok"; } catch { valid = false; }
      }
      result = {
        url, attempt, ok: valid, status: response.status,
        ray: response.headers.get("cf-ray"),
        mitigation: response.headers.get("cf-mitigated"),
        contentType: response.headers.get("content-type"),
        ...(valid ? {} : { body: body.slice(0, 1000) }),
      };
    } catch (error) {
      result = { url, attempt, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    history.push(result);
    log(JSON.stringify(result));
    if (result.ok) return { ...result, history };
    if (attempt < attempts) await sleep(5000);
  }
  return { ...history.at(-1), history };
}

export async function runMonitor(baseUrl, options = {}) {
  const results = [];
  for (const path of paths) {
    results.push(await checkEndpoint(new URL(path, baseUrl).href, { ...options, health: path === "/api/health" }));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runMonitor(process.env.SITE_URL || "https://atlas.sololeveling.top");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(result => `| ${new URL(result.url).pathname} | ${result.ok ? "通过" : "失败"} | ${result.status ?? "网络错误"} | ${result.history.length} |`);
    const details = results.flatMap(result => result.history).filter(result => !result.ok);
    const diagnostic = JSON.stringify(details, null, 2).replaceAll("<", "\\u003c").replaceAll("`", "\\u0060");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 生产健康检查\n\n时间（UTC）：${new Date().toISOString()}\n\n| 路径 | 结果 | HTTP | 尝试次数 |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n${details.length ? `失败尝试详情（包含 Cloudflare Ray ID）：\n\n\`\`\`json\n${diagnostic}\n\`\`\`\n` : ""}`);
  }
  if (results.some(result => !result.ok)) process.exitCode = 1;
}
