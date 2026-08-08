/**
 * sec-55:harden-context-resilience Phase 1(上下文健壮性地基)
 *  - isContextLengthError(兜底形态:lc_error_code / code / 400+message)
 *  - MIN_CONTEXT_WINDOW(200K 硬约束)
 *  - resolveModelCaps 查表(≥200K 满足 / <200K 被校验拦)
 *  - 中间件 controller:setContextWindow(summarization/contextInspector)
 */
import type { TestCtx } from './_ctx'
import { isContextLengthError } from '../../harness/errors'
import { MIN_CONTEXT_WINDOW, resolveModelCaps } from '../../utils/modelCaps'
import { createSummarizationMiddleware } from '../../harness/summarization'
import { createContextInspectorMiddleware } from '../../harness/contextInspector'
import { createVfs } from '../../backends/vfs'
import { extractVfsRefs } from '../../utils/vfsGc'
import { createAgent } from '../../harness/createAgent'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessageChunk } from '@langchain/core/messages'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== isContextLengthError(P3 反应性重试识别用)=====
  assert(isContextLengthError({ lc_error_code: 'CONTEXT_OVERFLOW' }), '✓ isContextLengthError → lc_error_code CONTEXT_OVERFLOW = true')
  assert(isContextLengthError({ code: 'context_length_exceeded' }), '✓ isContextLengthError → code context_length_exceeded = true')
  assert(isContextLengthError({ status: 400, message: "This model's maximum context length is 2048 tokens." }), '✓ isContextLengthError → 400 + maximum context length = true')
  assert(isContextLengthError({ status: 400, message: 'prompt is too long: 300000 > 200000 tokens' }), '✓ isContextLengthError → 400 + prompt is too long = true')
  assert(!isContextLengthError({ status: 400, message: 'invalid api key' }), '✓ isContextLengthError → 400 普通参数错 = false(不误判)')
  assert(!isContextLengthError(new Error('普通错误')), '✓ isContextLengthError → 普通 Error = false')
  assert(!isContextLengthError(null), '✓ isContextLengthError → null = false')
  assert(!isContextLengthError(undefined), '✓ isContextLengthError → undefined = false')
  assert(!isContextLengthError({ status: 429 }), '✓ isContextLengthError → 429 限流 = false(不误判,职责正交)')

  // ===== MIN_CONTEXT_WINDOW(200K 硬约束)=====
  assert(MIN_CONTEXT_WINDOW === 200000, '✓ MIN_CONTEXT_WINDOW === 200000')

  // ===== resolveModelCaps 查表(≥200K 满足 / <200K 会被校验拦)=====
  assert(resolveModelCaps({ model: 'glm-5.2' }).contextWindow === 1048576, '✓ resolveModelCaps → glm-5.2 = 1M(≥200K 满足)')
  assert(resolveModelCaps({ model: 'glm-5' }).contextWindow === 200000, '✓ resolveModelCaps → glm-5 = 200K(刚好满足)')
  assert(resolveModelCaps({ model: 'claude-3-5-sonnet' }).contextWindow === 200000, '✓ resolveModelCaps → claude-3-5 = 200K(满足)')
  assert(resolveModelCaps({ model: 'deepseek' }).contextWindow === 131072, '✓ resolveModelCaps → deepseek = 128K(<200K,校验拦)')
  assert(resolveModelCaps({ model: 'gpt-4o' }).contextWindow === 131072, '✓ resolveModelCaps → gpt-4o = 128K(<200K,校验拦)')
  // 声明优先 > 查表(集成方显式声明覆盖)
  assert(resolveModelCaps({ model: 'deepseek', contextWindow: 500000 }).contextWindow === 500000, '✓ resolveModelCaps → 显式声明优先覆盖查表')

  // ===== 中间件 controller:setContextWindow(setLlm 后回灌新窗口)=====
  const sumMw: any = createSummarizationMiddleware({ contextWindow: 200000 })
  assert(typeof sumMw.setContextWindow === 'function', '✓ createSummarizationMiddleware → 返回 setContextWindow 函数(controller)')
  assert(typeof sumMw.compressInput === 'function', '✓ summarization middleware → 仍有 compressInput(中间件契约不变)')
  sumMw.setContextWindow(500000) // 调用不抛;下轮 compress 读 config 共享引用用新窗口
  assert(true, '✓ summarization setContextWindow(500000) 调用不抛')

  const ciMw: any = createContextInspectorMiddleware({ contextWindow: 200000 })
  assert(typeof ciMw.setContextWindow === 'function', '✓ createContextInspectorMiddleware → 返回 setContextWindow 函数(controller)')
  assert(typeof ciMw.getSnapshot === 'function', '✓ contextInspector middleware → 仍有 getSnapshot')
  ciMw.setContextWindow(500000)
  assert(true, '✓ contextInspector setContextWindow(500000) 调用不抛')

  // ===== P4:vfs setProtectedRefs(LRU 跳过被引用)+ OOM 1.5x 兜底 =====
  {
    const vfs: any = createVfs({}, { poolBytes: { largeResults: 2000 } } as any)
    vfs.setProtectedRefs?.(new Set(['large_results/keep.txt']))
    vfs.files['large_results/keep.txt'] = { content: 'X'.repeat(1500), updatedAt: 1 } // 被引用 + 旧
    vfs.files['large_results/old.txt'] = { content: 'Y'.repeat(1500), updatedAt: 2 } // 不可达 + 新
    // 写 old.txt(Proxy set 触发 enforceLimit):池 3000 > 2000 → 淘汰;keep 被引用跳过,old 删
    assert(vfs.files['large_results/keep.txt'] !== undefined, 'P4:被引用的 large_results 不被 LRU 删(防 vfs_read 404)')
    assert(vfs.files['large_results/old.txt'] === undefined, 'P4:不可达的 large_results 被 LRU 删(GC 正常)')
  }
  {
    // OOM 硬兜底:被引用撑爆 1.5x → 无视 protectedRefs 强制删最旧(防全池被保护不收敛)
    const vfs2: any = createVfs({}, { poolBytes: { largeResults: 1000 } } as any)
    vfs2.setProtectedRefs?.(new Set(['large_results/a.txt', 'large_results/b.txt']))
    vfs2.files['large_results/a.txt'] = { content: 'X'.repeat(800), updatedAt: 1 } // 被引用 + 旧
    vfs2.files['large_results/b.txt'] = { content: 'Y'.repeat(800), updatedAt: 2 } // 被引用 + 新
    // 池 1600 > 1000*1.5=1500 → OOM 强制删最旧(a)
    assert(vfs2.files['large_results/a.txt'] === undefined, 'P4 OOM:被引用撑爆 1.5x → 无视 protectedRefs 强制删最旧(防不收敛)')
  }

  // ===== resolveModelCaps 缺省 + longest-match 具体性 =====
  assert(resolveModelCaps({}).contextWindow === 32768, '✓ resolveModelCaps → 无 model/声明 → DEFAULT_CAPS contextWindow 32768 缺省')
  assert(resolveModelCaps({}).maxOutputTokens === 4096, '✓ resolveModelCaps → 无 model/声明 → maxOutputTokens 4096 缺省')
  // longest-match 具体性(glm-4.5 匹配 7 字符 优先于 glm-4 匹配 5 字符;maxOutputTokens 区分:98304 vs 4096)
  assert(resolveModelCaps({ model: 'glm-4.5' }).maxOutputTokens === 98304, '✓ resolveModelCaps → longest-match:glm-4.5 = 98304 输出(具体优先,非 glm-4 的 4096)')
  assert(resolveModelCaps({ model: 'glm-4.5-air' }).contextWindow === 131072, '✓ resolveModelCaps → longest-match:glm-4.5-air 子串命中 glm-4.5(131072 上下文)')

  // ===== createAgent.setModelCaps controller(返回对象暴露;setLlm 链驱动 offload 阈值跟随新窗口)=====
  {
    class StubLlm55 extends BaseChatModel {
      constructor() { super({}) }
      _llmType(): string { return 'stub55' }
      bindTools(): any { return this }
      async *_streamResponseChunks(): AsyncGenerator<any> {
        yield { text: 'ok', message: new AIMessageChunk({ content: 'ok' }), generationInfo: {} }
      }
      async _generate(): Promise<any> { return { generations: [{ text: 'ok', message: new AIMessageChunk({ content: 'ok' }) }], llmOutput: {} } }
    }
    const agent: any = createAgent({ llm: new StubLlm55() as any, contextWindow: 200000 })
    assert(typeof agent.setModelCaps === 'function', '✓ createAgent 返回对象暴露 setModelCaps controller(供 setLlm 链回灌新窗口)')
    let threw = false
    try { agent.setModelCaps({ contextWindow: 500000, maxOutputTokens: 65536 }) } catch { threw = true }
    assert(!threw, '✓ setModelCaps({contextWindow:500000}) 调用不抛(offload 阈值/压缩口径跟随新窗口,修原固化)')
  }

  // ===== extractVfsRefs 纯函数(Phase 4 setProtectedRefs 的数据源:扫 messages 提 large_results 引用)=====
  {
    const refs = extractVfsRefs([
      { role: 'assistant', content: '结果见 vfs_read({ path: "large_results/read-abc123.txt" })' },
      { role: 'tool', content: 'x', steps: [{ result: '更多 large_results/query-def456.txt 详情' }] },
      { role: 'assistant', content: '重复引用 large_results/read-abc123.txt' },
    ] as any)
    assert(refs.has('large_results/read-abc123.txt'), '✓ extractVfsRefs → content 中 large_results 引用提取')
    assert(refs.has('large_results/query-def456.txt'), '✓ extractVfsRefs → steps.result 中引用也扫(工具结果含 offload 地址)')
    assert(refs.size === 2, '✓ extractVfsRefs → 去重(同一引用多轮只算一次)')
    assert(extractVfsRefs([{ role: 'user', content: '普通文本无引用' }] as any).size === 0, '✓ extractVfsRefs → 无引用返空 Set')
  }

  // ===== P4 补:未设 protectedRefs(默认空)→ 正常 LRU 删最旧(保护为增强,不破坏默认淘汰)=====
  {
    const vfs3: any = createVfs({}, { poolBytes: { largeResults: 2000 } } as any)
    vfs3.files['large_results/a.txt'] = { content: 'X'.repeat(1500), updatedAt: 1 } // 旧
    vfs3.files['large_results/b.txt'] = { content: 'Y'.repeat(1500), updatedAt: 2 } // 新(写触发 enforceLimit)
    assert(vfs3.files['large_results/a.txt'] === undefined, 'P4:未设 protectedRefs → 正常 LRU 删最旧(默认淘汰不被保护破坏)')
    assert(vfs3.files['large_results/b.txt'] !== undefined, 'P4:未设 protectedRefs → 新条目保留')
  }
}
