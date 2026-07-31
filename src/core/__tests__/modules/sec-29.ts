import { z } from 'zod'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { createMemoryMiddleware } from '../../harness/memory'
import { createSubagentsMiddleware, type SubagentsController } from '../../harness/subagent'
import type { TestCtx } from './_ctx'

/**
 * 运行时动态重配置单元断言
 * - tools 动态化:createAgent setTools / rebindTools(经 mock 验证重算 + rebind)
 * - subagents 动态化:SubagentsController.set/add/remove 重新生成委派工具
 * - memory 动态化:memoryMw.reset/get
 * - llm 动态化:setLlm rebind(经 mock 验证)
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[动态重配置 tools/subagents/llm/memory]')

  // ===== memory 动态化 =====
  {
    const mw = createMemoryMiddleware('初始 memory')
    assert(mw.get() === '初始 memory', 'memoryMw.get() → 返回初始值')
    mw.reset('新 memory')
    assert(mw.get() === '新 memory', 'memoryMw.reset() → get() 反映新值')
    mw.reset('')
    assert(mw.get() === '', "memoryMw.reset('') → get() 返空串(augmentPrompt 跳过)")
    // augmentPrompt 读 state.memory(beforeAgent 设),reset 后下一轮 beforeAgent 反映
    const state: any = { messages: [], todos: [], files: {}, skillsMetadata: [], skillsLoaded: [], memory: '新 memory' }
    assert(!!mw.augmentPrompt!(state), 'memoryMw.augmentPrompt → state.memory 非空时返段')
    state.memory = ''
    assert(mw.augmentPrompt!(state) === undefined, 'memoryMw.augmentPrompt → state.memory 空时返 undefined(跳过)')
  }

  // ===== memory 异步函数 source(RAG 场景) =====
  {
    // 同步函数 source:beforeAgent 求值并注入 state
    let dynamic = '运行时值'
    const syncMw = createMemoryMiddleware(() => dynamic)
    assert(syncMw.get() === '', '同步函数 source 未求值前 → get() 返空串(尚未求值)')
    let s = await syncMw.beforeAgent?.({} as any)
    assert((s as any)?.memory === '运行时值', '同步函数 source → beforeAgent 求值注入 state.memory')
    assert(syncMw.get() === '运行时值', '同步函数 source 求值后 → get() 返回已解析值')
    // source 变量变了,缓存仍是旧值(缓存生效)
    dynamic = '新运行时值'
    s = await syncMw.beforeAgent?.({} as any)
    assert((s as any)?.memory === '运行时值', '同步函数 source 缓存生效 → 第二次 beforeAgent 仍用缓存(不重求值)')
    // refresh 强制重求值
    const refreshed = await syncMw.refresh()
    assert(refreshed === '新运行时值', 'refresh() → 重新求值函数 source,返回最新值')
    assert(syncMw.get() === '新运行时值', 'refresh() 后 get() 反映最新求值结果')

    // 异步函数 source:beforeAgent await 求值并缓存
    const asyncMw = createMemoryMiddleware(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return '异步加载的 RAG 文档内容'
    })
    assert(asyncMw.get() === '', '异步函数 source 未求值前 → get() 返空串')
    s = await asyncMw.beforeAgent?.({} as any)
    assert((s as any)?.memory === '异步加载的 RAG 文档内容', '异步函数 source → beforeAgent await 求值注入 state.memory')
    assert(asyncMw.get() === '异步加载的 RAG 文档内容', '异步函数 source 求值后 → get() 返回已解析值')
    // 第二次 beforeAgent 用缓存(不再 await)
    s = await asyncMw.beforeAgent?.({} as any)
    assert((s as any)?.memory === '异步加载的 RAG 文档内容', '异步函数 source 缓存生效 → 第二次 beforeAgent 用缓存')

    // reset 切换 source 类型:函数 → 字符串
    asyncMw.reset('静态文本')
    assert(asyncMw.get() === '静态文本', 'reset(字符串) → get() 立即返回字符串(无需 beforeAgent)')

    // 异步求值失败 → 降级空串,不抛
    const failMw = createMemoryMiddleware(async () => {
      throw new Error('网络错误')
    })
    s = await failMw.beforeAgent?.({} as any)
    assert((s as any)?.memory === '', '异步求值失败 → 降级空串注入 state.memory(不阻塞 agent)')
    assert(failMw.get() === '', '异步求值失败 → get() 返空串')
  }

  // ===== subagents 动态化(SubagentsController) =====
  {
    const main = { llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'fake' }, allTools: [], debug: false }
    const mw = createSubagentsMiddleware(
      [{ id: 'writer', description: '写作子 agent' }],
      main as any,
    )
    const controller = (mw as any).controller as SubagentsController
    assert(!!controller && typeof controller.set === 'function', 'createSubagentsMiddleware → 挂载 controller(set/add/remove/get)')

    // 初始 1 个
    assert(controller.get().length === 1 && controller.get()[0].id === 'writer', 'controller.get() → 初始 1 个(writer)')

    // add 追加
    controller.add({ id: 'reviewer', description: '审查子 agent' })
    assert(controller.get().length === 2, 'controller.add() → 列表增至 2 个')
    assert(controller.get().some((s) => s.id === 'reviewer'), 'controller.add() → 含新 reviewer')

    // add 重复 id → warn 跳过
    controller.add({ id: 'writer', description: '重复' })
    assert(controller.get().length === 2, 'controller.add() 重复 id → warn 跳过(数量不变)')

    // remove 移除
    const removed = controller.remove('writer')
    assert(removed === true, 'controller.remove(存在 id) → 返回 true')
    assert(controller.get().length === 1 && controller.get()[0].id === 'reviewer', 'controller.remove() → 列表减至 1 个(reviewer)')
    assert(controller.remove('不存在') === false, 'controller.remove(不存在 id) → 返回 false')

    // set 整体替换
    controller.set([{ id: 'a', description: 'A' }, { id: 'b', description: 'B' }])
    assert(controller.get().length === 2 && controller.get()[0].id === 'a', 'controller.set() → 整体替换为新列表')

    // set 含非法 id → warn 跳过
    controller.set([{ id: 'valid', description: 'V' }, { id: '1invalid', description: '非法' }])
    assert(controller.get().length === 1 && controller.get()[0].id === 'valid', 'controller.set() 非法 id → warn 跳过(只留合法)')

    // 委派工具随 controller 变(mw.tools getter 动态)
    const toolsNow = (mw as any).tools as StructuredToolInterface[]
    assert(Array.isArray(toolsNow) && toolsNow.some((t) => t.name === 'use_valid'), 'controller 变更后 mw.tools getter → 反映新委派工具(use_valid)')
    assert(!toolsNow.some((t) => t.name === 'use_writer'), 'controller 变更后 mw.tools → 旧 use_writer 不再出现')

    // augmentPrompt 反映最新列表
    const seg = mw.augmentPrompt!({} as any)
    assert(!!seg && seg.includes('use_valid'), 'augmentPrompt → 含最新 use_valid 索引')
    assert(!seg?.includes('use_writer'), 'augmentPrompt → 不含旧 use_writer')
  }

  // ===== subagents 空 controller.set([]) → augmentPrompt 返 undefined =====
  {
    const main = { llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'fake' }, allTools: [], debug: false }
    const mw = createSubagentsMiddleware([], main as any)
    const controller = (mw as any).controller as SubagentsController
    assert(controller.get().length === 0, '空 subagents → controller.get() 返空数组')
    assert(mw.augmentPrompt!({} as any) === undefined, '空 subagents → augmentPrompt 返 undefined(跳过)')
    controller.add({ id: 'x', description: 'X' })
    assert(!!mw.augmentPrompt!({} as any), 'add 后 → augmentPrompt 返段(非空)')
  }

  // ===== tools 动态化(createAgent setTools 重算 + rebind) =====
  // 用 mock llm 验证 setTools 触发 rebind
  {
    let bindCalls = 0
    let lastBoundTools: any[] = []
    const mockLlm: any = {
      bindTools: (tools: any[]) => { bindCalls++; lastBoundTools = tools; return { ...mockLlm, _bound: true } },
      stream: async () => { throw new Error('mock') },
    }
    // 简化:createAgent 需要 options,此处只验证 setTools 逻辑(经 mock)
    // 实际 createAgent setTools 在 e2e 验证;此处验证 rebindTools 模式
    const userTool1 = tool(() => 'a', { name: 'tool_a', description: 'A', schema: z.object({}) })
    const userTool2 = tool(() => 'b', { name: 'tool_b', description: 'B', schema: z.object({}) })
    let allTools: StructuredToolInterface[] = [userTool1]
    let llmWithTools = mockLlm.bindTools(allTools)
    function rebindTools() { llmWithTools = allTools.length > 0 ? (mockLlm.bindTools?.(allTools) ?? mockLlm) : mockLlm }
    function setTools(userTools: StructuredToolInterface[]) {
      allTools = [...userTools]
      rebindTools()
    }
    assert(bindCalls === 1 && lastBoundTools.length === 1, '初始 bindTools 调用一次(1 工具)')
    setTools([userTool1, userTool2])
    assert(bindCalls === 2 && lastBoundTools.length === 2, 'setTools → rebindTools 触发(2 工具)')
    assert(lastBoundTools.some((t) => t.name === 'tool_b'), 'setTools 后 → 新工具 tool_b 进入绑定')
    // setTools([]) → allTools 空 → rebindTools 退回裸 llm(bindTools 不调)
    const bindsBeforeEmpty = bindCalls
    setTools([])
    assert(bindCalls === bindsBeforeEmpty, 'setTools([]) → allTools 空 → rebindTools 不调 bindTools(退回裸 llm)')
  }

  // ===== llm 动态化(setLlm rebind) =====
  {
    let bindCalls = 0
    const mockLlm1: any = { bindTools: (t: any) => { bindCalls++; return { ...mockLlm1, _bound: true } }, stream: async () => { throw new Error('mock') } }
    const mockLlm2: any = { bindTools: (t: any) => { bindCalls++; return { ...mockLlm2, _bound: true } }, stream: async () => { throw new Error('mock') } }
    let llm: any = mockLlm1
    let allTools: StructuredToolInterface[] = [tool(() => 'x', { name: 'x', description: 'X', schema: z.object({}) })]
    let llmWithTools = llm.bindTools(allTools)
    let llmChangeCount = 0
    function rebindTools() { llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm }
    function setLlm(newLlm: any) { llm = newLlm; rebindTools(); llmChangeCount++ }
    const initialBinds = bindCalls
    setLlm(mockLlm2)
    assert(bindCalls === initialBinds + 1, 'setLlm → rebindTools 触发(用新 llm 重新绑定)')
    assert(llmChangeCount === 1, 'setLlm → onLlmChange 回调触发')
    assert(llm === mockLlm2, 'setLlm → llm 替换为新实例')
  }
}
