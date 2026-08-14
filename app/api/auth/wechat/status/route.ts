import { NextResponse } from "next/server";
import { wechatBindings, wechatConfigured } from "@/lib/wechat-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = await wechatBindings();
  return NextResponse.json({ configured: wechatConfigured(env) }, { headers: { "Cache-Control": "no-store" } });
}
