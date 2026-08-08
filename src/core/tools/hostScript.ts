/**
 * 宿主脚本执行器(skill-external-scripts §4)
 *
 * 与沙箱(sandbox.ts)对照:
 *  - 沙箱:Worker 内,无 window/网络,三层防护(静态扫描 + lockSandboxGlobal + 超时 terminate)
 *  - 宿主:主线程全局执行,window/fetch/DOM **全权**;超时由 Promise.race(无法 terminate 主线程,只能弃结果)
 *
 * 安全前提(host opt-in 成立的根基):
 *  host 脚本**必须是集成方内联 exec.code** —— 写死在 skill 定义里、由集成方编写,**非 LLM 生成、非远程**。
 *  LLM 只能调已注入的 skill 工具,改不了 skill 定义 → 无法注入任意 host 代码。决策 3「url+host 禁止」守住
 *  远程不可信代码不能全权跑。故 host 可信度 = 集成方可信度,经 capabilities.skillHostScript 整体 opt-in。
 *
 * **不经 SANDBOX_FORBIDDEN_PATTERNS 静态扫描**:静态扫描是防 LLM 沙箱脚本绕过外泄;host 是集成方可信内联
 *  代码,需正常 fetch/DOM API,扫描会误拒合理用法。host 的边界是 skillHostScript opt-in,不是静态扫描。
 */
import type { SandboxResult } from './sandbox'

/**
 * 在宿主全局执行 code(AsyncFunction body,可 await/读 window/调 fetch/操作 DOM)。
 * @param code 函数体字符串(如 `const r = await fetch('/api'); return await r.json()`)
 * @param timeoutMs 超时(Promise.race;超时只是弃结果,主线程脚本可能仍在跑 —— host 集成方自负其责)
 */
export async function runHostScript(code: string, timeoutMs = 3000): Promise<SandboxResult> {
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // AsyncFunction 构造器:async function 的原型链构造,body 为函数体(无参,自由写 await/return)
    const AsyncFunction = Object.getPrototypeOf(async function () { /* */ }).constructor
    const fn = new AsyncFunction(code)
    const p = Promise.resolve(fn())
    p.catch(() => {})  // 吞延迟 reject:超时胜出后 fn() 后续 reject 无人接,防 unhandledRejection(主线程无法取消脚本,只能弃结果)
    const result = await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`宿主脚本执行超时(${timeoutMs}ms)`)), timeoutMs)
      }),
    ])
    return { ok: true, result, elapsedMs: Date.now() - start }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e), elapsedMs: Date.now() - start }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
