export async function readJsonBody<T>(request: Request, maxBytes = 8192): Promise<T | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 媒体响应（app/media/[...key]/route.ts 的读取侧）
 *
 * 上传侧（lib/image-upload.ts）已经校验 MIME 与魔数，但 R2 桶里的对象
 * 也可能来自备份恢复（wrangler r2 object put）、控制台手工上传或未来的
 * 新入口。读取侧因此不能信任存储的元数据，必须再做一次白名单收敛，
 * 否则一个 text/html 对象就能在主站同源下执行脚本。
 * ------------------------------------------------------------------ */

const inlineMediaTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

const defaultMediaCacheControl = "public, max-age=31536000, immutable";

function cleanHeaderValue(value: string | null | undefined) {
  return (value ?? "").replace(/[\r\n\t\0]+/g, " ").trim();
}

function baseMediaType(raw: string | null | undefined) {
  return cleanHeaderValue(raw).split(";")[0]?.trim().toLowerCase() ?? "";
}

/** 只返回白名单内的图片类型，其余一律 application/octet-stream。 */
export function mediaContentType(raw: string | null | undefined): string {
  const value = baseMediaType(raw);
  return inlineMediaTypes.has(value) ? value : "application/octet-stream";
}

/** 只有白名单图片类型才允许 inline 展示，其余强制下载。 */
export function mediaContentDisposition(raw: string | null | undefined): "inline" | "attachment" {
  return inlineMediaTypes.has(baseMediaType(raw)) ? "inline" : "attachment";
}

/** 存储的 Cache-Control 会去掉控制字符；缺失或异常时回退到长效公共缓存。 */
export function mediaCacheControl(raw: string | null | undefined): string {
  const value = cleanHeaderValue(raw);
  return value && value.length <= 200 ? value : defaultMediaCacheControl;
}

/** 去掉 W/ 前缀与引号，便于弱比较。 */
export function normalizeEtag(value: string | null | undefined): string {
  const trimmed = cleanHeaderValue(value);
  const withoutWeak = trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed;
  return withoutWeak.replace(/^"+|"+$/g, "");
}

/** 按 RFC 9110 的 If-None-Match 语义做弱比较（支持 * 与逗号列表）。 */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string | null | undefined): boolean {
  const target = normalizeEtag(etag);
  if (!ifNoneMatch || !target) return false;
  return ifNoneMatch
    .split(",")
    .map((candidate) => normalizeEtag(candidate))
    .some((candidate) => candidate === "*" || candidate === target);
}

/* ------------------------------------------------------------------ *
 * 错误分类：把「唯一约束冲突」这类可预期的客户端错误与真正的服务端
 * 故障分开，避免把连接错误也报成「账号已被使用」。
 * ------------------------------------------------------------------ */

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (current instanceof Error) parts.push(current.name, current.message);
    else if (typeof current === "object") {
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string") parts.push(message);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" ").toUpperCase();
}

/** D1/SQLite 的唯一约束（含主键）冲突。 */
export function isUniqueConstraintError(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("UNIQUE CONSTRAINT FAILED")
    || text.includes("SQLITE_CONSTRAINT_UNIQUE")
    || text.includes("SQLITE_CONSTRAINT_PRIMARYKEY");
}

/** 任意 D1/SQLite 约束错误（NOT NULL / CHECK / FOREIGN KEY 等）。 */
export function isConstraintError(error: unknown): boolean {
  const text = errorText(error);
  // SQLite 的约束错误文案有两种形态："CHECK constraint failed: x"（无前缀）
  // 与 D1 在末尾附加的 ": SQLITE_CONSTRAINT"。
  return text.includes("SQLITE_CONSTRAINT") || text.includes("CONSTRAINT FAILED");
}

/** 结构化错误日志行：只带事件名与错误信息，便于 Observability 检索。 */
export function errorLogLine(event: string, error: unknown, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    event,
    message: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}
