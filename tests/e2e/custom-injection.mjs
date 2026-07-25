// 自定义注入:tools(source=user) / middleware / skills + memory / 配置项可传 / llm 配置
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, defineTool, defineSkill } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:custom-injection] 自定义 tools 注入 → inspect().tools 含,source=user')
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

  console.log('[e2e:custom-injection] 自定义 middleware 注入 → inspect().middleware 含')
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

  console.log('[e2e:custom-injection] skills + memory 配置 → inspect 反映')
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

  console.log('[e2e:custom-injection] 配置项可传不报错:maxRetries / maxParallelTools / maxMemoryRounds / contextOptions / vfs.maxBytes')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-opts', storage: 'memory', llm: FAKE_LLM, capabilities: { ...MIN_CAPS, vfs: true, summarization: true },
      maxRetries: 5,
      maxParallelTools: 4,
      maxMemoryRounds: 30,
      contextOptions: { preserveLastToolResults: ['describe_data_slot'] },
      vfs: { maxBytes: 2 * 1024 * 1024 },
    })
    await sdk.mount()
    assert(sdk.inspect().middleware.includes('vfs'), 'vfs:true + vfs.maxBytes 配置 → vfs 中间件装载')
    assert(sdk.inspect().middleware.includes('summarization'), 'summarization:true + contextOptions → summarization 中间件装载')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] llm 配置 temperature/maxTokens 可传不报错')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-llm-cfg', storage: 'memory',
      llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'fake', temperature: 0.3, maxTokens: 8192 },
      capabilities: MIN_CAPS,
    })
    await sdk.mount()
    assert(sdk.inspect().model === 'fake', 'llm 含 temperature/maxTokens 配置 → mount 成功')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
