/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loginFailureLogLine, requestRateLimitKey, userActionRateLimitKey, userLoginRateLimitKey } from "@/lib/user-auth";

describe("限流键", () => {
  test("登录键按账号归一化大小写，避免换大小写绕过计数", () => {
    assert.equal(userLoginRateLimitKey("Rider"), "user-login:rider");
    assert.equal(userLoginRateLimitKey("rider"), userLoginRateLimitKey("RIDER"));
  });

  test("写操作键按用户隔离", () => {
    assert.equal(userActionRateLimitKey("u1"), "user-action:u1");
    assert.notEqual(userActionRateLimitKey("u1"), userActionRateLimitKey("u2"));
  });

  test("IP 维度键带作用域前缀，不同入口互不占用配额", () => {
    assert.equal(requestRateLimitKey("wechat-start", "1.2.3.4"), "wechat-start:1.2.3.4");
    assert.notEqual(requestRateLimitKey("wechat-start", "1.2.3.4"), requestRateLimitKey("wechat-callback", "1.2.3.4"));
    assert.equal(requestRateLimitKey("", "1.2.3.4"), "1.2.3.4");
  });

  test("登录失败日志不包含口令，且不区分账号是否存在", () => {
    const line = loginFailureLogLine("rider", "1.2.3.4", false);
    const parsed = JSON.parse(line) as { event: string; username: string; ip: string };
    assert.equal(parsed.event, "user_login_failed");
    assert.equal(parsed.username, "rider");
    assert.equal(parsed.ip, "1.2.3.4");
    assert.equal(line.includes("password"), false);
    assert.equal(JSON.parse(loginFailureLogLine("rider", "1.2.3.4", true)).event, "user_login_throttled");
  });
});