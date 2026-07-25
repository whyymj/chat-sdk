// 集成层 e2e(用构建产物 dist,验证 createChatSdk 顶层 API:默认 systemPrompt / 动态注册 / inspect / hook)
// 覆盖 selftest(底层 tsx)触不到的 createChatSdk 集成层(作用域/默认提示词/动态注册 API 暴露)
// 运行:先 npm run build,再 npm run test:e2e
import { createChatSdk, z, defineTool, defineSkill, presets, systemPromptHelpers, createMemoryBackend } from '../dist/page-agent-sdk.js'

// node 环境构造 window/document stub(windowOps 工具函数体用 window;mount 的 pagehide/visibility guard 需 addEventListener)
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, app: {} }
if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }

let pass = 0, fail = 0
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗', msg) } }

const FAKE_LLM = { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'fake' }
const MIN_CAPS = { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false }

console.log('[e2e] 默认 systemPrompt + inspect.systemPrompt')
{
  const sdk = createChatSdk({
    ui: false, id: 'e2e-default', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
  })
  await sdk.mount()
  const info = sdk.inspect()
  assert(typeof info.systemPrompt === 'string' && info.systemPrompt.length > 0, 'inspect().systemPrompt 为非空字符串')
  assert(/reliableWriteRules|改前先|增量 patch|可靠写入/.test(info.systemPrompt), '默认 systemPrompt 含 reliableWriteRules 关键词')
  assert(/页面操作助手/.test(info.systemPrompt), '默认 systemPrompt 含「页面操作助手」身份')
  sdk.unmount()
}

console.log('[e2e] 自定义 systemPrompt 完全覆盖默认')
{
  const sdk = createChatSdk({
    ui: false, id: 'e2e-custom', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    systemPrompt: '你是定制助手。',
    windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
  })
  await sdk.mount()
  assert(sdk.inspect().systemPrompt === '你是定制助手。', '自定义 systemPrompt 完全覆盖默认')
  sdk.unmount()
}

console.log('[e2e] 动态注册 addWindowProp / removeWindowProp / listWindowProps')
{
  globalThis.window.app = {}
  const sdk = createChatSdk({
    ui: false, id: 'e2e-dyn', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [{ path: 'app.base', description: '初始', schema: z.string() }],
  })
  await sdk.mount()

  let listed = sdk.listWindowProps().map((p) => p.path)
  assert(listed.length === 1 && listed.includes('app.base'), '初始 listWindowProps 仅含 app.base')
  assert(sdk.inspect().windowProps.length === 1, 'inspect().windowProps 反映初始注册')

  sdk.addWindowProp({ path: 'app.dyn', description: '动态组件 {a,b}', schema: z.object({ a: z.string(), b: z.number() }) })
  listed = sdk.listWindowProps().map((p) => p.path)
  assert(listed.length === 2 && listed.includes('app.dyn'), 'addWindowProp 后 listWindowProps 含 app.dyn')
  assert(sdk.inspect().windowProps.some((p) => p.path === 'app.dyn'), 'inspect().windowProps 反映动态新增')

  assert(sdk.removeWindowProp('app.dyn') === true, 'removeWindowProp 返回 true(确实存在并移除)')
  listed = sdk.listWindowProps().map((p) => p.path)
  assert(listed.length === 1 && !listed.includes('app.dyn'), 'removeWindowProp 后不再含 app.dyn')
  assert(sdk.removeWindowProp('app.never') === false, 'removeWindowProp 不存在 path 返回 false')
  sdk.unmount()
}

console.log('[e2e] windowOps 关闭时 addWindowProp/removeWindowProp 为 no-op')
{
  globalThis.window.app = {}
  const sdk = createChatSdk({
    ui: false, id: 'e2e-noops', storage: 'memory', llm: FAKE_LLM,
    capabilities: { ...MIN_CAPS, windowOps: false },
  })
  await sdk.mount()
  sdk.addWindowProp({ path: 'app.x', description: 'x', schema: z.string() })
  assert(sdk.listWindowProps().length === 0, 'windowOps:false → addWindowProp no-op(list 仍空)')
  assert(sdk.removeWindowProp('app.x') === false, 'windowOps:false → removeWindowProp 返回 false')
  sdk.unmount()
}

