/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateActivityInput } from "@/lib/activity-validation";

const now = Date.parse("2026-08-07T00:00:00.000Z");
const valid = {
  activityType: "ride",
  title: "周末东湖轻松骑行",
  details: "梨园集合，沿绿道轻松骑行，请自备头盔和饮用水。",
  startsAt: "2026-08-08T00:00:00.000Z",
  endsAt: "2026-08-08T02:00:00.000Z",
  meetingName: "东湖绿道梨园入口",
  meetingLongitude: 114.386,
  meetingLatitude: 30.5794,
  capacity: 8,
};

describe("活动输入校验", () => {
  test("接受武汉范围内的有效时间段", () => {
    const result = validateActivityInput(valid, now);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.endsAt, "2026-08-08T02:00:00.000Z");
  });

  test("拒绝结束时间早于开始时间", () => {
    assert.equal(validateActivityInput({ ...valid, endsAt: "2026-08-07T23:00:00.000Z" }, now).ok, false);
  });

  test("拒绝超出武汉运营范围的集合点", () => {
    assert.equal(validateActivityInput({ ...valid, meetingLongitude: 116.4 }, now).ok, false);
  });

  test("拒绝少于三十分钟后开始的活动", () => {
    assert.equal(validateActivityInput({ ...valid, startsAt: "2026-08-07T00:20:00.000Z" }, now).ok, false);
  });

  test("拒绝短于十五分钟或长于七天的活动", () => {
    assert.equal(validateActivityInput({ ...valid, endsAt: "2026-08-08T00:10:00.000Z" }, now).ok, false);
    assert.equal(validateActivityInput({ ...valid, endsAt: "2026-08-16T00:00:00.000Z" }, now).ok, false);
  });
});
