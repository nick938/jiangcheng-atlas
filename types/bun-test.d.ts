/**
 * 最小环境声明：本仓库只安装 `@cloudflare/workers-types`，没有 Bun 类型包，
 * 而 tests/media-route.test.ts 需要用 `bun:test` 的 mock.module 替换
 * `@opennextjs/cloudflare`（拿不到真实 R2 绑定时验证媒体路由的响应头与 304）。
 * 只声明用到的 API，避免伪造整包类型。
 */
declare module "bun:test" {
  type MockFactory = () => unknown;
  interface MockApi {
    /** 用给定工厂替换模块解析结果（进程内生效）。 */
    module(moduleName: string, factory: MockFactory): void;
    /** 还原所有 mock。 */
    restore(): void;
  }
  export const mock: MockApi;
}
