// 乐观锁冲突人工介入:pendingConflict / resolveConflict 暴露 + onConflict 机制
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:conflict] pendingConflict / resolveConflict 暴露在 sdk 实例')
  {
    const bind = { title: 'orig' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-conflict', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind, description: '标题' },
    })
    await sdk.mount()
    assert(sdk.pendingConflict != null && 'value' in sdk.pendingConflict, 'sdk.pendingConflict 是响应式 ref(有 value)')
    assert(sdk.pendingConflict.value === null, '初始无冲突 → pendingConflict.value 为 null')
    assert(typeof sdk.resolveConflict === 'function', 'sdk.resolveConflict 是函数')
    // 无挂起时调 resolveConflict 不抛错(幂等安全)
    sdk.resolveConflict('keep_external')
    assert(sdk.pendingConflict.value === null, '无挂起时 resolveConflict 不改状态(幂等)')
    sdk.unmount()
  }

  console.log('[e2e:conflict] onConflict 经 createDataOps 独立可用(不接 ChatDialog)')
  {
    // 直接验证 createDataOps 的 onConflict 选项存在(集成方可独立用)
    const { createDataOps } = await import('../../dist/page-agent-sdk.js')
    const bind = { x: 'a' }
    const tools = createDataOps({ schema: z.object({ x: z.string() }), bind, description: 'x' }, {
      onConflict: () => Promise.resolve({ action: 'keep_external' }),
    })
    assert(Array.isArray(tools) && tools.length > 0, 'createDataOps 传 onConflict 选项 → 工具数组正常返回')
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
