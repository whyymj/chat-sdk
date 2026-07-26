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

  console.log('[e2e:custom-injection] interceptors 透传 → 构造成功 + read/write 工具装配')
  {
    globalThis.window.app = { secret: 's', title: 't' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-interceptors', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app', description: '应用', schema: z.any() }],
      interceptors: {
        read: (_p, v) => ({ ...v, secret: '***' }),
        write: () => ({ error: '禁止' }),
      },
    })
    await sdk.mount()
    const names = sdk.inspect().tools.map((t) => t.name)
    assert(names.includes('read') && names.includes('write'), 'interceptors 透传 → read/write 工具仍装配')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] dataSlots bind 字段 → 自动挂 window + 注册 dataSlot')
  {
    globalThis.window.app = {}
    const page = { title: '首页', items: [] }
    const PageSchema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-bind', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'page', schema: PageSchema, bind: page }],
    })
    await sdk.mount()
    const slots = sdk.inspect().dataSlots.map((s) => s.path)
    assert(slots.includes('page'), 'dataSlots bind → inspect().dataSlots 含 page')
    assert(globalThis.window.page === page, 'dataSlots bind → 对象挂到 window.page(工具经此操作)')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] dataSlots schema .describe() → systemPrompt 含可操作属性段')
  {
    globalThis.window.app = {}
    const PageSchema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-io', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'page', description: '页面配置', schema: PageSchema }],
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(/可操作属性/.test(sp), 'dataSlots schema → systemPrompt 含「可操作属性」段')
    assert(/页面标题/.test(sp), 'dataSlots schema .describe() → systemPrompt 提取字段说明(页面标题)')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] interceptors.input/output 透传 → 构造成功')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-io-interceptors', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app', description: '应用', schema: z.any() }],
      interceptors: {
        input: (x) => x,
        output: (x) => x,
      },
    })
    await sdk.mount()
    assert(typeof sdk.send === 'function', 'interceptors.input/output 透传 → mount 成功')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
