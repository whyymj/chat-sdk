/**
 * sec-48:createSerialRunner 串行化运行器(P1-2,arch-review)
 * - 并发调用按调用顺序串行(fn2 等 fn1 完成才开始,不被短 setTimeout 抢先)
 * - 前一个 reject 不卡死后续(then(fn,fn) 双路继续)
 * - 各 fn 返回自己的结果/错误(透传,不影响链推进)
 */
import { createSerialRunner } from '../../utils/serialRunner'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[sec-48] createSerialRunner 串行化运行器(P1-2,arch-review)')

  // ✓ 串行:后调用等前一个完成(fn2 在 fn1 resolve 后才开始;fn2 setTimeout 更短也不抢先)
  {
    const runSerial = createSerialRunner()
    const order: string[] = []
    const p1 = runSerial(() => new Promise<string>((r) => setTimeout(() => { order.push('fn1'); r('a') }, 20)))
    const p2 = runSerial(() => new Promise<string>((r) => setTimeout(() => { order.push('fn2'); r('b') }, 5)))
    const [r1, r2] = await Promise.all([p1, p2])
    assert(r1 === 'a' && r2 === 'b', '✓ 各 fn 返回自己的结果(透传)')
    assert(order[0] === 'fn1' && order[1] === 'fn2', '✓ 串行:fn1 先完成(尽管 fn2 setTimeout 更短),fn2 等 fn1')
  }

  // ✓ 前一个 reject 不卡死后续(then(fn,fn) 双路继续;链推进吞错)
  {
    const runSerial = createSerialRunner()
    const order: string[] = []
    const p1 = runSerial(() => Promise.reject(new Error('boom')))
    const p2 = runSerial(() => Promise.resolve().then(() => { order.push('fn2'); return 'ok' }))
    await p1.catch(() => {})  // 调用方吞掉 p1 reject(链自身已吞,不影响后续)
    const r2 = await p2
    assert(r2 === 'ok' && order[0] === 'fn2', '✓ 前一个 reject 不卡后续(fn2 正常执行)')
  }

  // ✓ 并发 3 个:按调用顺序串行(不被短 setTimeout 抢先)
  {
    const runSerial = createSerialRunner()
    const order: number[] = []
    // fn3 的 setTimeout 最短(10),fn1 最长(30);若并发 fn3 先完。串行化后按调用序 1→2→3
    const tasks = [1, 2, 3].map((i) => runSerial(() => new Promise<number>((r) => setTimeout(() => { order.push(i); r(i) }, 10 * (4 - i)))))
    const results = await Promise.all(tasks)
    assert(results.join() === '1,2,3', '✓ 各 fn 返回正确结果(1,2,3)')
    assert(order.join() === '1,2,3', '✓ 按调用顺序串行执行(短 setTimeout 不抢先)')
  }

  // ✓ p1 的 reject 透传给调用方(链吞错不影响后续,但调用方仍收到 p1 的 reject)
  {
    const runSerial = createSerialRunner()
    const p1 = runSerial(() => Promise.reject(new Error('e1')))
    let caught: string | undefined
    await p1.catch((e: unknown) => { caught = (e as Error).message })
    assert(caught === 'e1', '✓ fn 的 reject 透传给调用方(链推进吞错 ≠ 调用方收不到错)')
  }
}
