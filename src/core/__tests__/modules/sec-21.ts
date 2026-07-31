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

  // ============ 大 JSON 查询/搜索(query_data / search_data)============
  console.log('\n[data query + search]')
  {
    const data = {
      components: [
        { type: 'card', title: '商品卡片A', price: 50, stock: 3 },
        { type: 'list', title: '列表B', price: 200, stock: 0 },
        { type: 'card', title: '商品卡片C', price: 80, stock: 5 },
      ],
      meta: { total: 3, owner: { name: '张三', city: '北京' } },
    }
    const tools = createDataOps({ schema: z.any(), bind: data, description: '页面' })
    const t = byName(tools)

    // jpEval 纯函数:过滤数组
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

    // 工具包装:query_data(无 path,直接对主数据)
    let r = await invoke(t['query_data'], { expr: '$.components[?(@.stock==0)]' })
    let parsed = JSON.parse(r)
    assert(parsed.matched === 1 && parsed.results[0].index === 1, 'query_data: stock==0 → 命中 index 1')

    // 工具包装:语法错误返回错误信息(不抛)
    r = await invoke(t['query_data'], { expr: '$[?(@.x==' })
    assert(/JSONPath/.test(r), 'query_data: 语法错误返回错误信息')

    // searchJson 子串
    let hits = searchJson(data, '卡片')
    assert(hits.length === 2, 'searchJson: substring "卡片" → 命中 2 个 title')

    // searchJson 模糊(记不清)
    hits = searchJson(data, '商品卡A', { mode: 'fuzzy', fuzzyThreshold: 2 })
    assert(hits.length >= 1, 'searchJson: fuzzy "商品卡A" 近似命中 "商品卡片A"')

    // searchJson 正则
    hits = searchJson(data, '^商品', { mode: 'regex' })
    assert(hits.length === 2, 'searchJson: regex ^商品 → 命中 2')

    // 工具包装:search_data(无 path)
    r = await invoke(t['search_data'], { query: '北京' })
    parsed = JSON.parse(r)
    assert(parsed.matched === 1 && /北京/.test(parsed.results[0].value), 'search_data: 命中 owner.city')

    // 工具数量:13(describe/get/set/edit/delete/snapshot/list/restore/query/search/eval/read/write)
    assert(tools.length === 13, 'createDataOps: 含 13 个工具(11 基础 + read/write 高层入口)')

    // eval_script 工具存在(装配检查;node 无 Worker,不实际跑)
    assert(!!t['eval_script'], 'eval_script 工具已装配')
    // 脚本过长 → SCRIPT_TOO_LARGE(不跑 Worker,纯长度校验)
    r = await invoke(t['eval_script'], { script: 'x'.repeat(9000) })
    assert(/SCRIPT_TOO_LARGE/.test(r), 'eval_script: 脚本过长 → SCRIPT_TOO_LARGE')
  }

  // ============ read/write 高层工具(单主对象 + 自动锁 + 拦截器)============
  console.log('\n[read/write 高层工具]')
  {
    const pageObj: any = { title: '原标题', items: ['a', 'b'] }
    const tools = createDataOps(
      { schema: z.object({ title: z.string(), items: z.array(z.string()) }), bind: pageObj, description: '页面数据' },
      { autoLock: true },
    )
    const t = byName(tools)

    // read() 无 jsonPath → 返回说明 + 格式提示
    let r = await invoke(t['read'], {})
    assert(/页面数据/.test(r), 'read() 无 jsonPath → 返回主数据说明')

    // read({jsonPath}) → 返回当前值 + hash
    r = await invoke(t['read'], { jsonPath: 'title' })
    assert(/原标题/.test(r) && /hash=/.test(r), 'read({jsonPath}) → 返回当前值 + hash')

    // write 整体 set(value 直传 JSON 对象)
    r = await invoke(t['write'], { value: { title: '新标题', items: ['x'] } })
    assert(/已 write\(set\)/.test(r) && /新标题/.test(r), 'write 整体 set(直传 object)→ 写入成功')
    assert(pageObj.title === '新标题', 'write set → 实际写入 bind')

    // write 增量 patch(merge)
    r = await invoke(t['write'], { value: { title: '合并标题' }, patch: { op: 'merge' } })
    assert(/已 write\(edit\)/.test(r) && pageObj.title === '合并标题', 'write patch merge → 增量合并')

    // write 增量 patch(append)
    r = await invoke(t['write'], { value: 'c', patch: { op: 'append', jsonPath: 'items' } })
    assert(pageObj.items.length === 2, 'write patch append → 数组追加')

    // write 非法值 → schema 校验失败不写入
    r = await invoke(t['write'], { value: { title: 123, items: [] } })
    assert(/校验失败|invalid|SCHEMA_INVALID/.test(r), 'write 非法值(title 非字符串)→ schema 校验失败')

    // write del:true → 删除子路径
    r = await invoke(t['write'], { patch: { op: 'remove', jsonPath: 'items' }, del: true })
    assert(/已删除/.test(r), 'write del:true → 删除子路径')

    // 自动乐观锁:read 后外部改值,write 触发 VERSION_CONFLICT
    const page3: any = { v: 1 }
    const tools3 = createDataOps({ schema: z.object({ v: z.number() }), bind: page3, description: 'p3' }, { autoLock: true })
    const t3 = byName(tools3)
    await invoke(t3['read'], { jsonPath: 'v' })  // 记录 hash
    page3.v = 999    // 外部改值(hash 变)
    r = await invoke(t3['write'], { value: { v: 2 } })
    assert(/VERSION_CONFLICT/.test(r), 'write autoLock:read 后外部改值 → 自动乐观锁触发冲突')

    // 拦截器:read 拦截脱敏(read() 无 jsonPath 读整个 bind,经拦截器脱敏)
    const page4: any = { secret: '密码123', title: '公开' }
    const tools4 = createDataOps(
      { schema: z.any(), bind: page4, description: 'p4' },
      { interceptors: { read: (v) => ({ ...(v as any), secret: '***' }) } },
    )
    const t4 = byName(tools4)
    r = await invoke(t4['read'], {})
    assert(/\*\*\*/.test(r) && !/密码123/.test(r), 'read 拦截器 → 脱敏(原始值不泄露给 LLM)')

    // 拦截器:write 拦截拒绝
    const page5: any = {}
    const tools5 = createDataOps(
      { schema: z.any(), bind: page5, description: 'p5' },
      { interceptors: { write: () => ({ error: '禁止写入' }) } },
    )
    const t5 = byName(tools5)
    r = await invoke(t5['write'], { value: { x: 1 } })
    assert(/WRITE_INTERCEPT|禁止写入/.test(r), 'write 拦截器拒绝 → 返回拦截错误')

    // 拦截器:write 拦截转换
    const page6: any = { name: 'old' }
    const tools6 = createDataOps(
      { schema: z.object({ name: z.string() }), bind: page6, description: 'p6' },
      { interceptors: { write: (payload) => ({ name: (payload as any).name?.toUpperCase() }) } },
    )
    const t6 = byName(tools6)
    r = await invoke(t6['write'], { value: { name: 'abc' } })
    assert(page6.name === 'ABC', 'write 拦截器转换 → 值经拦截器改写后落地')

    // LEAF_BIND:叶子 bind 的 set_data/write(set) 拒绝(不静默丢失)
    const leaf = '原始字符串' as any
    const leafTools = createDataOps({ schema: z.string(), bind: leaf, description: 'leaf' })
    const lt = byName(leafTools)
    r = await invoke(lt['set_data'], { value: '"新值"' })
    assert(/LEAF_BIND/.test(r), 'set_data 叶子 bind → LEAF_BIND 拒绝(不静默丢失)')
    r = await invoke(lt['write'], { value: '"新值"' })
    assert(/LEAF_BIND/.test(r), 'write(set) 叶子 bind → LEAF_BIND 拒绝')

    // edit 模式拦截器生效(#3 修复):拦截器收到 {op,jsonPath,value} 并能改 value
    const page7: any = { items: ['a'] }
    const tools7 = createDataOps(
      { schema: z.object({ items: z.array(z.string()) }), bind: page7, description: 'p7' },
      { interceptors: { write: (payload) => (payload as any).value?.toUpperCase() } },
    )
    const t7 = byName(tools7)
    r = await invoke(t7['write'], { value: 'b', patch: { op: 'append', jsonPath: 'items' } })
    assert(page7.items.length === 2 && page7.items[1] === 'B', 'write edit 模式拦截器 → 收到 value 并转换后落地(原 bug:edit 模式拦截器失效)')

    // 修复 3:write edit 单 patch + 透传拦截器(返回 {op,jsonPath,value} 原样)→ 应取 .value 落地,不应把整个对象当 value(原 bug:payload=intercepted 导致 SCHEMA_INVALID)
    const pagePassthrough: any = { title: 'old', components: [{ type: 'x', id: 'c1' }] }
    const toolsPassthrough = createDataOps(
      { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), id: z.string() })) }), bind: pagePassthrough, description: 'p-passthrough' },
      { interceptors: { write: (payload) => payload } }, // 透传:原样返回 {op,jsonPath,value}
    )
    const tPassthrough = byName(toolsPassthrough)
    r = await invoke(tPassthrough['write'], { value: '新标题', patch: { op: 'set', jsonPath: 'title' } })
    assert(pagePassthrough.title === '新标题', '修复3: write edit 单 patch + 透传拦截器 → 取 .value 落地(原 bug:把 {op,jsonPath,value} 整个对象当 value 写入 → SCHEMA_INVALID)')

    // 修复 2:set 整对象 + interceptors.write 补充不可见字段 → 补充字段写回 bind(原 bug:schema strip + safeMerge 丢失补充)
    const pageSupp: any = { title: 'old', _internal: 'keep' }
    const toolsSupp = createDataOps(
      { schema: z.object({ title: z.string() }), bind: pageSupp, description: 'p-supp' },
      { interceptors: { write: (payload) => ({ ...(payload as any), _internal: 'auto-supplied' }) } },
    )
    const tSupp = byName(toolsSupp)
    r = await invoke(tSupp['write'], { value: { title: 'new' } })
    assert(pageSupp.title === 'new' && pageSupp._internal === 'auto-supplied', '修复2: write(set) 整对象 + 拦截器补充不可见字段 → 补充字段写回 bind(不丢)')
    // set_data 同样行为(用户显式传不可见字段也写回,白名单 merge 语义防误删但不阻显式传值)
    const pageSupp2: any = { title: 'old', _internal: 'keep' }
    const toolsSupp2 = createDataOps({ schema: z.object({ title: z.string() }), bind: pageSupp2, description: 'p-supp2' })
    const tSupp2 = byName(toolsSupp2)
    r = await invoke(tSupp2['set_data'], { value: { title: 'new2', _internal: 'user-supplied' } })
    assert(pageSupp2.title === 'new2' && pageSupp2._internal === 'user-supplied', '修复2: set_data 整对象显式传不可见字段 → 写回 bind(白名单 merge 防误删,显式传值生效)')

    // 字符串 value parse 一致性(统一启发式)
    const page8: any = { count: 0, list: [] as any[] }
    const tools8 = createDataOps({ schema: z.object({ count: z.number(), list: z.array(z.any()) }), bind: page8, description: 'p8' })
    const t8 = byName(tools8)
    r = await invoke(t8['edit_data'], { op: 'set', jsonPath: 'count', value: '5' })
    assert(page8.count === 5, 'edit_data 裸数字字符串 "5" → parse 成数字 5')
    r = await invoke(t8['edit_data'], { op: 'append', jsonPath: 'list', value: 'c' })
    assert(page8.list[0] === 'c', 'edit_data 裸字符串 "c" → 当原值字符串(parse 失败 fallback)')
    r = await invoke(t8['set_data'], { value: '{bad' })
    assert(/JSON_PARSE/.test(r), 'set_data "{bad" → JSON_PARSE(以 { 开头按 JSON 解析失败报错)')

    // #优化1:write 批量 patches(一次原子应用多个 patch)
    const page9: any = { title: 't', a: 1, b: 2, items: ['x'] }
    const tools9 = createDataOps({ schema: z.object({ title: z.string(), a: z.number(), b: z.number(), items: z.array(z.string()) }), bind: page9, description: 'p9' })
    const t9 = byName(tools9)
    r = await invoke(t9['write'], { patches: [
      { op: 'set', jsonPath: 'title', value: '新标题' },
      { op: 'set', jsonPath: 'a', value: 10 },
      { op: 'append', jsonPath: 'items', value: 'y' },
    ] })
    assert(page9.title === '新标题' && page9.a === 10 && page9.items.length === 2 && page9.items[1] === 'y', 'write 批量 patches → 一次原子应用多个 patch 全部生效')
    // 批量中任一 patch 非法 → 整体不写入(回滚)
    const beforeA = page9.a
    r = await invoke(t9['write'], { patches: [
      { op: 'set', jsonPath: 'a', value: 99 },
      { op: 'set', jsonPath: 'b', value: '非数字' },  // schema 拒绝(b 应为 number)
    ] })
    assert(/SCHEMA_INVALID|校验失败/.test(r) && page9.a === beforeA, 'write 批量 patches 任一非法 → 整体不写入(原子回滚)')

    // #优化2:read 字段裁剪 + 深度截断
    const page10: any = { title: 'T', meta: { author: 'me', ts: 123, deep: { x: 1 } }, list: [{ id: 1, name: 'a', extra: 'x' }, { id: 2, name: 'b', extra: 'y' }] }
    const tools10 = createDataOps({ schema: z.any(), bind: page10, description: 'p10' })
    const t10 = byName(tools10)
    r = await invoke(t10['read'], { jsonPath: 'list', fields: ['id', 'name'] })
    assert(/"id":1/.test(r) && /"name":"a"/.test(r) && !/extra/.test(r), 'read fields 裁剪 → 只返回指定字段(extra 不出现)')
    r = await invoke(t10['read'], { jsonPath: 'meta', depth: 1 })
    assert(/"author":"me"/.test(r) && /\{\.\.\.\}/.test(r) && !/"x":1/.test(r), 'read depth=1 → 第 2 层用 {...} 占位(deep.x 截断)')
    r = await invoke(t10['read'], { jsonPath: 'list', fields: ['id'], depth: 2 })
    assert(/"id":1/.test(r) && !/name/.test(r), 'read fields + depth 组合 → 先裁字段再截深度(id 保留,extra/name 裁掉)')

    // #优化3:eval_script transform 增量 patches(返回 {patches:[...]} 而非完整新值)
    // 注:沙箱 Worker 在 Node.js 不可用,此处仅校验 transform patches 的入参解析逻辑(脚本不实际执行,用 mock 替换 runSandboxedScript 不可行,改为验证描述/schema 含 patches 提示)
    const evalDesc = (t10['eval_script'] as any).description || ''
    assert(/patches/.test(evalDesc), 'eval_script 描述含 patches 增量模式说明')

    // #白名单:schema 形状自动限制可见性 + 可写性(ZodObject 子集 + 完整大 JSON bind)
    const bigJson: any = { title: '公开标题', components: [{ id: 1 }], secret: '机密字段', internalState: { flag: true } }
    const wlTools = createDataOps({
      schema: z.object({  // schema 只声明 title + components,隐藏 secret + internalState
        title: z.string(),
        components: z.array(z.object({ id: z.number() })),
      }),
      bind: bigJson,
      description: '白名单示例',
    })
    const wlt = byName(wlTools)
    // read 整体 → 只返回 schema 声明字段(secret/internalState 隐藏)
    r = await invoke(wlt['read'], {})
    assert(/公开标题/.test(r) && /components/.test(r) && !/机密字段/.test(r) && !/internalState/.test(r), '白名单 read 整体 → 隐藏未声明字段(secret/internalState 不暴露)')
    // read 非声明字段 → PATH_DENIED
    r = await invoke(wlt['read'], { jsonPath: 'secret' })
    assert(/PATH_DENIED/.test(r), '白名单 read 非声明字段 → PATH_DENIED')
    // edit 非声明字段 → PATH_DENIED
    r = await invoke(wlt['edit_data'], { op: 'set', jsonPath: 'secret', value: '"泄露"' })
    assert(/PATH_DENIED/.test(r) && bigJson.secret === '机密字段', '白名单 edit 非声明字段 → PATH_DENIED(不写入)')
    // delete 非声明字段 → PATH_DENIED
    r = await invoke(wlt['delete_data'], { jsonPath: 'secret' })
    assert(/PATH_DENIED/.test(r) && bigJson.secret === '机密字段', '白名单 delete 非声明字段 → PATH_DENIED(不删除)')
    // set_data 整体 → merge 语义(只更新声明字段,隐藏字段保留不动,防误删)
    r = await invoke(wlt['set_data'], { value: { title: '新标题', components: [{ id: 2 }] } })
    assert(bigJson.title === '新标题' && bigJson.secret === '机密字段' && bigJson.internalState.flag === true, '白名单 set_data → merge 语义:更新声明字段,隐藏字段(secret/internalState)保留不动')
    // write(set) 整体 → 同样 merge 语义
    r = await invoke(wlt['write'], { value: { title: '又改', components: [] } })
    assert(bigJson.title === '又改' && bigJson.secret === '机密字段', '白名单 write(set) → merge 语义:隐藏字段保留')
    // query_data → 只查白名单字段(隐藏字段不参与查询)
    r = await invoke(wlt['query_data'], { expr: '$..*' })
    assert(!/机密字段/.test(r) && !/internalState/.test(r), '白名单 query_data → 只查声明字段(隐藏字段不参与)')
    // edit 声明字段子路径 → 允许
    r = await invoke(wlt['edit_data'], { op: 'set', jsonPath: 'title', value: '"允许改"' })
    assert(bigJson.title === '允许改', '白名单 edit 声明字段子路径 → 允许写入')
  }
}
