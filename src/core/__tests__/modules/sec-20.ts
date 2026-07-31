import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc } from '../../harness/skills'
import { createPermissionsMiddleware } from '../../harness/permissions'
import { createMemoryMiddleware } from '../../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel, runBeforeReturn } from '../../harness/middleware'
import { isAbort, isRetryable, withRetry } from '../../harness/retry'
import { runPool } from '../../utils/pool'
import { createSubagentMiddleware, createSubagentsMiddleware } from '../../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, isAdversarialClean } from '../../harness/verify'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'
import { createCheckpointManager, createCheckpointMiddleware } from '../../harness/checkpoint'
import { extractText } from '../../mcp/client'
import { createInitialState as createState } from '../../harness/state'
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../../backends/storage'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from '../../utils/modelCaps'
import { useContextManager } from '../../composables/useContextManager'
import { resolveContextOptions } from '../../sdk/contextPreset'
import { jpEval, searchJson } from '../../tools/dataSlotQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// 模型能力自适应 + token 估算 + offload 阈值
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[模型能力自适应]')
  {
    // resolveModelCaps:声明优先覆盖表
    const declared = resolveModelCaps({ model: 'deepseek-chat', contextWindow: 1000000, maxOutputTokens: 4096 })
    assert(declared.contextWindow === 1000000 && declared.maxOutputTokens === 4096, 'resolveModelCaps: 声明优先覆盖表')

    // 表匹配
    const ds = resolveModelCaps({ model: 'deepseek-chat' })
    assert(ds.contextWindow === 131072 && ds.maxOutputTokens === 8192, 'resolveModelCaps: deepseek-chat 表匹配 128K/8K')
    const dsr = resolveModelCaps({ model: 'deepseek-reasoner' })
    assert(dsr.contextWindow === 65536, 'resolveModelCaps: deepseek-reasoner 64K')
    const dsv4 = resolveModelCaps({ model: 'deepseek-v4-flash' })
    assert(dsv4.contextWindow === 1048576 && dsv4.maxOutputTokens === 393216, 'resolveModelCaps: deepseek-v4 表匹配 1M/384K(flash 命中 v4 条目)')
    const gpt = resolveModelCaps({ model: 'gpt-4o' })
    assert(gpt.contextWindow === 131072 && gpt.maxOutputTokens === 16384, 'resolveModelCaps: gpt-4o 128K/16K')

    // longest-match(harden-model-caps-matching):多命中取 pattern 最具体的条目,锁死"已知模型名 → 预期 caps"(顺序无关)
    const glm46 = resolveModelCaps({ model: 'glm-4.6' })
    assert(glm46.maxOutputTokens === 131072, 'longest-match: glm-4.6 命中 glm-4.[6-9](128K 输出),非更宽泛 glm-4(4K 输出)')
    const qwen1m = resolveModelCaps({ model: 'qwen2.5-1m' })
    assert(qwen1m.contextWindow === 1048576, 'longest-match: qwen2.5-1m 命中 1m 条目(1M),非 qwen2.5(32K)')
    const unknown = resolveModelCaps({ model: 'totally-unknown-model' })
    assert(unknown.contextWindow === 32768 && unknown.maxOutputTokens === 4096, '未知模型 → DEFAULT_CAPS(32K/4K)')

    // 修正后的 2026 实测档(GLM/Kimi/Qwen 旧档曾失真)
    const glm52 = resolveModelCaps({ model: 'glm-5.2' })
    assert(glm52.contextWindow === 1048576 && glm52.maxOutputTokens === 65536, 'resolveModelCaps: glm-5.2 1M/64K')
    const glm45 = resolveModelCaps({ model: 'glm-4.5' })
    assert(glm45.contextWindow === 131072 && glm45.maxOutputTokens === 98304, 'resolveModelCaps: glm-4.5 128K/96K(输出非 8K)')
    const glm4 = resolveModelCaps({ model: 'glm-4' })
    assert(glm4.maxOutputTokens === 4096, 'resolveModelCaps: glm-4 4K 输出(与 4.5 区分)')
    const kimi = resolveModelCaps({ model: 'kimi-k2.6' })
    assert(kimi.contextWindow === 262144 && kimi.maxOutputTokens === 32768, 'resolveModelCaps: kimi-k2 256K/32K(非 128K/8K)')
    const qmax = resolveModelCaps({ model: 'qwen-max' })
    assert(qmax.contextWindow === 32768 && qmax.maxOutputTokens === 8192, 'resolveModelCaps: qwen-max 默认 32K/8K(128K 需申请,取保守)')

    // 缺省(未知模型 / 无 model)
    const unk = resolveModelCaps({ model: 'unknown-xyz' })
    assert(unk.contextWindow === 32768 && unk.maxOutputTokens === 4096, 'resolveModelCaps: 未知模型 → 缺省 32K/4K')
    assert(resolveModelCaps({}).contextWindow === 32768, 'resolveModelCaps: 无 model → 缺省')

    // estimateTokens 量级
    assert(estimateTokens('a'.repeat(1000)) === 250, 'estimateTokens: 1000 英文字符 → 250 token')
    assert(estimateTokens('中'.repeat(100)) === 150, 'estimateTokens: 100 中文字符 → 150 token')
    assert(estimateTokens('a'.repeat(400) + '中'.repeat(200)) === 400, 'estimateTokens: 混合 → 400 token')

    // offloadThresholdChars clamp [2000, 20000]
    assert(offloadThresholdChars(1000000) === 20000, 'offloadThreshold: 1M → 20000(上限)')
    assert(offloadThresholdChars(32768) === 2000, 'offloadThreshold: 32K → 2000(下限)')
    assert(offloadThresholdChars(131072) === 4588, 'offloadThreshold: 128K → 4588')

    // offloadPassThroughChars(vfs 不可用时的放行上限)clamp [offloadThreshold, 200000]
    assert(offloadPassThroughChars(1000000) === 200000, 'offloadPassThrough: 1M → 200000(上限,几乎不截断)')
    assert(offloadPassThroughChars(32768) === 22938, 'offloadPassThrough: 32K → 22938(~20%)')
    assert(offloadPassThroughChars(131072) === 91750, 'offloadPassThrough: 128K → 91750(~20%)')
    assert(offloadPassThroughChars(1000) >= offloadThresholdChars(1000), 'offloadPassThrough: 下限 ≥ offloadThreshold')
  }

  // ============ token 驱动压缩(大模型自适应)============
  console.log('\n[token 驱动压缩]')
  {
    const mkMsgs = (n: number) => {
      const out: any[] = []
      for (let i = 0; i < n; i++) {
        out.push({ role: 'user', content: 'u' + i + 'x'.repeat(300), timestamp: i * 2 })
        out.push({ role: 'assistant', content: 'a' + i + 'y'.repeat(300), timestamp: i * 2 + 1 })
      }
      return out
    }

    // token 模式:小历史不触发
    const cmSmall = useContextManager({ contextWindow: 100000 })
    const rSmall = await cmSmall.compress(mkMsgs(3))
    assert(rSmall.stats.triggered === false, 'token 模式:小历史不触发压缩')

    // token 模式:大历史触发,保留最近窗口
    const cmBig = useContextManager({ contextWindow: 800, summaryThresholdRatio: 0.5, windowRatio: 0.4 })
    const rBig = await cmBig.compress(mkMsgs(6))
    assert(rBig.stats.triggered === true, 'token 模式:大历史触发压缩')
    assert(rBig.stats.roundsSummarized >= 1, 'token 模式:至少摘 1 轮')
    assert(rBig.stats.compressedMessages < rBig.stats.originalMessages, 'token 模式:压缩后消息更少')
    assert(/token-window/.test(rBig.stats.strategy), 'token 模式:strategy 含 token-window')
    assert(rBig.messages[0].role === 'system', 'token 模式:首条为摘要 system 消息')

    // 轮数模式(无 contextWindow):现状兼容
    const cmRounds = useContextManager({ summaryThresholdRounds: 2, windowRounds: 1 })
    const rRounds = await cmRounds.compress(mkMsgs(4))
    assert(rRounds.stats.triggered === true, '轮数模式:超阈值触发')
    assert(/window/.test(rRounds.stats.strategy) && !/token/.test(rRounds.stats.strategy), '轮数模式:strategy 为 window+ 非 token')

    // 显式 contextWindow:0 关闭 token 模式回退轮数
    const cmZero = useContextManager({ contextWindow: 0, summaryThresholdRounds: 2, windowRounds: 1 })
    const rZero = await cmZero.compress(mkMsgs(4))
    assert(rZero.stats.triggered === true && !/token/.test(rZero.stats.strategy), 'contextWindow:0 → 回退轮数模式')

    // A + C:压缩时注入注册表快照 + preserveLastToolResults 保留指定工具结果摘要
    function mkMsgsWithSteps(n: number): any[] {
      const out: any[] = []
      for (let i = 0; i < n; i++) {
        out.push({ role: 'user', content: 'q' + i, timestamp: i * 2 })
        // 前 4 轮(将进 older)带 describe_data 步骤;后 2 轮(将进 recent)无步骤
        const steps = i < 4
          ? [{ name: 'describe_data', args: { path: 'app.x' }, result: '路径: app.x 说明: X属性 {a,b}', status: 'done' }]
          : []
        out.push({ role: 'assistant', content: 'a' + i + 'y'.repeat(300), steps, timestamp: i * 2 + 1 })
      }
      return out
    }
    const cmAC = useContextManager({
      summaryThresholdRounds: 4,
      windowRounds: 2,
      getRegisteredSlots: () => [{ path: 'app.x', description: 'X属性' }],
      preserveLastToolResults: ['describe_data'],
    })
    const rAC = await cmAC.compress(mkMsgsWithSteps(6))
    assert(rAC.stats.triggered, 'A/C:6 轮触发压缩')
    const sumAC = String(rAC.messages[0].content)
    assert(sumAC.includes('当前可操作数据'), 'A:摘要含注册表快照段')
    assert(sumAC.includes('app.x') && sumAC.includes('X属性'), 'A:摘要含注册 path 与 description')
    assert(sumAC.includes('字段提示'), 'C:摘要含 preserve 工具结果片段')
    assert(sumAC.includes('describe_data'), 'C:摘要含 preserve 工具名')
    // 未提供 getRegisteredSlots 时不注入该段(不污染摘要)
    const cmNoProps = useContextManager({ summaryThresholdRounds: 4, windowRounds: 2 })
    const rNoProps = await cmNoProps.compress(mkMsgsWithSteps(6))
    assert(!String(rNoProps.messages[0].content).includes('当前可操作数据'), 'A:未提供 getRegisteredSlots 时不注入注册表段')

    // #双摘要冲突修复:compress 提取头部 trimMemoryMessages 留下的旧摘要正文,并入新摘要(防累积历史丢失)
    const cmMerge = useContextManager({ summaryThresholdRounds: 2, windowRounds: 1 })
    // 模拟 trimMemoryMessages 已裁过:头部有【更早对话摘要】system,后跟若干轮
    const prevSummaryMsg: any = { role: 'system', content: '【更早对话摘要(2 轮)】\n- 第1轮:旧问题1 → 旧回复1\n- 第2轮:旧问题2 → 旧回复2', timestamp: 0 }
    const msgsAfterTrim = [prevSummaryMsg, ...mkMsgsWithSteps(4)]
    const rMerge = await cmMerge.compress(msgsAfterTrim)
    assert(rMerge.stats.triggered, '双摘要:头部含旧摘要 + 4 轮触发压缩')
    const mergedContent = String(rMerge.messages[0].content)
    assert(mergedContent.includes('更早累积摘要'), '双摘要:新摘要并入头部旧摘要正文(【更早累积摘要】段)')
    assert(mergedContent.includes('旧问题1') && mergedContent.includes('旧问题2'), '双摘要:旧摘要内容(旧问题1/2)不丢失,并入新摘要')
    assert(mergedContent.includes('对话历史摘要'), '双摘要:仍含本轮 older 的索引摘要段')

    // #getRegisteredData(新术语,单对象 data 模式):注入 description,无 path
    const cmData = useContextManager({
      summaryThresholdRounds: 2,
      windowRounds: 1,
      getRegisteredData: () => [{ description: '主数据对象:页面配置' }],
    })
    const rData = await cmData.compress(mkMsgsWithSteps(4))
    const dataContent = String(rData.messages[0].content)
    assert(dataContent.includes('当前可操作数据') && dataContent.includes('主数据对象:页面配置'), 'getRegisteredData:注入 description 到摘要')
  }
}
