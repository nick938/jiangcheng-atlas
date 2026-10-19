// gsap 只用于少量装饰动画（marker 入场、详情卡 timeline、创建面板入场）。
// 让它留在首页首屏同步加载会白白多付一份解析成本，这里改成按需动态 import，
// 并用模块级 Promise 做缓存：多处调用只会真正加载一次。
//
// 放在 components/ 而不是 lib/：本任务的可写范围是 components/**，lib/** 属于禁区。

type Gsap = typeof import("gsap")["gsap"];

/** gsap.context() 的返回值，只需要 revert 能力。 */
export type GsapContext = { revert: () => void };

let pending: Promise<Gsap> | null = null;

export function loadGsap(): Promise<Gsap> {
  pending ??= import("gsap").then((module) => module.gsap);
  return pending;
}
