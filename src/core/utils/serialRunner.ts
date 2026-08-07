/**
 * 串行化运行器(P1-2,arch-review):把并发异步操作排成串行链,一个跑完下一个才开始。
 *
 * 用途:createChatSdk 的 send/switchSession/batch 共享闭包 state,并发调用会竞态
 * (A 生成中切 B → state 串写 / data 并发改)。runSerial 保证同一 sdk 实例的操作串行,
 * 即「一个会话操作 data 时,其他会话的操作等它结束」—— 单实例同一时刻只服务一个会话。
 *
 * 语义:
 *  - 后调用的 fn 等前一个(无论 resolve/reject)完成才开始
 *  - 前一个 reject 不卡死后续(then(fn, fn) 双路继续)
 *  - 返回各自 fn 的 Promise(结果/错误透传给调用方,不影响链推进)
 */
export function createSerialRunner(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return function runSerial<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn)  // 前一个无论成败都继续(避免 reject 卡死后续排队)
    chain = p.then(() => undefined, () => undefined)  // 链推进(吞错,不影响后续)
    return p as Promise<T>
  }
}
