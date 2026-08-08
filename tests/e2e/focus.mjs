// focus 上下文聚焦:setFocus/getFocus/clearFocus API + inspect().focus + set_focus/clear_focus 工具 + capabilities.focus
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:focus] 上下文聚焦 · setFocus/getFocus/clearFocus + inspect + 工具 + capabilities')
  const schema = z.object({
    title: z.string(),
    components: z.array(z.object({ type: z.string(), props: z.object({ title: z.string() }) })),
  })
  const bind = {
    title: '首页',
    components: [
      { type: 'nav', props: { title: '导航' } },
      { type: 'hero', props: { title: '主视觉' } },
    ],
  }

  // 基础:advanced + focus 默认开
  const sdk = createChatSdk({
    ui: false, id: 'e2e-focus', storage: 'memory', llm: FAKE_LLM,
    capabilities: MIN_CAPS, data: { schema, bind, description: '页面' }, toolMode: 'advanced',
  })
  await sdk.mount()

  // getFocus 初始 undefined
  assert(sdk.getFocus() === undefined, 'getFocus 初始 → undefined')
  assert(sdk.inspect().focus === undefined, 'inspect().focus 初始 → undefined')

  // setFocus 合法 path
  const ok = sdk.setFocus({ path: 'components.0', label: '导航栏' })
  assert(ok.ok === true, 'setFocus 合法 path(components.0)→ {ok:true}')
  assert(sdk.getFocus()?.path === 'components.0', 'setFocus 后 getFocus → path')
  assert(sdk.getFocus()?.label === '导航栏', 'setFocus 后 getFocus → label')
  assert(sdk.inspect().focus?.path === 'components.0', 'inspect().focus → 反映焦点')

  // setFocus 类型非法 path(顶层不存在字段)→ {ok:false},当前焦点不变
  const bad = sdk.setFocus({ path: 'nonexistent' })
  assert(bad.ok === false, 'setFocus 类型非法 path(nonexistent)→ {ok:false}')
  assert(!!bad.error, 'setFocus 类型非法 → error 字段有值')
  assert(sdk.getFocus()?.path === 'components.0', 'setFocus 类型非法 → 当前焦点不变')
  // 叶子 string 下取子路径 → 类型非法(拒绝)
  assert(sdk.setFocus({ path: 'title.sub' }).ok === false, 'setFocus 叶子(title)下取子路径 → {ok:false}')
  // 数组索引路径类型合法(getSchemaAtPath 取元素 schema,不校验索引范围)→ 可聚焦(类型校验非数据存在性)
  assert(sdk.setFocus({ path: 'components.5' }).ok === true, 'setFocus 数组索引(components.5)类型合法 → {ok:true}(类型校验非数据存在性)')

  // setFocus 空 path → {ok:false}
  assert(sdk.setFocus({ path: '' }).ok === false, 'setFocus 空 path → {ok:false}')

  // clearFocus
  sdk.clearFocus()
  assert(sdk.getFocus() === undefined, 'clearFocus → getFocus undefined')
  assert(sdk.inspect().focus === undefined, 'clearFocus → inspect().focus undefined')

  // advanced 工具含 set_focus/clear_focus(source=builtin)
  const tools = sdk.inspect().tools
  const sf = tools.find((t) => t.name === 'set_focus')
  const cf = tools.find((t) => t.name === 'clear_focus')
  assert(!!sf, 'advanced → tools 含 set_focus')
  assert(!!cf, 'advanced → tools 含 clear_focus')
  assert(sf?.source === 'builtin', 'set_focus → source=builtin')
  assert(cf?.source === 'builtin', 'clear_focus → source=builtin')
  // middleware 含 focus
  assert(sdk.inspect().middleware.includes('focus'), 'inspect().middleware → 含 focus')
  sdk.unmount()

  // simple 模式:不含 set_focus/clear_focus(经 UI/宿主 API 触发),但 setFocus API 仍可用
  const sdkSimple = createChatSdk({
    ui: false, id: 'e2e-focus-simple', storage: 'memory', llm: FAKE_LLM,
    capabilities: MIN_CAPS, data: { schema, bind, description: '页面' }, toolMode: 'simple',
  })
  await sdkSimple.mount()
  const simpleTools = sdkSimple.inspect().tools.map((t) => t.name)
  assert(!simpleTools.includes('set_focus'), 'simple → tools 不含 set_focus(经 UI/宿主 API 触发)')
  assert(!simpleTools.includes('clear_focus'), 'simple → tools 不含 clear_focus')
  assert(sdkSimple.setFocus({ path: 'components.1' }).ok === true, 'simple setFocus API 仍可用(经 UI/宿主触发)')
  assert(sdkSimple.getFocus()?.path === 'components.1', 'simple setFocus → getFocus 反映焦点')
  sdkSimple.unmount()

  // capabilities.focus:false → setFocus no-op + 工具/中间件不装
  const sdkOff = createChatSdk({
    ui: false, id: 'e2e-focus-off', storage: 'memory', llm: FAKE_LLM,
    capabilities: { ...MIN_CAPS, focus: false }, data: { schema, bind, description: '页面' }, toolMode: 'advanced',
  })
  await sdkOff.mount()
  assert(sdkOff.setFocus({ path: 'components.0' }).ok === false, 'capabilities.focus:false → setFocus {ok:false}')
  assert(sdkOff.getFocus() === undefined, 'capabilities.focus:false → getFocus undefined')
  const offTools = sdkOff.inspect().tools.map((t) => t.name)
  assert(!offTools.includes('set_focus'), 'capabilities.focus:false → tools 不含 set_focus')
  assert(!sdkOff.inspect().middleware.includes('focus'), 'capabilities.focus:false → middleware 不含 focus')
  sdkOff.unmount()

  console.log('[e2e:focus] 持久化 · switchSession 往返 + restore 失效丢弃 + setLlm 保留')
  const sdkP = createChatSdk({
    ui: false, id: 'e2e-focus-persist', storage: 'memory', llm: FAKE_LLM,
    capabilities: MIN_CAPS, data: { schema, bind, description: '页面' }, toolMode: 'advanced',
  })
  await sdkP.mount()
  const origId = sdkP.sessionId
  // setFocus + switchSession 往返:切走(persist)→ 新会话 reset → 切回(restore)
  sdkP.setFocus({ path: 'components.0', label: '导航' })
  await sdkP.switchSession()
  assert(sdkP.getFocus() === undefined, 'persist: switchSession 切到新会话 → focus reset(不污染)')
  await sdkP.switchSession(origId)
  assert(sdkP.getFocus()?.path === 'components.0' && sdkP.getFocus()?.label === '导航', 'persist: 切回原会话 → focus 还原(path+label)')
  assert(sdkP.inspect().focus?.path === 'components.0', 'persist: inspect().focus 反映还原的焦点')
  // clearFocus 往返:不持久化为焦点
  sdkP.clearFocus()
  await sdkP.switchSession()
  await sdkP.switchSession(origId)
  assert(sdkP.getFocus() === undefined, 'persist: clearFocus 后往返 → 不恢复(未持久化为焦点)')
  // restore 失效丢弃:setData 改 schema 使 path 失效 → 切回 restore 时丢弃(决策A)
  sdkP.setFocus({ path: 'components.1' })
  await sdkP.switchSession()
  sdkP.setData({ schema: z.object({ title: z.string() }), bind: { title: '新' }, description: '无 components' })
  await sdkP.switchSession(origId)
  assert(sdkP.getFocus() === undefined, 'persist: restore 时 path 失效(schema 变无 components)→ 丢弃(决策A)')
  // setLlm 后 focus 保留(setLlm 不碰 focusMw)
  sdkP.setData({ schema, bind, description: '页面' })
  sdkP.setFocus({ path: 'components.0' })
  try { sdkP.setLlm(FAKE_LLM) } catch {}
  assert(sdkP.getFocus()?.path === 'components.0', 'persist: setLlm 后 focus 保留(setLlm 不碰 focusMw)')
  sdkP.unmount()

  return { pass: ctx.pass, fail: ctx.fail }
}