console.log('[e2e] sdk.hook 返回取消函数')
{
  globalThis.window.app = {}
  const sdk = createChatSdk({
    ui: false, id: 'e2e-hook', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
  })
  await sdk.mount()
  const off = sdk.hook(() => {})
  assert(typeof off === 'function', 'sdk.hook 返回取消函数(function)')
  off()
  sdk.unmount()
}

console.log('[e2e] inspect().tools 反映 windowOps 开关 + 工具集完整性')
{
  globalThis.window.app = {}
  // windowOps 开启 → 含完整 window 工具集
  const sdkOn = createChatSdk({
    ui: false, id: 'e2e-tools-on', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [{ path: 'app.x', description: 'x', schema: z.string() }],
  })
  await sdkOn.mount()
  const toolsOn = sdkOn.inspect().tools.map((t) => t.name)
  const expectedWinTools = ['list_window_props', 'describe_window_prop', 'get_window_prop', 'get_window_paths', 'set_window_prop', 'edit_window_prop', 'delete_window_prop', 'snapshot_window_prop', 'list_window_snapshots', 'restore_window_snapshot', 'query_window_prop', 'search_window_prop', 'eval_window_script']
  for (const name of expectedWinTools) {
    assert(toolsOn.includes(name), `windowOps 开启 → 含 ${name}`)
  }
  assert(toolsOn.includes('fetch_document') === false, 'MIN_CAPS(fetch:false) → 不含 fetch_document')
  sdkOn.unmount()

  // windowOps 关闭 → 不含任何 window 工具
  const sdkOff = createChatSdk({
    ui: false, id: 'e2e-tools-off', storage: 'memory', llm: FAKE_LLM,
    capabilities: { ...MIN_CAPS, windowOps: false },
  })
  await sdkOff.mount()
  const toolsOff = sdkOff.inspect().tools.map((t) => t.name)
  assert(!toolsOff.some((n) => n.endsWith('_window_prop') || n.endsWith('_window_snapshot') || n === 'eval_window_script'), 'windowOps:false → 不含任何 window 工具')
  sdkOff.unmount()
}

