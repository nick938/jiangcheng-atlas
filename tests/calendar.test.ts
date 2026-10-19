/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildActivityCalendar,
  calendarContentDisposition,
  calendarFileName,
  escapeCalendarText,
  foldCalendarLine,
} from "@/lib/calendar";
import type { CityActivity } from "@/lib/community-types";

const baseActivity: CityActivity = {
  id: "act-1",
  activityType: "ride",
  routeId: null,
  routeName: null,
  routeColor: null,
  title: "周末东湖轻松骑行",
  details: "梨园集合，沿绿道骑行。请自备头盔；迟到不等。",
  startsAt: "2026-08-08T00:00:00.000Z",
  endsAt: "2026-08-08T02:00:00.000Z",
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
  joinedCount: 3,
  joinedByMe: false,
  isOwner: false,
  commentCount: 0,
};

const encoder = new TextEncoder();
const fixedNow = new Date("2026-08-07T03:00:00.000Z");

function lines(calendar: string) {
  return calendar.split("\r\n").filter(Boolean);
}

describe("活动日历导出", () => {
  test("生成带 UTC 时间与唯一标识的标准日历", () => {
    const calendar = buildActivityCalendar(baseActivity, { now: fixedNow });
    const body = lines(calendar);

    assert.equal(body[0], "BEGIN:VCALENDAR");
    assert.equal(body.at(-1), "END:VCALENDAR");
    assert.ok(body.includes("VERSION:2.0"));
    assert.ok(body.includes("DTSTART:20260808T000000Z"));
    assert.ok(body.includes("DTEND:20260808T020000Z"));
    assert.ok(body.includes("DTSTAMP:20260807T030000Z"));
    assert.ok(body.includes("UID:act-1@atlas.sololeveling.top"));
    assert.ok(body.includes("URL:https://atlas.sololeveling.top/event/act-1"));
    assert.ok(body.includes("STATUS:CONFIRMED"));
    assert.ok(body.includes("GEO:30.579400;114.386000"));
    assert.equal((calendar.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  });

  test("每行不超过 75 个八位组，且折叠后可以还原", () => {
    const longTitle = `周末东湖轻松骑行${"环湖绿道集合出发".repeat(6)}`;
    const calendar = buildActivityCalendar({ ...baseActivity, title: longTitle }, { now: fixedNow });

    for (const line of lines(calendar)) {
      assert.ok(encoder.encode(line).length <= 75, `行超长：${line}`);
    }

    const unfolded = calendar.replace(/\r\n /g, "").split("\r\n");
    assert.ok(unfolded.includes(`SUMMARY:${escapeCalendarText(longTitle)}`));
  });

  test("转义分号、逗号、反斜杠与换行", () => {
    const calendar = buildActivityCalendar(
      { ...baseActivity, title: "带上头盔;手套,以及水", details: "第一行\n第二行" },
      { now: fixedNow },
    );

    assert.ok(lines(calendar).includes("SUMMARY:带上头盔\\;手套\\,以及水"));

    const unfolded = calendar.replace(/\r\n /g, "");
    assert.ok(unfolded.includes("第一行\\n第二行"));
    assert.ok(unfolded.includes("类型：骑行"));
  });

  test("取消的活动标记为 CANCELLED 并在标题前加提示", () => {
    const calendar = buildActivityCalendar(
      { ...baseActivity, status: "cancelled", cancelledAt: "2026-08-07T04:00:00.000Z" },
      { now: fixedNow },
    );
    assert.ok(calendar.includes("STATUS:CANCELLED"));
    assert.ok(calendar.includes("SUMMARY:[已取消] 周末东湖轻松骑行"));
  });

  test("结束时间早于开始时间时退回两小时时长", () => {
    const calendar = buildActivityCalendar(
      { ...baseActivity, endsAt: "2026-08-07T23:00:00.000Z" },
      { now: fixedNow },
    );
    assert.ok(calendar.includes("DTEND:20260808T020000Z"));
  });

  test("校准到自定义站点域名", () => {
    const calendar = buildActivityCalendar(baseActivity, { now: fixedNow, origin: "https://example.com/" });
    assert.ok(calendar.includes("UID:act-1@example.com"));
    assert.ok(calendar.includes("URL:https://example.com/event/act-1"));
  });

  test("下载文件名同时提供 ASCII 与 UTF-8 版本", () => {
    assert.equal(calendarFileName("act-1"), "jiangcheng-atlas-act-1.ics");
    assert.equal(calendarFileName("../../etc/passwd"), "jiangcheng-atlas-etcpasswd.ics");

    const disposition = calendarContentDisposition("周末东湖轻松骑行", "act-1");
    assert.ok(disposition.startsWith('attachment; filename="jiangcheng-atlas-act-1.ics"'));
    assert.ok(disposition.includes("filename*=UTF-8''"));
    assert.ok(disposition.includes(encodeURIComponent("周末东湖轻松骑行")));
  });

  test("标题在截断点带 emoji 时不会破坏下载头", () => {
    const title = `${"骑".repeat(59)}🚲尾巴`;
    const disposition = calendarContentDisposition(title, "act-2");

    assert.ok(disposition.includes("filename*=UTF-8''"));
    assert.ok(disposition.includes("filename=\"jiangcheng-atlas-act-2.ics\""));
    // 截断处不能留下孤立代理，编码结果必须是合法 UTF-8 文件名。
    const encoded = disposition.split("filename*=UTF-8''")[1];
    assert.doesNotThrow(() => decodeURIComponent(encoded));
    assert.ok(!decodeURIComponent(encoded).includes("\uFFFD"));
  });
});

describe("日历转义与折行", () => {
  test("转义顺序不会重复转义换行", () => {
    assert.equal(escapeCalendarText("a;b,c\\d"), "a\\;b\\,c\\\\d");
    assert.equal(escapeCalendarText("第一行\r\n第二行"), "第一行\\n第二行");
    assert.equal(escapeCalendarText("第一行\n第二行"), "第一行\\n第二行");
  });

  test("短行保持原样，长行拆分为续行", () => {
    assert.equal(foldCalendarLine("SUMMARY:短标题"), "SUMMARY:短标题");

    const folded = foldCalendarLine(`SUMMARY:${"湖".repeat(40)}`);
    const parts = folded.split("\r\n ");
    assert.ok(parts.length > 1);
    assert.ok(parts.slice(1).every((part) => part.startsWith("湖")));
    for (const line of folded.split("\r\n")) {
      assert.ok(encoder.encode(line).length <= 75);
    }
    assert.equal(folded.replace(/\r\n /g, ""), `SUMMARY:${"湖".repeat(40)}`);
  });
});
