import { z } from 'zod'
import { createDataSlotOps } from '../../tools/dataSlotOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataSlotToolset } from '../../toolsets'
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

// 树形(递归 children)声明与读写
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[window tree: 递归 children]')
  {
    // 递归 schema:节点含 children(自引用 z.lazy),passthrough 放行未声明字段
    const TreeNode: z.ZodType = z.object({
      id: z.number(),
      type: z.string(),
      text: z.string().optional(),
      children: z.array(z.lazy(() => TreeNode)).optional(),
    }).passthrough()

    ;(globalThis as any).window = {
      page: {
        components: [
          { id: 1, type: 'container', children: [
            { id: 2, type: 'card', text: 'A', children: [{ id: 4, type: 'card', text: 'A1' }] },
            { id: 3, type: 'card', text: 'B' },
          ] },
          { id: 5, type: 'card', text: 'C' },
        ],
      },
    }
    const tools = createDataSlotOps([
      { path: 'page.components', description: '组件树(递归 children)', schema: z.array(TreeNode) },
    ])
    const t = byName(tools)
    const w = (globalThis as any).window

    // 递归查所有 card(任意深度):$..*[?(@.type=="card")]
    let r = await invoke(t['query_data_slot'], { path: 'page.components', expr: '$..*[?(@.type=="card")]' })
    let parsed = JSON.parse(r)
    assert(parsed.matched === 3, '树查询: $..*[?(@.type=="card")] 递归找全部 3 个 card(任意深度)')
    // 父子同现不误判 [Circular]
    assert(!/\[Circular\]/.test(r), '树查询: 父子同现不被误判为 [Circular](各自独立序列化)')
    assert(parsed.results.some((x: any) => x.value.id === 4), '树查询: 最深 card#4 值完整返回(id=4)')

    // 增量改深层节点文本(jsonPath 定位)
    r = await invoke(t['edit_data_slot'], { path: 'page.components', op: 'set', jsonPath: '0.children.0.children.0.text', value: '"A1-改"' })
    assert(/已 edit/.test(r) && w.page.components[0].children[0].children[0].text === 'A1-改', 'edit: jsonPath 深层定位改子节点文本')

    // 递归 schema 校验:append 缺 id 的非法节点被拒
    r = await invoke(t['edit_data_slot'], { path: 'page.components', op: 'append', jsonPath: '0.children', value: '{"type":"bad"}' })
    assert(/SCHEMA_INVALID/.test(r), 'edit: 递归 schema 拒绝非法节点(缺 id),校验穿透到 children')

    // passthrough:节点可有未声明字段(extra/style)
    r = await invoke(t['edit_data_slot'], { path: 'page.components', op: 'merge', jsonPath: '1', value: '{"extra":"ok","style":{"color":"red"}}' })
    assert(w.page.components[1].extra === 'ok' && w.page.components[1].style?.color === 'red', 'edit: passthrough 保留未声明的额外字段')
  }
}
