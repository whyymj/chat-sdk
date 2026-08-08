// 子 agent:预声明 subagents → middleware + 详细配置可传
import { setupEnv, createAssert, FAKE_LLM, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:subagents] 预声明 subagents → inspect().middleware 含 subagent/subagents 中间件')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-subagents', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false },
      subagents: [
        { id: 'researcher', description: '调研专家' },
        { id: 'reviewer', description: '文案审查' },
      ],
    })
    await sdk.mount()
    const mw = sdk.inspect().middleware
    assert(mw.includes('subagent'), 'subagent 默认开 → 中间件栈含 subagent(spawn_agent/spawn_agents)')
    assert(mw.includes('subagents'), '预声明 subagents → 中间件栈含 subagents(use_<id> 委派工具)')
    const sdkOff = createChatSdk({
      ui: false, id: 'e2e-subagents-off', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
    })
    await sdkOff.mount()
    assert(!sdkOff.inspect().middleware.includes('subagent'), 'subagent:false → 不含 subagent 中间件')
    sdk.unmount()
    sdkOff.unmount()
  }

  console.log('[e2e:subagents] 预声明配置可传(llm/systemPrompt/temperature/maxTokens)不报错')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-sub-cfg2', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false },
      subagents: [
        { id: 'worker', description: '工作者', systemPrompt: '你是子 agent', temperature: 0.3, maxTokens: 4096 },
      ],
    })
    await sdk.mount()
    assert(sdk.inspect().middleware.includes('subagents'), 'subagents 预声明含详细配置 → subagents 中间件装载')
    sdk.unmount()
  }

  console.log('[e2e:subagents] focus 继承装配(主 setFocus + getFocus/getSchema 透传链 + 中间件栈不破坏)')
  {
    // 主 setFocus 后,getFocus/getSchema 透传链注入子 agent 配置(spawn 时子 agent 经 initialFocus 继承;此处验装配层不报错)
    const sdk = createChatSdk({
      ui: false, id: 'e2e-sub-focus', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false },
      data: {
        schema: z.object({ components: z.array(z.object({ type: z.string(), props: z.object({ title: z.string() }) })) }),
        bind: { components: [{ type: 'nav', props: { title: '导航' } }] },
        description: '页面',
      },
      toolMode: 'advanced',
      subagents: [{ id: 'worker', description: '工作者' }],
    })
    await sdk.mount()
    assert(sdk.setFocus({ path: 'components.0' }).ok === true, 'subagent+focus: 主 setFocus → ok(getFocus/getSchema 透传链装配正确)')
    assert(sdk.getFocus()?.path === 'components.0', 'subagent+focus: getFocus 反映主焦点')
    assert(sdk.inspect().middleware.includes('subagents'), 'subagent+focus: 子 agent 中间件栈仍含 subagents(继承是运行态,装配不破坏)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
