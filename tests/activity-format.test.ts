/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { activityStatusLabel, activityTypeMeta, dateRangeLabel } from "@/lib/activity-format";
import type { CityActivity } from "@/lib/community-types";

const now = Date.parse("2026-08-08T01:00:00.000Z");

function activity(overrides: Partial<CityActivity> = {}): CityActivity {
  return {
    id: "act-1",
    activityType: "ride",
    routeId: null,
    routeName: null,
    routeColor: null,
    title: "周末东湖轻松骑行",
    details: "梨园集合，沿绿道骑行。",
    startsAt: "2026-08-08T02:00:00.000Z",
    endsAt: "2026-08-08T04:00:00.000Z",
    meetingName: "东湖绿道梨园入口",
    meetingLongitude: 114.386,
    meetingLatitude: 30.5794,
    capacity: 8,
    pace: null,
    status: "open",
    completedAt: null,
    cancelledAt: null,
    imageUrl: null,
    creator: { id: "u1", username: "rider", displayName: "小明", avatarColor: "#173f3a" },
    joinedCount: 1,
    joinedByMe: false,
    isOwner: false,
    commentCount: 0,
    ...overrides,
  };
}

describe("活动状态文案", () => {
  test("未开始且未满员时为正在召集", () => {
    assert.equal(activityStatusLabel(activity(), now), "正在召集");
  });

  test("满员优先于未开始", () => {
    assert.equal(activityStatusLabel(activity({ joinedCount: 8 }), now), "已满员");
  });

  test("已开始但未结束时为进行中", () => {
    assert.equal(activityStatusLabel(
      activity({ startsAt: "2026-08-08T00:00:00.000Z", endsAt: "2026-08-08T04:00:00.000Z" }),
      now,
    ), "进行中");
  });

  test("到达结束时间后为已结束", () => {
    assert.equal(activityStatusLabel(
      activity({ startsAt: "2026-08-07T20:00:00.000Z", endsAt: "2026-08-08T00:00:00.000Z" }),
      now,
    ), "已结束");
  });

  test("取消与完成状态优先于时间判断", () => {
    assert.equal(activityStatusLabel(activity({ status: "cancelled" }), now), "已取消");
    assert.equal(activityStatusLabel(activity({ status: "completed" }), now), "已完成");
  });
});

describe("活动文案映射", () => {
  test("覆盖全部活动类型", () => {
    assert.deepEqual(Object.keys(activityTypeMeta).sort(), ["food", "other", "photo", "ride", "sports", "walk"]);
    assert.equal(activityTypeMeta.ride.label, "骑行");
    assert.equal(activityTypeMeta.walk.short, "走");
  });

  test("时间段文案包含起止时间", () => {
    const label = dateRangeLabel("2026-08-08T00:00:00.000Z", "2026-08-08T02:00:00.000Z");
    assert.ok(label.includes("–"), label);
    assert.ok(/:/u.test(label), label);

    const crossDay = dateRangeLabel("2026-08-08T00:00:00.000Z", "2026-08-10T02:00:00.000Z");
    assert.ok(crossDay.includes("–"), crossDay);
    assert.ok(crossDay.length > label.length, crossDay);
  });

  test("无论运行环境时区如何，都按武汉时间展示", () => {
    // 02:00 UTC 即武汉时间 10:00；服务端（UTC）与浏览器必须一致。
    const label = dateRangeLabel("2027-01-01T02:00:00.000Z", "2027-01-01T04:00:00.000Z");
    assert.ok(label.includes("10:00"), label);
    assert.ok(label.includes("12:00"), label);
    assert.ok(!label.includes("02:00"), label);
  });

  test("是否同一天按武汉时间判断，而不是 UTC", () => {
    // 15:30Z 与 16:30Z 在 UTC 下跨日（一个在 1 日、一个在 2 日），在武汉时间下都是 23:30 与次日 00:30。
    const crossMidnightUtc = dateRangeLabel("2026-01-01T15:30:00.000Z", "2026-01-01T16:30:00.000Z");
    assert.ok(crossMidnightUtc.includes("1/2"), crossMidnightUtc);

    // 00:30Z 与 02:30Z 在 UTC 下同一天，在武汉时间下也同一天（08:30 与 10:30）。
    const sameDay = dateRangeLabel("2026-01-01T00:30:00.000Z", "2026-01-01T02:30:00.000Z");
    assert.ok(sameDay.includes("08:30"), sameDay);
    assert.ok(!sameDay.includes("1/2"), sameDay);
  });
});
