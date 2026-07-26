// inspect 反映配置:tools / middleware / id / model / subagent / verify / mcp / 初始状态
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:inspect] inspect().tools 反映 dataSlotOps 开关 + 工具集完整性')
  {
    globalThis.window.app = {}
    // advanced 模式:全暴露(含底层 get/set/edit + read/write)
    const sdkOn = createChatSdk({
      ui: false, id: 'e2e-tools-on', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app.x', description: 'x', schema: z.string() }],
      toolMode: 'advanced',
    })
    await sdkOn.mount()
    const toolsOn = sdkOn.inspect().tools.map((t) => t.name)
    const expectedWinTools = ['list_data_slots', 'describe_data_slot', 'get_data_slot', 'get_slot_paths', 'set_data_slot', 'edit_data_slot', 'delete_data_slot', 'snapshot_data_slot', 'list_data_snapshots', 'restore_data_snapshot', 'query_data_slot', 'search_data_slot', 'eval_script', 'read', 'write']
    for (const name of expectedWinTools) {
      assert(toolsOn.includes(name), `dataSlotOps 开启 + advanced → 含 ${name}`)
    }
    assert(toolsOn.includes('fetch_document') === false, 'MIN_CAPS(fetch:false) → 不含 fetch_document')
    sdkOn.unmount()

    // simple 模式(默认):隐藏底层 get/set/edit/delete/list/describe,主推 read/write + 高级查询/快照
    const sdkSimple = createChatSdk({
      ui: false, id: 'e2e-tools-simple', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app.x', description: 'x', schema: z.string() }],
    })
    await sdkSimple.mount()
    const toolsSimple = sdkSimple.inspect().tools.map((t) => t.name)
    assert(['read', 'write', 'query_data_slot', 'search_data_slot', 'eval_script', 'snapshot_data_slot', 'list_data_snapshots', 'restore_data_snapshot', 'get_slot_paths'].every((n) => toolsSimple.includes(n)), 'simple → 含 read/write + 高级查询/快照(9 个)')
    assert(['list_data_slots', 'describe_data_slot', 'get_data_slot', 'set_data_slot', 'edit_data_slot', 'delete_data_slot'].every((n) => !toolsSimple.includes(n)), 'simple → 隐藏底层 get/set/edit/delete/list/describe')
    sdkSimple.unmount()

    // minimal 模式:只 read/write
    const sdkMin = createChatSdk({
      ui: false, id: 'e2e-tools-min', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app.x', description: 'x', schema: z.string() }],
      toolMode: 'minimal',
    })
    await sdkMin.mount()
    const toolsMin = sdkMin.inspect().tools.map((t) => t.name)
    assert(toolsMin.includes('read') && toolsMin.includes('write'), 'minimal → 含 read/write')
    assert(['list_data_slots', 'get_data_slot', 'set_data_slot', 'edit_data_slot', 'query_data_slot', 'search_data_slot', 'eval_script', 'snapshot_data_slot'].every((n) => !toolsMin.includes(n)), 'minimal → 不含底层/高级查询/快照工具(只 read/write 数据槽入口)')
    sdkMin.unmount()
    sdkMin.unmount()

    const sdkOff = createChatSdk({
      ui: false, id: 'e2e-tools-off', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, dataSlotOps: false },
    })
    await sdkOff.mount()
    const toolsOff = sdkOff.inspect().tools.map((t) => t.name)
    assert(!toolsOff.some((n) => n.endsWith('_data_slot') || n.endsWith('_data_snapshot') || n === 'eval_script' || n === 'read' || n === 'write'), 'dataSlotOps:false → 不含任何 data slot 工具(含 read/write)')
    sdkOff.unmount()
  }

  console.log('[e2e:inspect] inspect().middleware 反映 capabilities 开关')
  {
    globalThis.window.app = {}
    const sdkFull = createChatSdk({
      ui: false, id: 'e2e-mw-full', storage: 'memory', llm: FAKE_LLM,
      capabilities: { dataSlotOps: false, fetch: false },
      dataSlots: [{ path: 'app.x', description: 'x', schema: z.string() }],
    })
    await sdkFull.mount()
    const mwFull = sdkFull.inspect().middleware
    assert(mwFull.includes('usageHints'), '中间件栈含 usageHints(始终装载)')
    assert(mwFull.includes('todos'), '中间件栈含 todos(planning 默认开)')
    assert(mwFull.includes('summarization'), '中间件栈含 summarization(默认开)')
    assert(mwFull.includes('skills'), '中间件栈含 skills(默认开)')
    sdkFull.unmount()

    const sdkLean = createChatSdk({
      ui: false, id: 'e2e-mw-lean', storage: 'memory', llm: FAKE_LLM,
      capabilities: { dataSlotOps: false, fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
    })
    await sdkLean.mount()
    const mwLean = sdkLean.inspect().middleware
    assert(!mwLean.includes('todos'), 'planning:false → 不含 todos')
    assert(!mwLean.includes('skills'), 'skills:false → 不含 skills')
    assert(!mwLean.includes('summarization'), 'summarization:false → 不含 summarization')
    assert(!mwLean.includes('vfs'), 'vfs:false → 不含 vfs')
    assert(mwLean.includes('usageHints'), 'usageHints 始终装载(即便其余全关)')
    sdkLean.unmount()
  }

  console.log('[e2e:inspect] inspect().id / model 反映配置')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-idmodel', storage: 'memory', llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'gpt-4o' }, capabilities: MIN_CAPS,
    })
    await sdk.mount()
    const info = sdk.inspect()
    assert(info.id === 'e2e-idmodel', 'inspect().id === 传入 id')
    assert(info.model === 'gpt-4o', 'inspect().model === 传入 model')
    sdk.unmount()
  }

  console.log('[e2e:inspect] inspect().subagent 反映 subagent 配置')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-sub-cfg', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false },
      subagent: { maxDepth: 2, maxParallel: 3, allowedTools: ['fetch_document'] },
    })
    await sdk.mount()
    const sub = sdk.inspect().subagent
    assert(sub.enabled === true, 'subagent.enabled=true(默认开)')
    assert(sub.maxDepth === 2, 'subagent.maxDepth 反映配置(2)')
    assert(sub.maxParallel === 3, 'subagent.maxParallel 反映配置(3)')
    assert(sub.allowedTools.includes('fetch_document'), 'subagent.allowedTools 反映配置')
    sdk.unmount()
  }

  console.log('[e2e:inspect] inspect().verify 反映 capabilities.verify + verify 配置')
  {
    const sdkOff = createChatSdk({ ui: false, id: 'e2e-verify-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkOff.mount()
    assert(sdkOff.inspect().verify?.enabled === false, 'verify 默认关 → inspect().verify.enabled=false')
    sdkOff.unmount()
    const sdkOn = createChatSdk({
      ui: false, id: 'e2e-verify-on', storage: 'memory', llm: FAKE_LLM, capabilities: { ...MIN_CAPS, verify: true },
      verify: { maxAttempts: 3, adversarial: true },
    })
    await sdkOn.mount()
    const v = sdkOn.inspect().verify
    assert(v?.enabled === true, 'verify 开启 → enabled=true')
    assert(v?.maxAttempts === 3, 'verify.maxAttempts 反映配置(3)')
    assert(v?.adversarial === true, 'verify.adversarial 反映配置(true)')
    sdkOn.unmount()
  }

  console.log('[e2e:inspect] inspect().mcp 无 MCP 时为空数组')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-mcp-none', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(Array.isArray(sdk.inspect().mcp?.servers) && sdk.inspect().mcp.servers.length === 0, '无 mcp 配置 → inspect().mcp.servers 为空数组')
    sdk.unmount()
  }

  console.log('[e2e:inspect] inspect 初始状态:todos 空 / lastCompression undefined / checkpoints undefined')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-init-state', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const info = sdk.inspect()
    assert(Array.isArray(info.todos) && info.todos.length === 0, 'inspect().todos 初始为空数组')
    assert(info.lastCompression === undefined, 'inspect().lastCompression 初始 undefined(未触发压缩)')
    assert(info.checkpoints === undefined, 'inspect().checkpoints 未开启 → undefined')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
