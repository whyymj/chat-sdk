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

// 树形(递归 children)声明与读写(单主对象)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[data tree: 递归 children]')
  {
    // 递归 schema:节点含 children(自引用 z.lazy),passthrough 放行未声明字段
    const TreeNode: z.ZodType = z.object({
      id: z.number(),
      type: z.string(),
      text: z.string().optional(),
      children: z.array(z.lazy(() => TreeNode)).optional(),
    }).passthrough()

    const pageObj: any = {
      components: [
        { id: 1, type: 'container', children: [
          { id: 2, type: 'card', text: 'A', children: [{ id: 4, type: 'card', text: 'A1' }] },
          { id: 3, type: 'card', text: 'B' },
        ] },
        { id: 5, type: 'card', text: 'C' },
      ],
    }
    const tools = createDataOps({
      schema: z.object({ components: z.array(TreeNode) }),
      bind: pageObj,
      description: '组件树(递归 children)',
    })
    const t = byName(tools)

    // 递归查所有 card(任意深度):$..*[?(@.type=="card")]
    let r = await invoke(t['query_data'], { expr: '$..*[?(@.type=="card")]' })
    let parsed = JSON.parse(r)
    assert(parsed.matched === 4, '树查询: $..*[?(@.type=="card")] 递归找全部 4 个 card(任意深度)')
    // 父子同现不误判 [Circular]
    assert(!/\[Circular\]/.test(r), '树查询: 父子同现不被误判为 [Circular](各自独立序列化)')
    assert(parsed.results.some((x: any) => x.value.id === 4), '树查询: 最深 card#4 值完整返回(id=4)')

    // 增量改深层节点文本(jsonPath 相对主数据根)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'components.0.children.0.children.0.text', value: '"A1-改"' })
    assert(/已 edit/.test(r) && pageObj.components[0].children[0].children[0].text === 'A1-改', 'edit: jsonPath 深层定位改子节点文本')

    // 递归 schema 校验:append 缺 id 的非法节点被拒
    r = await invoke(t['edit_data'], { op: 'append', jsonPath: 'components.0.children', value: '{"type":"bad"}' })
    assert(/SCHEMA_INVALID/.test(r), 'edit: 递归 schema 拒绝非法节点(缺 id),校验穿透到 children')

    // passthrough:节点可有未声明字段(extra/style)
    r = await invoke(t['edit_data'], { op: 'merge', jsonPath: 'components.1', value: '{"extra":"ok","style":{"color":"red"}}' })
    assert(pageObj.components[1].extra === 'ok' && pageObj.components[1].style?.color === 'red', 'edit: passthrough 保留未声明的额外字段')

    // 修复 1:read 子路径应按子 schema 递归投影,隐藏 child 不可见字段(components.1 有 extra,read 应不含 extra)
    r = await invoke(t['read'], { jsonPath: 'components.1' })
    assert(!/"extra"/.test(r), '修复1: read 子路径隐藏 child 未声明字段(extra 不泄露给 LLM)')
    // 但 schema 声明字段仍可见
    assert(/"id":\s*5/.test(r), '修复1: read 子路径保留 schema 声明字段(id 可见)')

    // 修复 1:read 更深子路径 components.0.children.0 也按子 schema 投影
    r = await invoke(t['read'], { jsonPath: 'components.0.children.0' })
    assert(/"id":\s*2/.test(r) && !/"extra"/.test(r), '修复1: read 深层子路径也按子 schema 投影隐藏未声明字段')

    // 修复 1:isPathAllowed 逐段检查 —— 读非 schema 声明的深层字段被拒
    r = await invoke(t['read'], { jsonPath: 'components.1.extra' })
    assert(/PATH_DENIED/.test(r), '修复1: read 非 schema 声明的深层字段 → PATH_DENIED(逐段校验)')

    // L2: read 非法段(__proto__)→ 显式 PATH_UNSAFE(原:依赖 getByPath 内部兜底返 undefined → 报"(undefined)"不清晰,LLM 可能误判数据缺失去 set)
    r = await invoke(t['read'], { jsonPath: 'components.__proto__' })
    assert(/PATH_UNSAFE/.test(r), 'L2: read __proto__ 等非法段 → PATH_UNSAFE(非 undefined)')
  }
}
