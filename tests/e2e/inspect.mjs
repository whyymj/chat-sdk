// inspect 反映配置:tools / middleware / id / model / subagent / verify / mcp / 初始状态
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, defineTool } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:inspect] inspect().tools 反映 dataOps 开关 + 工具集完整性')
  {
    // advanced 模式:全暴露(15 个数据工具;evolve 后含 history_data/schema_data)
    const sdkOn = createChatSdk({
      ui: false, id: 'e2e-tools-on', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
      toolMode: 'advanced',
    })
    await sdkOn.mount()
    const toolsOn = sdkOn.inspect().tools.map((t) => t.name)
    const expectedDataTools = ['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data', 'snapshot_data', 'list_data_snapshots', 'restore_data', 'history_data', 'query_data', 'search_data', 'eval_script', 'read', 'write', 'schema_data', 'diff_data']
    for (const name of expectedDataTools) {
      assert(toolsOn.includes(name), `dataOps 开启 + advanced → 含 ${name}`)
    }
    assert(toolsOn.includes('fetch_document') === false, 'MIN_CAPS(fetch:false) → 不含 fetch_document')
    sdkOn.unmount()

    // simple 模式(默认):evolve 精简后 7 个(去 snapshot/list,补 history_data;仍隐藏底层 5 + schema_data)
    const sdkSimple = createChatSdk({
      ui: false, id: 'e2e-tools-simple', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
    })
    await sdkSimple.mount()
    const toolsSimple = sdkSimple.inspect().tools.map((t) => t.name)
    assert(['read', 'write', 'query_data', 'search_data', 'eval_script', 'restore_data', 'history_data'].every((n) => toolsSimple.includes(n)), 'simple → 含 read/write + query/search/eval/restore/history(7 个,evolve 精简)')
    assert(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data', 'schema_data', 'snapshot_data', 'list_data_snapshots', 'diff_data'].every((n) => !toolsSimple.includes(n)), 'simple → 隐藏底层 5 + schema_data + snapshot/list + diff_data(evolve 精简)')
    sdkSimple.unmount()

    // minimal 模式:只 read/write
    const sdkMin = createChatSdk({
      ui: false, id: 'e2e-tools-min', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
      toolMode: 'minimal',
    })
    await sdkMin.mount()
    const toolsMin = sdkMin.inspect().tools.map((t) => t.name)
    assert(toolsMin.includes('read') && toolsMin.includes('write'), 'minimal → 含 read/write')
    assert(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data', 'query_data', 'search_data', 'eval_script', 'snapshot_data', 'list_data_snapshots', 'restore_data'].every((n) => !toolsMin.includes(n)), 'minimal → 不含底层/高级查询/快照工具(只 read/write)')
    sdkMin.unmount()

    const sdkOff = createChatSdk({
      ui: false, id: 'e2e-tools-off', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, dataOps: false },
    })
    await sdkOff.mount()
    const toolsOff = sdkOff.inspect().tools.map((t) => t.name)
    assert(!toolsOff.some((n) => n.endsWith('_data') || n.endsWith('_data_snapshots') || n === 'eval_script' || n === 'read' || n === 'write'), 'dataOps:false → 不含任何数据工具(含 read/write)')
    sdkOff.unmount()

    // vfs 开启 → 含 vfs 工具族(含新增 vfs_json_read/vfs_json_patch,add-complex-preset-and-vfs-json)
    const sdkVfs = createChatSdk({
      ui: false, id: 'e2e-vfs-json', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, vfs: true },
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
    })
    await sdkVfs.mount()
    const toolsVfs = sdkVfs.inspect().tools.map((t) => t.name)
    assert(['vfs_read', 'vfs_write', 'vfs_edit', 'vfs_ls', 'vfs_glob', 'vfs_grep', 'vfs_json_read', 'vfs_json_patch'].every((n) => toolsVfs.includes(n)), 'vfs 开启 → 含 vfs 工具族(8 个,含新增 vfs_json_read/vfs_json_patch)')
    const vfsJsonRead = sdkVfs.inspect().tools.find((t) => t.name === 'vfs_json_read')
    assert(vfsJsonRead && vfsJsonRead.source === 'builtin', 'vfs_json_read → source=builtin')
    const vfsJsonPatch = sdkVfs.inspect().tools.find((t) => t.name === 'vfs_json_patch')
    assert(vfsJsonPatch && vfsJsonPatch.source === 'builtin', 'vfs_json_patch → source=builtin')
    assert(sdkVfs.inspect().contextPreset === 'auto', 'inspect().contextPreset 默认 auto')

    // inspect_env 默认开(capabilities.inspectEnv !== false,排查调试默认工具)
    const sdkEnvOn = createChatSdk({
      ui: false, id: 'e2e-inspect-env-on', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
    })
    await sdkEnvOn.mount()
    assert(sdkEnvOn.inspect().tools.some((t) => t.name === 'inspect_env'), '默认 → inspect().tools 含 inspect_env(排查调试默认开)')
    const envTool = sdkEnvOn.inspect().tools.find((t) => t.name === 'inspect_env')
    assert(envTool && envTool.source === 'builtin', 'inspect_env → source=builtin')
    sdkEnvOn.unmount()
    // inspectEnv:false → 不含 inspect_env(其余不变)
    const sdkEnvOff = createChatSdk({
      ui: false, id: 'e2e-inspect-env-off', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, inspectEnv: false },
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
    })
    await sdkEnvOff.mount()
    assert(!sdkEnvOff.inspect().tools.some((t) => t.name === 'inspect_env'), 'inspectEnv:false → 不含 inspect_env')
    sdkEnvOff.unmount()
    sdkVfs.unmount()

    // inspect().contextPreset 反映 complex(add-complex-preset-and-vfs-json)
    const sdkComplex = createChatSdk({
      ui: false, id: 'e2e-complex-preset', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      contextPreset: 'complex',
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
    })
    await sdkComplex.mount()
    assert(sdkComplex.inspect().contextPreset === 'complex', 'inspect().contextPreset 反映 complex 预设')
    sdkComplex.unmount()
  }

  console.log('[e2e:inspect] inspect().middleware 反映 capabilities 开关')
  {
    const sdkFull = createChatSdk({
      ui: false, id: 'e2e-mw-full', storage: 'memory', llm: FAKE_LLM,
      capabilities: { dataOps: false, fetch: false },
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
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
      capabilities: { dataOps: false, fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
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

  console.log('[e2e:inspect] inspect().middleware 含 dataHint(配 data 时)/ 不含(无 data)')
  {
    const sdkData = createChatSdk({
      ui: false, id: 'e2e-datahint-on', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' },
    })
    await sdkData.mount()
    const mwData = sdkData.inspect().middleware
    assert(mwData.includes('dataHint'), '配 data → middleware 含 dataHint(A4 动态化中间件)')
    assert(sdkData.inspect().systemPrompt.includes('可操作数据'), '配 data → inspect().systemPrompt 含「可操作数据」段(动态重算)')
    sdkData.unmount()

    const sdkNoData = createChatSdk({ ui: false, id: 'e2e-datahint-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkNoData.mount()
    const mwNoData = sdkNoData.inspect().middleware
    assert(!mwNoData.includes('dataHint'), '无 data → middleware 不含 dataHint')
    assert(!sdkNoData.inspect().systemPrompt.includes('可操作数据'), '无 data → inspect().systemPrompt 不含数据段')
    sdkNoData.unmount()
  }

  console.log('[e2e:inspect] inspect().middleware 含 augmentSystem(配 augmentSystem 时)/ 不含(未配)')
  {
    const sdkAug = createChatSdk({
      ui: false, id: 'e2e-augsys-on', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      augmentSystem: () => '## 业务补充\n当前组件:Button',
    })
    await sdkAug.mount()
    assert(sdkAug.inspect().middleware.includes('augmentSystem'), '配 augmentSystem → middleware 含 augmentSystem')
    sdkAug.unmount()

    const sdkNoAug = createChatSdk({ ui: false, id: 'e2e-augsys-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkNoAug.mount()
    assert(!sdkNoAug.inspect().middleware.includes('augmentSystem'), '未配 augmentSystem → middleware 不含 augmentSystem')
    sdkNoAug.unmount()
  }

  console.log('[e2e:inspect] setTools/addTool/removeTool → inspect().tools 反映动态增删')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-settools', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      tools: [defineTool({ name: 'orig_tool', description: 'orig', schema: z.object({}), handler: async () => 'x' })],
    })
    await sdk.mount()
    const before = sdk.inspect().tools.map((t) => t.name)
    assert(before.includes('orig_tool'), '初始 inspect().tools 含用户工具 orig_tool')
    sdk.addTool(defineTool({ name: 'added_tool', description: 'added', schema: z.object({}), handler: async () => 'y' }))
    const afterAdd = sdk.inspect().tools.map((t) => t.name)
    assert(afterAdd.includes('added_tool'), 'addTool 后 inspect().tools 含新工具 added_tool')
    assert(afterAdd.includes('orig_tool'), 'addTool 后原工具仍在')
    const removed = sdk.removeTool('orig_tool')
    assert(removed === true, 'removeTool(存在) → 返回 true')
    const afterRemove = sdk.inspect().tools.map((t) => t.name)
    assert(!afterRemove.includes('orig_tool'), 'removeTool 后 inspect().tools 不再含 orig_tool')
    assert(sdk.removeTool('不存在') === false, 'removeTool(不存在) → 返回 false')
    // setTools 整体替换
    sdk.setTools([defineTool({ name: 'only_tool', description: 'only', schema: z.object({}), handler: async () => 'z' })])
    const afterSet = sdk.inspect().tools.map((t) => t.name)
    assert(afterSet.includes('only_tool') && !afterSet.includes('added_tool'), 'setTools 整体替换 → inspect().tools 反映新工具集')
    sdk.unmount()
  }

  console.log('[e2e:inspect] setSubagents/addSubagent/removeSubagent → inspect().subagent.subagents 反映')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-setsubagents', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false },
      subagents: [{ id: 'writer', description: '写作子 agent' }],
    })
    await sdk.mount()
    assert(sdk.inspect().subagent.subagents?.length === 1 && sdk.inspect().subagent.subagents[0].id === 'writer', '初始 inspect().subagent.subagents 含 writer')
    sdk.addSubagent({ id: 'reviewer', description: '审查子 agent' })
    assert(sdk.inspect().subagent.subagents?.length === 2, 'addSubagent 后 subagents 增至 2')
    assert(sdk.inspect().subagent.subagents?.some((s) => s.id === 'reviewer'), 'addSubagent 后含 reviewer')
    const removed = sdk.removeSubagent('writer')
    assert(removed === true, 'removeSubagent(存在) → 返回 true')
    assert(sdk.inspect().subagent.subagents?.length === 1 && sdk.inspect().subagent.subagents[0].id === 'reviewer', 'removeSubagent 后 subagents 减至 1(reviewer)')
    sdk.setSubagents([{ id: 'a', description: 'A' }, { id: 'b', description: 'B' }])
    assert(sdk.inspect().subagent.subagents?.length === 2 && sdk.inspect().subagent.subagents[0].id === 'a', 'setSubagents 整体替换 → 反映新列表')
    // 委派工具随 controller 变(inspect().tools 含 use_a)
    assert(sdk.inspect().tools.some((t) => t.name === 'use_a'), 'setSubagents 后 inspect().tools 含新委派工具 use_a')
    sdk.unmount()
  }

  console.log('[e2e:inspect] setLlm → inspect().model 反映新模型')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setllm', storage: 'memory', llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'gpt-3.5-turbo' }, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().model === 'gpt-3.5-turbo', '初始 inspect().model === gpt-3.5-turbo')
    sdk.setLlm({ apiKey: 'sk-fake2', baseUrl: 'http://fake2', model: 'gpt-4o' })
    assert(sdk.inspect().model === 'gpt-4o', 'setLlm 后 inspect().model === gpt-4o')
    sdk.unmount()
  }

  console.log('[e2e:inspect] setMemory → inspect().memory 反映')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setmemory', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, memory: '初始 memory' })
    await sdk.mount()
    assert(sdk.inspect().memory === '初始 memory', '初始 inspect().memory === 初始值')
    sdk.setMemory('新 memory')
    assert(sdk.inspect().memory === '新 memory', 'setMemory 后 inspect().memory 反映新值')
    sdk.setMemory('')
    assert(sdk.inspect().memory === '', "setMemory('') → inspect().memory 为空串")
    sdk.unmount()
  }

  console.log('[e2e:inspect] setSubagents 未配 subagents 时 → warn 不抛错')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setsubagents-nocfg', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let threw = false
    try { sdk.setSubagents([{ id: 'x', description: 'X' }]) } catch { threw = true }
    assert(!threw, '未配 subagents 时 setSubagents → warn 不抛错')
    assert(sdk.removeSubagent('x') === false, '未配 subagents 时 removeSubagent → 返回 false')
    sdk.unmount()
  }

  console.log('[e2e:inspect] inspect().tools 含 write_todos + update_todo(planning 开)+ planPhase 初始(add-adaptive-planning)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-planning-tools', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, planning: true },
    })
    await sdk.mount()
    const names = sdk.inspect().tools.map((t) => t.name)
    assert(names.includes('write_todos'), 'planning 开 → inspect().tools 含 write_todos')
    assert(names.includes('update_todo'), 'planning 开 → inspect().tools 含 update_todo(add-adaptive-planning 增量工具)')
    const ut = sdk.inspect().tools.find((t) => t.name === 'update_todo')
    assert(ut && ut.source === 'builtin', 'update_todo → source=builtin')
    const pp = sdk.inspect().planPhase
    assert(pp && pp.inPlanning === false && pp.rounds === 0 && pp.limit === 5, 'inspect().planPhase 初始 {inPlanning:false, rounds:0, limit:5(默认)}')
    sdk.unmount()

    // maxPlanRevisions 配置反映到 planPhase.limit
    const sdkCfg = createChatSdk({
      ui: false, id: 'e2e-plan-rev', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, planning: true }, maxPlanRevisions: 8,
    })
    await sdkCfg.mount()
    assert(sdkCfg.inspect().planPhase.limit === 8, 'inspect().planPhase.limit 反映 maxPlanRevisions 配置(8)')
    sdkCfg.unmount()

    // planning 关闭 → 不含 write_todos/update_todo
    const sdkOff = createChatSdk({
      ui: false, id: 'e2e-planning-off', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, planning: false },
    })
    await sdkOff.mount()
    const namesOff = sdkOff.inspect().tools.map((t) => t.name)
    assert(!namesOff.includes('write_todos') && !namesOff.includes('update_todo'), 'planning:false → 不含 write_todos/update_todo')
    sdkOff.unmount()
  }

  console.log('[e2e:inspect] mission 任务目标锚定(revive-mission-anchor Phase 1)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-mission', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().mission === undefined, 'inspect().mission 初始 undefined(未 capture)')
    assert(sdk.getMission() === undefined, 'getMission() 初始 undefined')
    sdk.setMission({ goal: '测试目标', acceptanceCriteria: ['标准1'] })
    assert(sdk.getMission()?.goal === '测试目标' && sdk.getMission()?.explicit === true, 'setMission({goal,criteria}) → getMission 反映(explicit=true)')
    assert(sdk.inspect().mission?.goal === '测试目标', 'inspect().mission 反映 setMission')
    sdk.setMission({})
    assert(sdk.getMission() === undefined, 'setMission({}) → 清空')
    sdk.unmount()

    // capabilities.missionAnchor:false → 不装,getMission undefined,setMission warn 不抛
    const sdkOff = createChatSdk({ ui: false, id: 'e2e-mission-off', storage: 'memory', llm: FAKE_LLM, capabilities: { ...MIN_CAPS, missionAnchor: false } })
    await sdkOff.mount()
    assert(sdkOff.getMission() === undefined, 'missionAnchor:false → getMission undefined')
    let threw = false
    try { sdkOff.setMission({ goal: 'x' }) } catch { threw = true }
    assert(!threw, 'missionAnchor:false → setMission warn 不抛')
    assert(sdkOff.getMission() === undefined, 'missionAnchor:false → setMission 忽略(getMission 仍 undefined)')
    assert(!sdkOff.inspect().middleware.includes('mission'), 'missionAnchor:false → middleware 不含 mission')
    sdkOff.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
