import { z } from 'zod'
import { createWindowOps } from '../../tools/windowOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineWindowToolset } from '../../toolsets'
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
import { jpEval, searchJson } from '../../tools/windowQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// 压缩预设档位 resolveContextOptions
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[context preset]')
  {
    // auto 默认:LLM 摘要开、召回 3、阈值 0.5、窗口 0.4
    const auto = resolveContextOptions({}, 1_048_576)
    assert(auto.enableLLMSummary === true, 'preset auto: enableLLMSummary 默认 true')
    assert(auto.recallTopK === 3, 'preset auto: recallTopK=3')
    assert(auto.summaryThresholdRatio === 0.5, 'preset auto: threshold=0.5')
    assert(auto.windowRatio === 0.4, 'preset auto: window=0.4')
    assert(auto.contextWindow === 1_048_576, 'preset auto: contextWindow 回退模型表值')

    // conservative:更晚触发、保留更多、召回 2、关 LLM 摘要(省成本)
    const cons = resolveContextOptions({ contextPreset: 'conservative' }, 131072)
    assert(cons.enableLLMSummary === false, 'preset conservative: enableLLMSummary=false(零成本索引摘要)')
    assert(cons.summaryThresholdRatio === 0.7, 'preset conservative: threshold=0.7')
    assert(cons.windowRatio === 0.5, 'preset conservative: window=0.5')
    assert(cons.recallTopK === 2, 'preset conservative: recallTopK=2')

    // aggressive:更早触发、保留少、召回 5、LLM 摘要开
    const agg = resolveContextOptions({ contextPreset: 'aggressive' }, 32768)
    assert(agg.summaryThresholdRatio === 0.3, 'preset aggressive: threshold=0.3')
    assert(agg.windowRatio === 0.3, 'preset aggressive: window=0.3')
    assert(agg.recallTopK === 5, 'preset aggressive: recallTopK=5')
    assert(agg.enableLLMSummary === true, 'preset aggressive: enableLLMSummary=true')

    // 细参覆盖 preset:aggressive 但单独把召回调到 8
    const override = resolveContextOptions({ contextPreset: 'aggressive', contextOptions: { recallTopK: 8 } }, 32768)
    assert(override.recallTopK === 8, 'preset 覆盖:contextOptions.recallTopK 覆盖 preset')
    assert(override.summaryThresholdRatio === 0.3, 'preset 覆盖:未覆盖字段仍用 preset(aggressive 0.3)')

    // 细参覆盖 enableLLMSummary:conservative 关 LLM,但用户强制开
    const forceLlm = resolveContextOptions({ contextPreset: 'conservative', contextOptions: { enableLLMSummary: true } }, 131072)
    assert(forceLlm.enableLLMSummary === true, 'preset 覆盖:contextOptions.enableLLMSummary 强制覆盖 preset(false)')

    // contextWindow 显式 0:关闭 token 模式回退轮数(保留用户显式值)
    const zeroWin = resolveContextOptions({ contextOptions: { contextWindow: 0 } }, 1_048_576)
    assert(zeroWin.contextWindow === 0, 'preset:contextOptions.contextWindow=0 保留(回退轮数模式)')

    // contextOptions:false 视为空,用 preset 默认
    const falseOpts = resolveContextOptions({ contextOptions: false }, 131072)
    assert(falseOpts.enableLLMSummary === true && falseOpts.recallTopK === 3, 'contextOptions:false → 用 auto preset 默认')
  }

  // ============ 大 JSON 查询/搜索(query_window_prop / search_window_prop)============
  console.log('\n[window query + search]')
  {
    const data = {
      components: [
        { type: 'card', title: '商品卡片A', price: 50, stock: 3 },
        { type: 'list', title: '列表B', price: 200, stock: 0 },
        { type: 'card', title: '商品卡片C', price: 80, stock: 5 },
      ],
      meta: { total: 3, owner: { name: '张三', city: '北京' } },
    }
    ;(globalThis as any).window = { page: data }
    const tools = createWindowOps([
      { path: 'page', description: '页面', schema: z.any() },
    ])
    const t = byName(tools)

    // jpEval 纯函数:过滤数组(需先 .components 再过滤)
    let nodes = jpEval(data, '$.components[?(@.type=="card" && @.price<100)]')
    assert(nodes.length === 2 && nodes[0].index === 0 && nodes[1].index === 2, 'jpEval: 过滤 card 且 price<100 → 命中 index 0/2')

    // 递归找后代
    nodes = jpEval(data, '$..title')
    assert(nodes.length === 3 && nodes.some((n) => n.value === '商品卡片C'), 'jpEval: $..title 递归找全部 title')

    // 点号路径 + 索引
    nodes = jpEval(data, '$.components.1.title')
    assert(nodes.length === 1 && nodes[0].value === '列表B', 'jpEval: $.components.1.title 精确定位')

    // 通配
    nodes = jpEval(data, '$.components[*].type')
    assert(nodes.length === 3, 'jpEval: $.components[*].type 通配展开')

    // 工具包装:query_window_prop
    let r = await invoke(t['query_window_prop'], { path: 'page', expr: '$.components[?(@.stock==0)]' })
    let parsed = JSON.parse(r)
    assert(parsed.matched === 1 && parsed.results[0].index === 1, 'query_window_prop: stock==0 → 命中 index 1')

    // 工具包装:未注册属性拒绝
    r = await invoke(t['query_window_prop'], { path: 'nope', expr: '$' })
    assert(/未注册/.test(r), 'query_window_prop: 未注册属性被拒')

    // 工具包装:语法错误返回错误信息(不抛)
    r = await invoke(t['query_window_prop'], { path: 'page', expr: '$[?(@.x==' })
    assert(/JSONPath/.test(r), 'query_window_prop: 语法错误返回错误信息')

    // searchJson 子串
    let hits = searchJson(data, '卡片')
    assert(hits.length === 2, 'searchJson: substring "卡片" → 命中 2 个 title')

    // searchJson 模糊(记不清)
    hits = searchJson(data, '商品卡A', { mode: 'fuzzy', fuzzyThreshold: 2 })
    assert(hits.length >= 1, 'searchJson: fuzzy "商品卡A" 近似命中 "商品卡片A"')

    // searchJson 正则
    hits = searchJson(data, '^商品', { mode: 'regex' })
    assert(hits.length === 2, 'searchJson: regex ^商品 → 命中 2')

    // 工具包装:search_window_prop
    r = await invoke(t['search_window_prop'], { path: 'page', query: '北京' })
    parsed = JSON.parse(r)
    assert(parsed.matched === 1 && /北京/.test(parsed.results[0].value), 'search_window_prop: 命中 owner.city')

    // 工具数量:10 + 3 新工具 = 13
    assert(tools.length === 13, 'createWindowOps: 含 13 个工具(10 原有 + query/search/eval)')

    // eval_window_script 工具存在(node 无 Worker,仅校验装配 + 未注册拒绝)
    assert(!!t['eval_window_script'], 'eval_window_script 工具已装配')
    r = await invoke(t['eval_window_script'], { path: 'nope', script: 'data' })
    assert(/未注册/.test(r), 'eval_window_script: 未注册属性被拒')
  }
}
