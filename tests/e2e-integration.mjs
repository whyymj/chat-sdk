// 集成层 e2e(用构建产物 dist,验证 createChatSdk 顶层 API:默认 systemPrompt / 动态注册 / inspect / hook)
// 覆盖 selftest(底层 tsx)触不到的 createChatSdk 集成层(作用域/默认提示词/动态注册 API 暴露)
// 运行:先 npm run build,再 npm run test:e2e
import { createChatSdk, z } from '../dist/page-agent-sdk.js'

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

console.log(`\n==== e2e: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
