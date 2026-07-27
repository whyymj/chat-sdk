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

import type { TestCtx } from './_ctx'

// dataOps:edit + 快照(单主对象)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[dataOps edit + snapshot]')
  {
    // 主数据:含对象/数组/叶子字段(edit 仅作用于对象/数组;叶子用 set_data 整体替换)
    const appObj: any = {
      cfg: { a: 1, name: 'x' },
      list: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }],
      theme: 'light' as 'light' | 'dark',
    }
    const tools = createDataOps({
      schema: z.object({
        cfg: z.object({ a: z.number(), name: z.string(), extra: z.string().optional() }),
        list: z.array(z.object({ id: z.number(), text: z.string() })),
        theme: z.enum(['light', 'dark']),
      }),
      bind: appObj,
      description: '应用配置',
    })
    const t = byName(tools)
    let r: string

    // edit set 子字段(jsonPath 相对主数据根)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'cfg.a', value: '99' })
    assert(appObj.cfg.a === 99 && /已 edit/.test(r), 'edit set 子字段生效')

    // edit merge 合并
    r = await invoke(t['edit_data'], { op: 'merge', jsonPath: 'cfg', value: '{"extra":"hi"}' })
    assert(appObj.cfg.extra === 'hi', 'edit merge 合并字段')

    // edit append 追加
    r = await invoke(t['edit_data'], { op: 'append', jsonPath: 'list', value: '{"id":3,"text":"c"}' })
    assert(appObj.list.length === 3 && appObj.list[2].id === 3, 'edit append 追加元素')

    // edit remove 删字段
    r = await invoke(t['edit_data'], { op: 'remove', jsonPath: 'cfg.extra' })
    assert(!('extra' in appObj.cfg), 'edit remove 删字段')

    // edit schema 失败 → live 不变(校验在副本,失败不入栈不落地)
    const beforeA = appObj.cfg.a
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'cfg.a', value: '"not a number"' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.cfg.a === beforeA, 'edit 校验失败 live 未变(结构化错误码)')

    // edit 不安全路径:PATH_UNSAFE
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: '__proto__.x', value: '1' })
    assert(/PATH_UNSAFE/.test(r), 'edit __proto__ → PATH_UNSAFE')

    // 自动快照:set/edit 前自动入栈 → list 有记录
    r = await invoke(t['list_data_snapshots'], {})
    assert(/#1/.test(r), 'list_data_snapshots 列出自动快照')

    // 手动快照(命名检查点)
    r = await invoke(t['snapshot_data'], { label: '检查点A' })
    assert(/检查点A/.test(r), 'snapshot_data 手动快照')

    // restore 到 #1(初始 a=1),先破坏再回退
    appObj.cfg.a = 99999
    r = await invoke(t['restore_data'], { id: 1 })
    assert(appObj.cfg.a === 1, 'restore_data 回退到指定快照(初始 a=1)')

    // restore 不入栈:已有快照(含检查点A)保留
    r = await invoke(t['list_data_snapshots'], {})
    assert(/检查点A/.test(r), 'restore 不入栈(已有快照保留)')

    // get_data 支持读后代子路径(精确读局部,而非整体)
    r = await invoke(t['get_data'], { jsonPath: 'cfg.a' })
    assert(/cfg\.a = 1/.test(r), 'get_data 读后代子路径(局部)')

    // get_data 读整个主数据
    r = await invoke(t['get_data'], {})
    assert(/cfg/.test(r) && /list/.test(r), 'get_data 不传 jsonPath 读整个主数据')
  }

  // ============ 工具报错机制(结构化 ERROR:{json},供 LLM 排查)============
  console.log('\n[tool errors]')
  {
    const appObj: any = { theme: 'dark', count: 5, cfg: { a: 1 } }
    const tools = createDataOps({
      schema: z.object({
        theme: z.enum(['light', 'dark']),
        count: z.number().int().min(0),
        cfg: z.object({ a: z.number(), name: z.string().optional() }),
      }),
      bind: appObj,
      description: '应用配置',
    })
    const t = byName(tools)

    // schema 失败:details 含 zod issues(path/expected/received)
    let r = await invoke(t['set_data'], { value: '{ "theme":"dark","count":"x","cfg":{"a":1} }' })
    assert(/"error":\s*"SCHEMA_INVALID"/.test(r), 'schema 失败 → error=SCHEMA_INVALID')
    const detailMatch = r.match(/"details":\s*(\[[^\]]*\])/)
    assert(detailMatch && /expected/.test(detailMatch[1]) && /received/.test(detailMatch[1]), 'schema 失败 details 含 zod issue 的 expected/received')

    // JSON 解析失败:带原解析错误 + 预览
    r = await invoke(t['set_data'], { value: '{bad' })
    assert(/"error":\s*"JSON_PARSE"/.test(r) && /预览|bad/.test(r), 'JSON 解析失败 → error=JSON_PARSE + 预览')

    // edit 非对象(叶子 theme):NOT_OBJECT + hint 指向 set
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'theme.x', value: '1' })
    // theme 是叶子字符串,edit jsonPath 'theme.x' 在叶子下设子属性 → 整体 schema 校验会失败(因 theme 应为 string)
    // 实际:edit 在 clone 上 setByPath('theme.x'),theme 变成 {x:'1'} 不符 schema → SCHEMA_INVALID
    assert(/SCHEMA_INVALID|NOT_OBJECT/.test(r), 'edit 在叶子上设子属性 → schema 失败(叶子不可有子属性)')

    // edit 不安全路径:PATH_UNSAFE
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'cfg.__proto__.x', value: '1' })
    assert(/"error":\s*"PATH_UNSAFE"/.test(r), 'edit __proto__ → PATH_UNSAFE')

    // query 语法错误:JSONPATH_SYNTAX + details.expr
    r = await invoke(t['query_data'], { expr: '$[?(@.x==' })
    assert(/"error":\s*"JSONPATH_SYNTAX"/.test(r) && /"expr"/.test(r), 'query 语法错 → JSONPATH_SYNTAX + details.expr')

    // 正常成功:不是 ERROR 前缀
    r = await invoke(t['get_data'], { jsonPath: 'theme' })
    assert(!/^ERROR:/.test(r) && /dark/.test(r), '正常读不返回 ERROR 前缀')
  }

  // ============ vfs 报错(正则/glob 不抛,edit 多匹配给位置)============
  console.log('\n[vfs errors]')
  {
    const vfs = createVfs({ 'a.txt': 'line1 foo\nline2 foo\nline3 bar' })
    const tools = createVfsTools(vfs)
    const t = byName(tools)

    // grep 非法正则:返回 toolError 而非抛异常
    let r = await invoke(t['vfs_grep'], { pattern: '(' })
    assert(/"error":\s*"REGEX_INVALID"/.test(r), 'vfs_grep 非法正则 → REGEX_INVALID(不抛异常)')

    // glob 正常匹配
    r = await invoke(t['vfs_glob'], { pattern: '*.txt' })
    assert(/a\.txt/.test(r), 'vfs_glob 正常匹配 *.txt')

    // edit 多匹配:AMBIGUOUS_MATCH + matches 位置
    r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'foo', newString: 'baz' })
    assert(/"error":\s*"AMBIGUOUS_MATCH"/.test(r) && /"matches"/.test(r), 'vfs_edit 多匹配 → AMBIGUOUS_MATCH + matches 位置')

    // edit 未找到:NO_MATCH
    r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'nope', newString: 'x' })
    assert(/"error":\s*"NO_MATCH"/.test(r), 'vfs_edit 未找到 → NO_MATCH')

    // read 未找到:NOT_FOUND
    r = await invoke(t['vfs_read'], { path: 'missing.txt' })
    assert(/"error":\s*"NOT_FOUND"/.test(r), 'vfs_read 未找到 → NOT_FOUND')
  }

  // ============ offload(大结果外存)============
  console.log('\n[offload]')
  {
    // 小结果原样
    const small = offloadLargeResult('hello', { toolName: 't', vfsAvailable: true, files: {} })
    assert(small === 'hello', '小结果(≤阈值)原样返回')

    // 大结果 + vfs 可用 → 外存 + 预览引用
    const big = 'x'.repeat(10000)
    const files: Record<string, { content: string; updatedAt: number }> = {}
    const offloaded = offloadLargeResult(big, { toolName: 'get_x', vfsAvailable: true, files, threshold: 6000 })
    const keys = Object.keys(files)
    assert(/已转存到虚拟工作区/.test(offloaded) && keys.length === 1, '大结果+vfs可用 → 外存并返回预览引用')
    assert(files[keys[0]].content === big && /get_x/.test(keys[0]), '外存内容完整 + 文件名含工具名')

    // 大结果 + vfs 不可用 → 按放行上限
    const passThrough = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000, passThroughChars: 20000 })
    assert(passThrough === big, 'vfs 不可用 + 结果 ≤ 放行上限 → 完整放行(不截断)')
    const stillTruncated = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000, passThroughChars: 5000 })
    assert(/已截断/.test(stillTruncated) && stillTruncated.length < big.length, 'vfs 不可用 + 结果 > 放行上限 → 截断兜底')
    const defaultTrunc = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000 })
    assert(/已截断/.test(defaultTrunc), 'vfs 不可用 + 未传 passThrough → 默认截断(= threshold)')

    // 内容寻址去重:相同内容 → 相同文件名,反复外存不新增文件
    const files2: Record<string, { content: string; updatedAt: number }> = {}
    const bigA = 'A'.repeat(10000)
    const r1 = offloadLargeResult(bigA, { toolName: 'load_skill', vfsAvailable: true, files: files2, threshold: 6000 })
    const keys1 = Object.keys(files2)
    const r2 = offloadLargeResult(bigA, { toolName: 'load_skill', vfsAvailable: true, files: files2, threshold: 6000 })
    const keys2 = Object.keys(files2)
    assert(keys1.length === 1 && keys2.length === 1 && keys1[0] === keys2[0], '内容寻址去重:相同内容 → 相同文件名,反复外存不新增文件')
    assert(files2[keys1[0]].content === bigA, '外存内容完整')
    // 不同内容 → 不同文件名
    const bigB = 'B'.repeat(10000)
    offloadLargeResult(bigB, { toolName: 'load_skill', vfsAvailable: true, files: files2, threshold: 6000 })
    assert(Object.keys(files2).length === 2, '不同内容 → 不同文件名(各一份)')
  }
}
