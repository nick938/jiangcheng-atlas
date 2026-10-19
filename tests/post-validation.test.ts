/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { POST_VALIDATION_ERROR, validatePostCommentInput, validatePostInput } from "@/lib/post-validation";

const valid = {
  title: "周末东湖骑行搭子",
  body: "周六上午梨园集合，沿绿道慢骑，欢迎新手一起。",
  topic: "meetup",
};

describe("帖子输入校验", () => {
  test("接受合法的标题、正文与话题", () => {
    const result = validatePostInput(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.title, valid.title);
      assert.equal(result.data.body, valid.body);
      assert.equal(result.data.topic, "meetup");
    }
  });

  test("标题边界：trim 后 4–60 字符", () => {
    assert.equal(validatePostInput({ ...valid, title: "三字经" }).ok, false);
    assert.equal(validatePostInput({ ...valid, title: "四个字符" }).ok, true);
    assert.equal(validatePostInput({ ...valid, title: "字".repeat(60) }).ok, true);
    assert.equal(validatePostInput({ ...valid, title: "字".repeat(61) }).ok, false);
    assert.equal(validatePostInput({ ...valid, title: "  三个字  " }).ok, false);
  });

  test("正文边界：trim 后 10–3000 字符", () => {
    assert.equal(validatePostInput({ ...valid, body: "字".repeat(9) }).ok, false);
    assert.equal(validatePostInput({ ...valid, body: "字".repeat(10) }).ok, true);
    assert.equal(validatePostInput({ ...valid, body: "字".repeat(3000) }).ok, true);
    assert.equal(validatePostInput({ ...valid, body: "字".repeat(3001) }).ok, false);
  });

  test("话题缺失时默认 chat，非法话题被拒绝", () => {
    const missing = validatePostInput({ title: valid.title, body: valid.body });
    assert.equal(missing.ok, true);
    if (missing.ok) assert.equal(missing.data.topic, "chat");
    assert.equal(validatePostInput({ ...valid, topic: "market" }).ok, false);
    assert.equal(validatePostInput({ ...valid, topic: "" }).ok, true);
    assert.equal(validatePostInput({ ...valid, topic: 3 }).ok, false);
  });

  test("非对象或字段类型错误时拒绝，并返回统一文案", () => {
    for (const payload of [null, { ...valid, title: 12 }, { ...valid, body: null }]) {
      const result = validatePostInput(payload as Record<string, unknown> | null);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, POST_VALIDATION_ERROR);
    }
  });

  test("正文与标题会先 trim 再校验", () => {
    const result = validatePostInput({ ...valid, body: `  ${valid.body}  ` });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.body, valid.body);
  });
});

describe("帖子评论校验", () => {
  test("评论正文 1–500 字符", () => {
    assert.equal(validatePostCommentInput({ body: "" }).ok, false);
    assert.equal(validatePostCommentInput({ body: "  " }).ok, false);
    assert.equal(validatePostCommentInput({ body: "好" }).ok, true);
    assert.equal(validatePostCommentInput({ body: "字".repeat(500) }).ok, true);
    assert.equal(validatePostCommentInput({ body: "字".repeat(501) }).ok, false);
    assert.equal(validatePostCommentInput(null).ok, false);
  });

  test("评论正文会 trim 后返回", () => {
    const result = validatePostCommentInput({ body: "  同去  " });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.body, "同去");
  });
});
