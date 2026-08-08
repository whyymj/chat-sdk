// 受保护资源(精确值保护):data.resources 配置 → 资源工具暴露 + resourcesPin 中间件 + SDK API + 未配置不暴露
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:resources] 受保护资源 · 资源工具暴露 + resourcesPin 中间件 + SDK API + 未配置不暴露')
  const schema = z.object({ id: z.string(), token: z.string(), title: z.string() })
  const bind = { id: 'id-1', token: 'tok', title: '页面' }
  // resources 需 vfsStore(capabilities.vfs 默认开;MIN_CAPS 关 vfs → 显式开)
  const caps = { ...MIN_CAPS, vfs: true }

  // advanced + data.resources → 资源工具暴露 + resourcesPin 中间件
  const sdk = createChatSdk({
    ui: false, id: 'e2e-res', storage: 'memory', llm: FAKE_LLM, capabilities: caps,
    data: { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }] }, toolMode: 'advanced',
  })
  await sdk.mount()
  const tools = sdk.inspect().tools.map((t) => t.name)
  assert(tools.includes('resource_get'), 'advanced + data.resources → tools 含 resource_get')
  assert(tools.includes('resource_update'), 'advanced + data.resources → tools 含 resource_update')
  assert(tools.includes('resource_list'), 'advanced + data.resources → tools 含 resource_list')
  assert(tools.includes('resource_delete'), 'advanced + data.resources → tools 含 resource_delete')
  const rget = sdk.inspect().tools.find((t) => t.name === 'resource_get')
  assert(rget?.source === 'builtin', 'resource_get → source=builtin')
  assert(sdk.inspect().middleware.includes('resourcesPin'), '配 data.resources → middleware 含 resourcesPin(跨压缩 pin)')
  sdk.unmount()

  // simple → 不含 resource_*(SIMPLE_HIDDEN)
  const sdkS = createChatSdk({
    ui: false, id: 'e2e-res-s', storage: 'memory', llm: FAKE_LLM, capabilities: caps,
    data: { schema, bind, resources: [{ path: 'id', mode: 'freeze' }] }, toolMode: 'simple',
  })
  await sdkS.mount()
  const sTools = sdkS.inspect().tools.map((t) => t.name)
  assert(!sTools.includes('resource_get'), 'simple → tools 不含 resource_*(SIMPLE_HIDDEN)')
  sdkS.unmount()

  // 未配 resources → 不含 resource_* + middleware 不含 resourcesPin
  const sdkN = createChatSdk({
    ui: false, id: 'e2e-res-n', storage: 'memory', llm: FAKE_LLM, capabilities: caps,
    data: { schema, bind }, toolMode: 'advanced',
  })
  await sdkN.mount()
  const nTools = sdkN.inspect().tools.map((t) => t.name)
  assert(!nTools.includes('resource_get'), '未配 resources → tools 不含 resource_*')
  assert(!sdkN.inspect().middleware.includes('resourcesPin'), '未配 resources → middleware 不含 resourcesPin')
  sdkN.unmount()

  // SDK API 资源方法(createResource/getResource/updateResource/listResources/deleteResource)
  const sdkA = createChatSdk({
    ui: false, id: 'e2e-res-api', storage: 'memory', llm: FAKE_LLM, capabilities: caps,
    data: { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }] }, toolMode: 'advanced',
  })
  await sdkA.mount()
  sdkA.createResource('token', 'manual-tok')
  assert(sdkA.getResource('token')?.value === 'manual-tok', 'SDK API createResource + getResource')
  assert(sdkA.listResources().some((r) => r.path === 'token'), 'SDK API listResources')
  sdkA.updateResource('token', 'updated-tok')
  assert(sdkA.getResource('token')?.value === 'updated-tok', 'SDK API updateResource(verbatim 改值)')
  assert(sdkA.deleteResource('token') === true, 'SDK API deleteResource')
  // releaseResources 批量释放
  sdkA.createResource('id', 'x')
  sdkA.releaseResources()
  assert(sdkA.listResources().length === 0, 'SDK API releaseResources(未传 paths → 释放全部)')
  sdkA.unmount()

  return { pass: ctx.pass, fail: ctx.fail }
}
