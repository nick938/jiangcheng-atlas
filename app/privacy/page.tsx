import Link from "next/link";

export const metadata = { title: "隐私说明 · 江城图志" };

export default function PrivacyPage() {
  return <main className="policy-page"><article><Link href="/">← 返回地图</Link><p className="policy-kicker">PRIVACY</p><h1>隐私说明</h1><p>江城图志只收集运行地图社区所必需的信息，并将主要业务数据存储在 Cloudflare D1、图片存储在 Cloudflare R2。</p><h2>我们处理的信息</h2><ul><li>账号、显示昵称、加密后的密码凭据与登录会话。</li><li>你发布或参加的活动、留言、举报以及相关时间和地图坐标。</li><li>你主动上传的活动或地点图片。</li><li>启用微信登录后，微信返回的 OpenID、UnionID（如有）、昵称和头像地址；AppSecret 永远只保存在服务端 Secret 中。</li><li>为安全限流处理的网络标识。应用不会把明文密码写入日志。</li></ul><h2>使用目的</h2><p>用于登录、活动协作、消息提醒、内容治理、安全防护、故障排查和数据恢复，不出售个人信息。</p><h2>保存与删除</h2><p>登录会话最长保存 30 天。你可以在个人资料中修改昵称或注销账号；注销后会解除微信绑定并清除会话，历史活动和留言为保证社区记录完整性会匿名保留。举报与管理审计会按安全需要保留。</p><h2>第三方服务</h2><p>底图目前来自 OpenFreeMap；打开百度或高德导航、微信扫码登录或地点图片来源链接时，将适用对应服务的隐私规则。</p><h2>你的选择</h2><p>无需登录即可浏览地图。发布、报名、留言和举报时才要求身份。你可以随时退出登录或注销账号。</p><p className="policy-updated">版本日期：2026 年 8 月 7 日</p></article></main>;
}
