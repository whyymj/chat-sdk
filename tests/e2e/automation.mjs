// automation(Phase 4 无人值守自动化):capabilities.automation 反映 + budget 中间件装载 + batch API + 配置项 + opt-in 边界
// + stub model 运行时测(quality-hardening §1):验证 stub 基建可驱动真实 agent ReAct 循环(后续 budget/错误恢复测的前置)
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, defineTool, makeStore } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:automation] stub model 驱动 agent ReAct 循环(工具调用→文本终止,验证 chunk/tool_calls 解析)')
  {
    // stub model 是后续 budget/错误恢复/subagent-writable/todos-tier 运行时测的基建,先验证它能驱动真实 agent 循环。
    // 队列:[调 echo 工具] → [纯文本终止];若 chunk tool_calls 解析失败,首轮拿到纯文本即终止 → echo 不执行 → 测试失败
    let echoCalled = null
    const echo = defineTool({
      name: 'echo',
      description: '回声工具(测试用)',
      schema: z.object({ msg: z.string() }),
      handler: async ({ msg }) => { echoCalled = msg; return `echo:${msg}` },
    })
    const model = stubModel(
      { toolCalls: [{ name: 'echo', args: { msg: 'hi' } }] },
      { text: '已完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-stub-verify', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [echo],
    })
    await sdk.mount()
    await sdk.send('调用 echo')
    assert(echoCalled === 'hi', `stub tool_calls chunk 解析正确 → echo 工具执行(args.msg="hi"),实际 echoCalled=${echoCalled}`)
    assert(model.calls >= 2, `stub 驱动 ≥2 轮 model 调用(工具调用轮 + 文本终止轮),实际 ${model.calls}`)
    sdk.unmount()
  }

  console.log('[e2e:automation] budget 资源预算闸端到端(stub 注入大 usage → 第二轮拦截 + emit BUDGET_EXCEEDED)')
  {
    // 时序:第一轮 wrapModelCall 检查 usage=0(放行)→ model 调用返回 toolCalls + usage.total_tokens=1000
    //      → afterModel 累加 usage=1000 → 工具执行 → 第二轮 wrapModelCall 检查 1000 > tokenBudget(500)
    //      → 返回 aborted(不调 model,model.calls 不增)+ emit BUDGET_EXCEEDED → agent 停止
    const events = []
    const model = stubModel(
      { toolCalls: [{ name: 'echo', args: { msg: 'x' } }], usage: { total_tokens: 1000 } },
      { text: '不该执行到第二轮' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-budget', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, automation: true }, tokenBudget: 500,
      tools: [defineTool({ name: 'echo', description: '测试用', schema: z.object({ msg: z.string() }), handler: async () => 'ok' })],
    })
    await sdk.mount()
    const off = sdk.hook((e) => events.push(e))
    await sdk.send('跑任务')
    const budgetErr = events.find((e) => e.type === 'error' && (e.code === 'BUDGET_EXCEEDED' || e.payload?.code === 'BUDGET_EXCEEDED'))
    assert(budgetErr, 'budget 超限 → emit BUDGET_EXCEEDED error 事件(资源预算闸端到端触发)')
    assert(model.calls === 1, `budget 在第二轮 model 调用前拦截(第一轮累计 usage=1000 > 上限 500,第二轮不调 model),实际 model.calls=${model.calls}`)
    off(); sdk.unmount()
  }

  console.log('[e2e:automation] send 致命错误自动恢复(stub 第一次抛错 → restore checkpoint + 重试 → 第二次成功)')
  {
    // automation 错误恢复(createChatSdk.ts:1059):invoke 抛错 → attempt<maxAutoRetries && canRestore → restore 回本轮前 + 重试
    // stub 队列:[throw] → 第一次 invoke 抛错 → restore → [text] → 第二次 invoke 成功
    const model = stubModel(
      { throw: '模拟模型致命错误' },  // string → stub 自动构造 status:400 非 retryable Error(防 withRetry 重试)
      { text: '重试后成功' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-recover', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, automation: true }, checkpoint: true, maxAutoRetries: 1,
    })
    await sdk.mount()
    const events = []
    const off = sdk.hook((e) => events.push(e))
    const reply = await sdk.send('跑任务')
    assert(reply === '重试后成功', `致命错误恢复:stub 第一次抛错第二次成功 → 重试成功,实际 reply=${reply}`)
    assert(model.calls === 2, `第一次抛错 → restore + 重试第二次成功(2 次 model 调用),实际 model.calls=${model.calls}`)
    const retryEvt = events.find((e) => e.type === 'error' && e.code === 'AUTO_RECOVER_RETRY')
    assert(retryEvt, '致命错误自动恢复 → emit AUTO_RECOVER_RETRY(observable,告知回退重试)')
    off(); sdk.unmount()
  }

  console.log('[e2e:automation] batch 任务隔离(stub [成功,抛错,成功] → ok 混合,失败不中断整批)')
  {
    // batch(createChatSdk.ts:1102):逐任务 invoke,每任务前 checkpoint;失败任务 truncate messages(splice)+ ok:false,不中断整批
    const model = stubModel(
      { text: '任务1完成' },
      { throw: '任务2失败' },  // string → stub 自动构造 status:400 非 retryable
      { text: '任务3完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-batch', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, automation: true }, checkpoint: true,
    })
    await sdk.mount()
    const events = []
    const off = sdk.hook((e) => events.push(e))
    const results = await sdk.batch(['任务1', '任务2', '任务3'])
    assert(results.length === 3, `batch 跑 3 任务,实际 ${results.length}`)
    assert(results[0].ok === true && results[2].ok === true, '任务1/3 成功(ok:true)')
    assert(results[1].ok === false, '任务2 失败隔离(ok:false,不中断整批继续任务3)')
    const failEvt = events.find((e) => e.type === 'error' && e.code === 'BATCH_TASK_FAILED')
    assert(failEvt, '任务失败 → emit BATCH_TASK_FAILED(observable)')
    off(); sdk.unmount()
  }

  console.log('[e2e:automation] 断点续跑(store 写 checkpoints/usage → 新实例同 id 恢复 → listCheckpoints/usage/restoreLastCheckpoint)')
  {
    // automation 断点续跑(createChatSdk.ts:1002 applySnapshot):snapshot 含 checkpoints 栈 + usage,
    // 刷新后新 sdk 同 id + 同 storage → mount load → applySnapshot 恢复(importStack + Object.assign usage)。
    // session/local backend 走 globalThis(跨实例共享 = 模拟刷新);memory 每实例独立 Map 不能跨实例。
    globalThis.sessionStorage = makeStore()
    const sess = { id: 'e2e-resume-sess' }  // 固定 sessionId,直接 load 该 id snapshot(避免依赖 listSessions autoResume 时序)
    const sdk1 = createChatSdk({
      ui: false, id: 'e2e-resume', storage: 'session', session: sess, llm: stubModel({ text: '任务完成', usage: { total_tokens: 500 } }),
      capabilities: { ...MIN_CAPS, automation: true }, checkpoint: true,
    })
    await sdk1.mount()
    await sdk1.send('跑任务')  // beforeModel save(checkpoint 栈)+ afterModel usage 累加 500
    await sdk1.unmount()       // flush 写 store(snapshot 含 checkpoints + usage)
    // sdk2:同 id + 同 storage + 同 session.id(session 共享 globalThis)→ mount load → applySnapshot 恢复 checkpoint 栈 + usage
    const sdk2 = createChatSdk({
      ui: false, id: 'e2e-resume', storage: 'session', session: sess, llm: stubModel({ text: 'x' }),
      capabilities: { ...MIN_CAPS, automation: true }, checkpoint: true,
    })
    await sdk2.mount()
    assert(sdk2.listCheckpoints().length > 0, `断点续跑:listCheckpoints 恢复有值(checkpoint 栈从 store 恢复),实际 ${sdk2.listCheckpoints().length}`)
    assert(sdk2.usage.total_tokens === 500, `断点续跑:usage 连续恢复(total_tokens=500),实际 ${sdk2.usage.total_tokens}`)
    let restoreOk = true
    try { sdk2.restoreLastCheckpoint() } catch { restoreOk = false }
    assert(restoreOk, '断点续跑:restoreLastCheckpoint 可用(恢复后栈可回退,不抛错)')
    sdk2.unmount()
  }

  console.log('[e2e:automation] subagent-writable:spawn_agent 透传 writablePaths → 子 agent 写内成功 / 越界 PATH_OUT_OF_SCOPE')
  {
    // spawn_agent(subagent.ts:234 writablePaths 参数)→ runSubagent(:149 wrapWithPathGuard 包装写工具)
    // 子 agent 复用主 llm(stub 共享队列),消费顺序:主 spawn → 子 write(内/越界)→ 子 done → 主 done
    const page = { components: [{ title: 'old' }], settings: { theme: 'light' } }
    const dataSchema = z.object({ components: z.array(z.object({ title: z.string() })), settings: z.object({ theme: z.string() }) })
    // 测 1:写 writablePaths 内(components.0.title)→ path guard 允许 → 写成功
    const model1 = stubModel(
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '把 components.0.title 改成 new', writablePaths: ['components'] } }] },
      { toolCalls: [{ name: 'write', args: { value: 'new', patch: { op: 'set', jsonPath: 'components.0.title' } } }] },
      { text: '子任务完成' },
      { text: '已委派子 agent' },
    )
    const sdk1 = createChatSdk({
      ui: false, id: 'e2e-sub-write', storage: 'memory', llm: model1,
      capabilities: { ...MIN_CAPS, subagent: true },
      data: { schema: dataSchema, bind: page },
    })
    await sdk1.mount()
    await sdk1.send('让子 agent 改 components 标题')
    assert(page.components[0].title === 'new', `子 agent 写 writablePaths 内(components.0.title)→ path guard 允许 → 成功,实际 ${page.components[0].title}`)
    assert(page.settings.theme === 'light', 'writablePaths 仅 components → settings 未被改(隔离)')
    sdk1.unmount()

    // 测 2:写越界(settings.theme 不在 writablePaths ['components'])→ PATH_OUT_OF_SCOPE → 不写
    const page2 = { components: [{ title: 'old' }], settings: { theme: 'light' } }
    const model2 = stubModel(
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '把 settings.theme 改成 dark', writablePaths: ['components'] } }] },
      { toolCalls: [{ name: 'write', args: { value: 'dark', patch: { op: 'set', jsonPath: 'settings.theme' } } }] },
      { text: '子任务完成' },
      { text: '已委派' },
    )
    const sdk2 = createChatSdk({
      ui: false, id: 'e2e-sub-write-deny', storage: 'memory', llm: model2,
      capabilities: { ...MIN_CAPS, subagent: true },
      data: { schema: dataSchema, bind: page2 },
    })
    await sdk2.mount()
    await sdk2.send('让子 agent 改 settings')
    assert(page2.settings.theme === 'light', `子 agent 写越界(settings.theme 不在 writablePaths ['components'])→ PATH_OUT_OF_SCOPE 拒绝 → 不写,实际 ${page2.settings.theme}`)
    sdk2.unmount()
  }

  console.log('[e2e:automation] todos-tier:write_todos 层级输入(parentId/deps)→ inspect().todos 反映层级')
  {
    // write_todos(todos.ts:21 TodoInput 接受 parentId/deps)整表替换;有 parentId → renderTodos 层级递归渲染
    const model = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [
        { id: 't1', content: '父任务', status: 'pending' },
        { id: 't2', content: '子任务', status: 'pending', parentId: 't1', deps: ['t1'] },
      ] } }] },
      { text: '已规划任务清单' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-todos-tier', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, planning: true, todoDeps: true },
    })
    await sdk.mount()
    await sdk.send('帮我规划一个父子任务')
    const todos = sdk.inspect().todos ?? []
    assert(todos.length === 2, `write_todos 层级输入 → inspect().todos 2 项,实际 ${todos.length}`)
    const child = todos.find((t) => t.id === 't2')
    assert(child && child.parentId === 't1', `子任务 parentId 保留(层级结构),实际 child=${JSON.stringify(child)}`)
    assert(child && Array.isArray(child.deps) && child.deps.includes('t1'), '子任务 deps 保留(依赖关系)')
    sdk.unmount()
  }

  console.log('[e2e:automation] capabilities.automation:true → budget 中间件装载 + batch API 暴露')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-on', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: true }, tokenBudget: 50000, timeBudgetMs: 60000, maxAutoRetries: 2,
    })
    await sdk.mount()
    const mws = sdk.inspect().middleware
    assert(mws.includes('budget'), 'capabilities.automation:true → inspect().middleware 含 budget(资源预算闸装载)')
    assert(typeof sdk.batch === 'function', 'sdk.batch 为 function(批处理 API 暴露)')
    sdk.unmount()
  }

  console.log('[e2e:automation] 默认(未传 automation)→ budget 不装载(opt-in 默认关,no-op)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-auto-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const mws = sdk.inspect().middleware
    assert(!mws.includes('budget'), '未传 automation → middleware 不含 budget(opt-in 最远,默认关)')
    assert(typeof sdk.batch === 'function', 'sdk.batch 仍暴露(方法常驻;未开 checkpoint 时每任务前 save 跳过)')
    sdk.unmount()
  }

  console.log('[e2e:automation] automation + checkpoint 同开 → 两中间件均装载(batch 每任务前 checkpoint)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-cp', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: true }, checkpoint: true, tokenBudget: 100000,
    })
    await sdk.mount()
    const mws = sdk.inspect().middleware
    assert(mws.includes('budget') && mws.includes('checkpoint'), 'automation + checkpoint 同开 → budget + checkpoint 中间件均装载')
    sdk.unmount()
  }

  console.log('[e2e:automation] automation:false 显式关 → budget 不装载(等同默认关)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-false', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: false }, tokenBudget: 50000,
    })
    await sdk.mount()
    assert(!sdk.inspect().middleware.includes('budget'), 'automation:false 显式关 → budget 不装载(=== true 才开)')
    sdk.unmount()
  }

  console.log('[e2e:automation] maxAutoRetries 配置 + automation → mount 成功(配置项生效不抛)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-retry', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: true }, maxAutoRetries: 3,
    })
    await sdk.mount()
    assert(sdk.inspect().middleware.includes('budget'), 'maxAutoRetries 配置 + automation → mount 成功(无人值守错误恢复配置项)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
