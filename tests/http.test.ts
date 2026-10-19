/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  errorLogLine,
  etagMatches,
  isConstraintError,
  isUniqueConstraintError,
  mediaCacheControl,
  mediaContentDisposition,
  mediaContentType,
  normalizeEtag,
} from "@/lib/http";

describe("媒体响应头收敛", () => {
  test("白名单内的图片类型保持原样并可 inline", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
      assert.equal(mediaContentType(type), type);
      assert.equal(mediaContentDisposition(type), "inline");
      assert.equal(mediaContentDisposition(type.toUpperCase()), "inline");
    }
  });

  test("非白名单类型一律 octet-stream + attachment", () => {
    for (const type of ["text/html", "image/svg+xml", "application/javascript", undefined, null, ""]) {
      assert.equal(mediaContentType(type), "application/octet-stream");
      assert.equal(mediaContentDisposition(type), "attachment");
    }
  });

  test("带参数的类型串取主类型，且不因大小写漏判", () => {
    assert.equal(mediaContentType("image/PNG; charset=binary"), "image/png");
    assert.equal(mediaContentDisposition("image/webp; q=1"), "inline");
  });

  test("Cache-Control 去掉控制字符并回退默认值", () => {
    assert.equal(mediaCacheControl("public, max-age=60"), "public, max-age=60");
    assert.equal(mediaCacheControl("public,\r\nmax-age=60"), "public, max-age=60");
    assert.equal(mediaCacheControl(undefined), "public, max-age=31536000, immutable");
    assert.equal(mediaCacheControl("x".repeat(201)), "public, max-age=31536000, immutable");
  });
});

describe("条件请求", () => {
  test("去掉 W/ 与引号后比较", () => {
    assert.equal(normalizeEtag('W/"abc"'), "abc");
    assert.equal(normalizeEtag('"abc"'), "abc");
    assert.equal(etagMatches('"abc"', 'W/"abc"'), true);
    assert.equal(etagMatches("abc", "abc"), true);
    assert.equal(etagMatches("abd", "abc"), false);
  });

  test("支持 * 与逗号列表", () => {
    assert.equal(etagMatches("*", '"abc"'), true);
    assert.equal(etagMatches('"x", W/"abc"', '"abc"'), true);
    assert.equal(etagMatches('"x", "y"', '"abc"'), false);
  });

  test("缺少任一侧都不匹配（避免误回 304）", () => {
    assert.equal(etagMatches(null, '"abc"'), false);
    assert.equal(etagMatches('"abc"', null), false);
    assert.equal(etagMatches("", ""), false);
  });
});

describe("D1 错误分类", () => {
  test("识别唯一约束与主键冲突", () => {
    assert.equal(
      isUniqueConstraintError(new Error("D1_ERROR: UNIQUE constraint failed: users.username: SQLITE_CONSTRAINT")),
      true,
    );
    assert.equal(isUniqueConstraintError("SQLITE_CONSTRAINT_PRIMARYKEY"), true);
    assert.equal(isUniqueConstraintError(new Error("no such table: users")), false);
  });

  test("穿透 cause 链，且不把连接错误当成约束错误", () => {
    const wrapped = new Error("batch failed", { cause: new Error("UNIQUE constraint failed: places.slug") });
    assert.equal(isUniqueConstraintError(wrapped), true);
    assert.equal(isUniqueConstraintError(new Error("D1_ERROR: Network connection lost")), false);
    assert.equal(isUniqueConstraintError(undefined), false);
    assert.equal(isConstraintError(new Error("CHECK constraint failed: capacity")), true);
  });

  test("日志行只包含事件名与错误信息", () => {
    const line = errorLogLine("register_failed", new Error("UNIQUE constraint failed"), { userId: "u1" });
    const parsed = JSON.parse(line) as { event: string; message: string; userId: string };
    assert.equal(parsed.event, "register_failed");
    assert.equal(parsed.message, "UNIQUE constraint failed");
    assert.equal(parsed.userId, "u1");
    assert.equal(line.includes("password"), false);
  });
});