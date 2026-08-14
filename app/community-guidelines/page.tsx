import Link from "next/link";

export const metadata = { title: "社区公约 · 江城图志" };

export default function CommunityGuidelinesPage() {
  return <main className="policy-page"><article><Link href="/">← 返回地图</Link><p className="policy-kicker">COMMUNITY GUIDELINES</p><h1>江城图志社区公约</h1><p>这里用于发起武汉本地的公开活动。请把安全、真实和对他人的尊重放在第一位。</p><h2>可以发布什么</h2><ul><li>具有明确时间、集合地点和活动安排的线下活动。</li><li>真实、可执行，并与武汉城市生活相关的邀约或攻略。</li><li>对装备、体力、费用、天气和风险作出必要说明。</li></ul><h2>禁止内容</h2><ul><li>违法活动、欺诈、广告刷屏、虚假信息或诱导转账。</li><li>仇恨、骚扰、威胁、暴露他人隐私或未经同意发布联系方式。</li><li>鼓励危险驾驶、进入封闭区域或无视现场管理规定。</li></ul><h2>线下安全</h2><ul><li>首次见面优先选择公开场所，向亲友分享行程，不轻易转账。</li><li>骑行、徒步和户外活动应根据天气与身体情况自行判断，并遵守现场规则。</li><li>江城图志提供信息发布与集合工具，不提供专业导航、领队或安全担保。</li></ul><h2>治理方式</h2><p>用户可以在活动详情中举报。管理员可隐藏活动或留言、停用账号，并保留必要的审计记录。恶意举报也可能被限制。</p><p className="policy-updated">版本日期：2026 年 8 月 7 日</p></article></main>;
}
