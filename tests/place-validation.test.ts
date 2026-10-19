/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validatePlaceInput } from "@/lib/place-validation";

const valid = {
  slug: "yellow-crane-tower",
  name: "黄鹤楼",
  subtitle: "江城天际线上的千年名楼",
  description: "登楼可以同时看见长江、蛇山与武汉三镇。",
  longitude: 114.3064,
  latitude: 30.5444,
  district: "武昌区",
  address: "蛇山西山坡特1号",
  categoryId: "landmark",
  featured: true,
  status: "published",
};

describe("地点输入校验", () => {
  test("接受完整且合规的地点", () => {
    const result = validatePlaceInput(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.slug, "yellow-crane-tower");
      assert.equal(result.data.featured, true);
      assert.equal(result.data.status, "published");
    }
  });

  test("字符串数字会被规范化", () => {
    const result = validatePlaceInput({ ...valid, longitude: "114.3", latitude: "30.5", featured: "yes" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.longitude, 114.3);
      assert.equal(result.data.latitude, 30.5);
      // 只有布尔 true 才算推荐，字符串不算
      assert.equal(result.data.featured, false);
    }
  });

  test("拒绝非法 slug", () => {
    for (const slug of ["Yellow-Crane", "黄鹤楼", "yellow_crane", "-yellow", ""]) {
      assert.equal(validatePlaceInput({ ...valid, slug }).ok, false, slug);
    }
  });

  test("拒绝超出武汉周边范围的坐标", () => {
    assert.equal(validatePlaceInput({ ...valid, longitude: 120 }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, latitude: 40 }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, longitude: "east" }).ok, false);
  });

  test("拒绝无效分类与发布状态", () => {
    assert.equal(validatePlaceInput({ ...valid, categoryId: "all" }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, categoryId: "unknown" }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, status: "archived" }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, status: "PUBLISHED" }).ok, false);
  });

  test("拒绝缺失或过长的文本字段", () => {
    assert.equal(validatePlaceInput({ ...valid, name: "  " }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, description: "字".repeat(1201) }).ok, false);
    assert.equal(validatePlaceInput({ ...valid, district: "" }).ok, false);
  });

  test("拒绝非对象输入", () => {
    assert.equal(validatePlaceInput(null).ok, false);
    assert.equal(validatePlaceInput([]).ok, false);
    assert.equal(validatePlaceInput("place").ok, false);
  });
});
