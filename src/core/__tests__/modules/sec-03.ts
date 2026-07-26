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

// vfs
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[vfs]')
  {
    const store = createVfs({ 'notes.md': '# hello\nworld\nfoo bar baz' })
    const t = byName(createVfsTools(store))

    let r = await invoke(t['vfs_write'], { path: 'a.txt', content: 'line1\nline2\nline3' })
    assert(/已写入/.test(r), 'vfs_write')

    r = await invoke(t['vfs_read'], { path: 'a.txt' })
    assert(/line1/.test(r), 'vfs_read')

    r = await invoke(t['vfs_ls'], {})
    assert(/notes\.md/.test(r) && /a\.txt/.test(r), 'vfs_ls 列文件')

    r = await invoke(t['vfs_glob'], { pattern: '*.md' })
    assert(/notes\.md/.test(r) && !/a\.txt/.test(r), 'vfs_glob *.md 精确匹配')

    r = await invoke(t['vfs_grep'], { pattern: 'foo' })
    assert(/foo bar/.test(r), 'vfs_grep 内容搜索')

    r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'line2', newString: 'LINE2' })
    assert(/已替换/.test(r), 'vfs_edit 唯一替换')

    r = await invoke(t['vfs_read'], { path: 'a.txt', offset: 1, limit: 1 })
    assert(/LINE2/.test(r), 'vfs_read 分页(offset/limit)')

    // 内存上限 + LRU 淘汰:maxBytes 极小,写入超限 → 淘汰到 ≤ watermark(剩 2 个,无关哪个被删)
    const store2 = createVfs({}, { maxBytes: 30 })
    const t2 = byName(createVfsTools(store2))
    await invoke(t2['vfs_write'], { path: 'a.txt', content: 'A'.repeat(10) })
    await invoke(t2['vfs_write'], { path: 'b.txt', content: 'B'.repeat(10) })
    await invoke(t2['vfs_write'], { path: 'c.txt', content: 'C'.repeat(10) })
    await invoke(t2['vfs_write'], { path: 'd.txt', content: 'D'.repeat(10) }) // 总 40 > 30
    assert(Object.keys(store2.files).length === 2, 'vfs maxBytes 淘汰:超限后 LRU 删到 ≤ watermark(剩 2 个)')
  }
}