console.log('[e2e] inspect().middleware 反映 capabilities 开关')
{
  globalThis.window.app = {}
  // 全开 → 含核心中间件
  const sdkFull = createChatSdk({
    ui: false, id: 'e2e-mw-full', storage: 'memory', llm: FAKE_LLM,
    capabilities: { windowOps: false, fetch: false },  // 其余默认开
    windowProps: [{ path: 'app.x', description: 'x', schema: z.string() }],
  })
  await sdkFull.mount()
  const mwFull = sdkFull.inspect().middleware
  assert(mwFull.includes('usageHints'), '中间件栈含 usageHints(始终装载)')
  assert(mwFull.includes('todos'), '中间件栈含 todos(planning 默认开)')
  assert(mwFull.includes('summarization'), '中间件栈含 summarization(默认开)')
  assert(mwFull.includes('skills'), '中间件栈含 skills(默认开)')
  sdkFull.unmount()

  // 关 planning/vfs/skills/summarization/memory/subagent → 不含对应中间件
  const sdkLean = createChatSdk({
    ui: false, id: 'e2e-mw-lean', storage: 'memory', llm: FAKE_LLM,
    capabilities: { windowOps: false, fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
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

console.log('[e2e] 预声明 subagents → inspect().middleware 含 subagent/subagents 中间件')
{
  globalThis.window.app = {}
  const sdk = createChatSdk({
    ui: false, id: 'e2e-subagents', storage: 'memory', llm: FAKE_LLM,
    // 不关 subagent(默认开);其余精简
    capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false },
    subagents: [
      { id: 'researcher', description: '调研专家' },
      { id: 'reviewer', description: '文案审查' },
    ],
  })
  await sdk.mount()
  const mw = sdk.inspect().middleware
  // subagent 工具(spawn_agent/spawn_agents/use_<id>)由中间件 tools 钩子动态贡献,在 createAgent bindTools 时加入,
  // 不进 inspect().tools(那是静态 allTools);故此处验中间件装载,工具装载由运行时手动验证
  assert(mw.includes('subagent'), 'subagent 默认开 → 中间件栈含 subagent(spawn_agent/spawn_agents)')
  assert(mw.includes('subagents'), '预声明 subagents → 中间件栈含 subagents(use_<id> 委派工具)')
  // subagent 关闭 → 不含
  const sdkOff = createChatSdk({
    ui: false, id: 'e2e-subagents-off', storage: 'memory', llm: FAKE_LLM,
    capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
  })
  await sdkOff.mount()
  assert(!sdkOff.inspect().middleware.includes('subagent'), 'subagent:false → 不含 subagent 中间件')
  sdk.unmount()
  sdkOff.unmount()
}

console.log('[e2e] 默认 systemPrompt 含能力概述(范围控制/schema 校验/快照/增量 patch)')
{
  const sdk = createChatSdk({
    ui: false, id: 'e2e-default-detail', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
  })
  await sdk.mount()
  const sp = sdk.inspect().systemPrompt
  assert(/范围控制|注册表/.test(sp), '默认 systemPrompt 含「范围控制/注册表」能力说明')
  assert(/schema 校验|校验/.test(sp), '默认 systemPrompt 含「schema 校验」能力说明')
  assert(/快照|回退/.test(sp), '默认 systemPrompt 含「快照/回退」能力说明')
  assert(/增量 patch|增量/.test(sp), '默认 systemPrompt 含「增量 patch」能力说明')
  sdk.unmount()
}

console.log('[e2e] 自定义 systemPrompt + systemPromptHelpers.reliableWriteRules 拼接(常见用法)')
{
  const { systemPromptHelpers } = await import('../dist/page-agent-sdk.js')
  const custom = '你是商品页编辑助手。'
  const sdk = createChatSdk({
    ui: false, id: 'e2e-custom-merge', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    systemPrompt: `${custom}\n${systemPromptHelpers.reliableWriteRules}`,
    windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
  })
  await sdk.mount()
  const sp = sdk.inspect().systemPrompt
  assert(sp.startsWith('你是商品页编辑助手。'), '自定义 systemPrompt 保留(拼在前)')
  assert(/reliableWriteRules|改前先|增量 patch/.test(sp), '拼接后含 reliableWriteRules(用户自行拼入)')
  sdk.unmount()
}

console.log('[e2e] onEvent + sdk.hook 联动(构造时 onEvent 与运行时 hook 均注册)')
{
  globalThis.window.app = {}
  let onEventCount = 0, hookCount = 0
  const sdk = createChatSdk({
    ui: false, id: 'e2e-events', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
    onEvent: () => { onEventCount++ },
  })
  await sdk.mount()
  const off = sdk.hook(() => { hookCount++ })
  assert(typeof off === 'function' && onEventCount === 0 && hookCount === 0, 'onEvent + hook 均挂载,未触发前计数为 0')
  off()
  sdk.unmount()
}

console.log('[e2e] 自定义 tools 注入 → inspect().tools 含,source=user')
{
  const myTool = defineTool({
    name: 'my_query',
    description: '自定义查询工具',
    schema: z.object({ q: z.string() }),
    handler: async ({ q }) => `result:${q}`,
  })
  const sdk = createChatSdk({
    ui: false, id: 'e2e-custom-tool', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    tools: [myTool],
  })
  await sdk.mount()
  const t = sdk.inspect().tools.find((x) => x.name === 'my_query')
  assert(!!t, 'inspect().tools 含自定义工具 my_query')
  assert(t?.source === 'user', '自定义工具 source=user')
  sdk.unmount()
}

console.log('[e2e] 自定义 middleware 注入 → inspect().middleware 含')
{
  const myMw = { name: 'myMw', beforeAgent: () => {} }
  const sdk = createChatSdk({
    ui: false, id: 'e2e-custom-mw', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    middleware: [myMw],
  })
  await sdk.mount()
  assert(sdk.inspect().middleware.includes('myMw'), 'inspect().middleware 含自定义 myMw')
  sdk.unmount()
}

console.log('[e2e] skills + memory 配置 → inspect 反映')
{
  const skill = defineSkill({ name: 'summarize', description: '摘要技能', prompt: '请精简' })
  const sdk = createChatSdk({
    ui: false, id: 'e2e-skills-mem', storage: 'memory', llm: FAKE_LLM,
    capabilities: { fetch: false, planning: false, vfs: false, summarization: false, subagent: false },
    skills: [skill],
    memory: '## AGENTS.md\n保持简洁。',
  })
  await sdk.mount()
  const info = sdk.inspect()
  assert(info.skills.some((s) => s.name === 'summarize'), 'inspect().skills 含 summarize')
  assert(info.memory.includes('保持简洁'), 'inspect().memory 含传入内容')
  sdk.unmount()
}

console.log('[e2e] inspect().id / model 反映配置')
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

console.log('[e2e] inspect().subagent 反映 subagent 配置')
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

console.log('[e2e] inspect().verify 反映 capabilities.verify + verify 配置')
{
  // 默认关 → undefined
  const sdkOff = createChatSdk({ ui: false, id: 'e2e-verify-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdkOff.mount()
  assert(sdkOff.inspect().verify?.enabled === false, 'verify 默认关 → inspect().verify.enabled=false')
  sdkOff.unmount()
  // 开 + 配置
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

console.log('[e2e] inspect().mcp 无 MCP 时为 undefined')
{
  const sdk = createChatSdk({ ui: false, id: 'e2e-mcp-none', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdk.mount()
  assert(Array.isArray(sdk.inspect().mcp?.servers) && sdk.inspect().mcp.servers.length === 0, '无 mcp 配置 → inspect().mcp.servers 为空数组')
  sdk.unmount()
}

console.log('[e2e] switchSession:storage 未开启抛错 / 开启返回新 id')
{
  // 未开启 → 抛错
  const sdkNoStorage = createChatSdk({ ui: false, id: 'e2e-switch-nostore', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdkNoStorage.mount()
  let threw = false
  try { await sdkNoStorage.switchSession() } catch { threw = true }
  assert(threw, 'storage 未开启 → switchSession 抛错')
  sdkNoStorage.unmount()
  // 开启 → 返回新 id
  const sdk = createChatSdk({ ui: false, id: 'e2e-switch-ok', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdk.mount()
  const newId = await sdk.switchSession()
  assert(typeof newId === 'string' && newId.length > 0, 'storage 开启 → switchSession 返回新 id(string)')
  // 指定 id 载入
  const fixedId = await sdk.switchSession('my-session-123')
  assert(fixedId === 'my-session-123', 'switchSession(id) 返回该 id')
  sdk.unmount()
}

console.log('[e2e] restoreLastCheckpoint / listCheckpoints:无 checkpoint 时空操作')
{
  const sdk = createChatSdk({ ui: false, id: 'e2e-ckpt', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdk.mount()
  assert(sdk.restoreLastCheckpoint() === false, '无 checkpoint → restoreLastCheckpoint 返回 false')
  assert(Array.isArray(sdk.listCheckpoints()) && sdk.listCheckpoints().length === 0, '无 checkpoint → listCheckpoints 返回空数组')
  sdk.unmount()
}

console.log('[e2e] messages 响应式数组:初始为空数组')
{
  const sdk = createChatSdk({ ui: false, id: 'e2e-msgs', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdk.mount()
  assert(Array.isArray(sdk.messages) && sdk.messages.length === 0, 'messages 初始为空数组')
  sdk.unmount()
}

console.log('[e2e] 导出项可用:presets / systemPromptHelpers / defineTool / defineSkill / createMemoryBackend')
{
  assert(typeof presets === 'object' && presets !== null, 'presets 导出为对象')
  assert(['pageBuilder', 'researcher', 'minimal'].every((k) => k in presets), 'presets 含 pageBuilder/researcher/minimal')
  assert(typeof systemPromptHelpers?.reliableWriteRules === 'string' && systemPromptHelpers.reliableWriteRules.length > 0, 'systemPromptHelpers.reliableWriteRules 为非空字符串')
  assert(typeof defineTool === 'function', 'defineTool 导出为 function')
  assert(typeof defineSkill === 'function', 'defineSkill 导出为 function')
  assert(typeof createMemoryBackend === 'function', 'createMemoryBackend 导出为 function')
}

console.log('[e2e] 配置项可传不报错:maxRetries / maxParallelTools / maxMemoryRounds / contextOptions / vfs.maxBytes')
{
  const sdk = createChatSdk({
    ui: false, id: 'e2e-opts', storage: 'memory', llm: FAKE_LLM, capabilities: { ...MIN_CAPS, vfs: true, summarization: true },
    maxRetries: 5,
    maxParallelTools: 4,
    maxMemoryRounds: 30,
    contextOptions: { preserveLastToolResults: ['describe_window_prop'] },
    vfs: { maxBytes: 2 * 1024 * 1024 },
  })
  await sdk.mount()
  assert(sdk.inspect().middleware.includes('vfs'), 'vfs:true + vfs.maxBytes 配置 → vfs 中间件装载')
  assert(sdk.inspect().middleware.includes('summarization'), 'summarization:true + contextOptions → summarization 中间件装载')
  sdk.unmount()
}

console.log('[e2e] 错误场景:id 不传 → warn + 生成随机 id')
{
  const sdk = createChatSdk({ ui: false, storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
  await sdk.mount()
  const info = sdk.inspect()
  assert(typeof info.id === 'string' && info.id.length > 0, 'id 不传 → 生成随机 id(非空)')
  sdk.unmount()
}

console.log('[e2e] 空 windowProps:mount 成功')
{
  const sdk = createChatSdk({ ui: false, id: 'e2e-empty-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, windowProps: [] })
  await sdk.mount()
  assert(sdk.inspect().windowProps.length === 0, '空 windowProps → inspect().windowProps 为空')
  sdk.unmount()
}

console.log('[e2e] 多 windowProps:inspect().windowProps 含全部')
{
  const sdk = createChatSdk({
    ui: false, id: 'e2e-multi-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
    windowProps: [
      { path: 'app.title', description: '标题', schema: z.string() },
      { path: 'app.count', description: '计数', schema: z.number() },
      { path: 'app.items', description: '列表', schema: z.array(z.string()) },
    ],
  })
  await sdk.mount()
  const paths = sdk.inspect().windowProps.map((p) => p.path)
  assert(paths.length === 3 && paths.includes('app.title') && paths.includes('app.count') && paths.includes('app.items'), '多 windowProps → inspect().windowProps 含全部 3 个')
  sdk.unmount()
}

console.log('[e2e] shareContext:同 id 两实例共享 messages 数组')
{
  const sdkA = createChatSdk({ ui: false, id: 'e2e-share', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, shareContext: true })
  await sdkA.mount()
  const sdkB = createChatSdk({ ui: false, id: 'e2e-share', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, shareContext: true })
  await sdkB.mount()
  assert(sdkA.messages === sdkB.messages, 'shareContext:true 同 id → 两实例 messages 为同一数组引用')
  sdkA.unmount()
  sdkB.unmount()
}

console.log('[e2e] storage 后端:session/local stub mount 成功')
{
  // stub sessionStorage / localStorage
  const makeStore = () => {
    const m = new Map()
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
      key: (i) => Array.from(m.keys())[i] ?? null,
      get length() { return m.size },
    }
  }
  if (!globalThis.sessionStorage) globalThis.sessionStorage = makeStore()
  if (!globalThis.localStorage) globalThis.localStorage = makeStore()
  for (const backend of ['session', 'local']) {
    const sdk = createChatSdk({ ui: false, id: `e2e-store-${backend}`, storage: backend, llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().id === `e2e-store-${backend}`, `storage:${backend} → mount 成功`)
    sdk.unmount()
  }
}

console.log('[e2e] presets.minimal spread:capabilities 反映精简')
{
  const sdk = createChatSdk({
    ui: false, id: 'e2e-preset-min', storage: 'memory', llm: FAKE_LLM,
    ...presets.minimal,
  })
  await sdk.mount()
  const mw = sdk.inspect().middleware
  assert(mw.includes('usageHints'), 'presets.minimal → 仍含 usageHints')
  // minimal 应关闭部分能力(具体由 preset 定义)
  assert(sdk.inspect().tools.length > 0, 'presets.minimal → 仍有工具装载')
  sdk.unmount()
}

console.log(`\n==== e2e: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
