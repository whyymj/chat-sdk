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
      contextOptions: { preserveLastToolResults: ['describe_data'] },
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
    const bind = { secret: 's', title: 't' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-interceptors', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.any(), bind, description: '应用' },
      interceptors: {
        read: (v) => ({ ...v, secret: '***' }),
        write: () => ({ error: '禁止' }),
      },
    })
    await sdk.mount()
    const names = sdk.inspect().tools.map((t) => t.name)
    assert(names.includes('read') && names.includes('write'), 'interceptors 透传 → read/write 工具仍装配')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] data bind 字段 → 直连 bind(不挂 window)+ inspect().data')
  {
    const page = { title: '首页', items: [] }
    const PageSchema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-bind', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: PageSchema, bind: page, description: '页面' },
    })
    await sdk.mount()
    const info = sdk.inspect().data
    assert(!!info && info.description === '页面', 'data bind → inspect().data 反映')
    assert(sdk.getData()?.bind === page, 'data bind → getData().bind === 传入对象(直连,不挂 window)')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] data schema .describe() → systemPrompt 含可操作数据段')
  {
    const PageSchema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-io', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: PageSchema, bind: { title: 't', count: 0 }, description: '页面配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(/可操作数据/.test(sp), 'data schema → systemPrompt 含「可操作数据」段')
    assert(/页面标题/.test(sp), 'data schema .describe() → systemPrompt 提取字段说明(页面标题)')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] interceptors.input/output 透传 → 构造成功')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-io-interceptors', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.any(), bind: { x: 1 }, description: '应用' },
      interceptors: {
        input: (x) => x,
        output: (x) => x,
      },
    })
    await sdk.mount()
    assert(typeof sdk.send === 'function', 'interceptors.input/output 透传 → mount 成功')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] exportData 导出主数据深拷贝 + importData 导入(默认校验 + 就地还原保留引用)')
  {
    const bind = { title: '原', count: 1, items: [{ id: 1, name: 'a' }] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-export', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string(), count: z.number(), items: z.array(z.object({ id: z.number(), name: z.string() })) }), bind },
    })
    await sdk.mount()
    // exportData:深拷贝(改导出不影响原 bind)
    const exported = sdk.exportData()
    assert(exported && exported.title === '原' && exported.count === 1 && exported.items.length === 1, 'exportData 返回 bind 深拷贝(内容一致)')
    exported.title = '改'
    assert(bind.title === '原', 'exportData 是深拷贝(改导出对象不影响原 bind)')
    // importData:校验通过 → 就地还原(保留 bind 引用)
    const r = sdk.importData({ title: '新', count: 5, items: [{ id: 2, name: 'b' }] })
    assert(r.ok === true, 'importData 合法数据 → 校验通过,返回 {ok:true}')
    assert(bind.title === '新' && bind.count === 5 && bind.items.length === 1 && bind.items[0].id === 2, 'importData 就地还原 bind 内容(保留同一引用)')
    // importData:校验失败 → 不写入,返回 {ok:false,error}
    const r2 = sdk.importData({ title: 123, count: 'bad' })
    assert(r2.ok === false && typeof r2.error === 'string', 'importData 非法数据 → 校验失败,返回 {ok:false,error}')
    assert(bind.title === '新', 'importData 校验失败不写入(bind 不变)')
    // importData:validate:false 跳过校验
    const r3 = sdk.importData({ title: '跳过', count: 99 }, { validate: false })
    assert(r3.ok === true && bind.title === '跳过' && bind.count === 99, 'importData validate:false 跳过校验,直接写入')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] onAudit 审计回调选项 → 构造时不报错(独立于 debug)')
  {
    let audited = null
    const sdk = createChatSdk({
      ui: false, id: 'e2e-onaudit', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onAudit: (e) => { audited = e },
    })
    await sdk.mount()
    assert(typeof sdk.send === 'function', 'onAudit 选项透传 → mount 成功(独立于 debug,无需 debug:true)')
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] setSkills/invalidateSkillCache → 运行时替换 skill 列表')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-setskills', storage: 'memory', llm: FAKE_LLM, capabilities: { ...MIN_CAPS, skills: true },
      skills: [{ name: 's1', description: '初始 skill', getContent: () => 'OLD' }],
    })
    await sdk.mount()
    assert(typeof sdk.setSkills === 'function' && typeof sdk.invalidateSkillCache === 'function', 'sdk 暴露 setSkills/invalidateSkillCache')
    assert(sdk.inspect().skills.length === 1 && sdk.inspect().skills[0].description === '初始 skill', 'inspect().skills 反映初始 skill')
    // 同名替换为 v2
    sdk.setSkills([{ name: 's1', description: '新 skill', getContent: () => 'NEW' }])
    assert(sdk.inspect().skills.length === 1 && sdk.inspect().skills[0].description === '新 skill', 'setSkills 同名替换 → inspect().skills 反映新 skill')
    // invalidateSkillCache 不报错(无已加载缓存也安全)
    sdk.invalidateSkillCache('s1')
    sdk.invalidateSkillCache()
    sdk.unmount()
  }

  console.log('[e2e:custom-injection] setSkills skills 关闭 → 控制台 warn 不抛错')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-setskills-off', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, skills: false },
    })
    await sdk.mount()
    assert(sdk.inspect().skills.length === 0, 'skills 关闭 → inspect().skills 为空')
    // 调 setSkills 应 warn 但不抛错
    let threw = false
    try { sdk.setSkills([{ name: 'x', description: 'x', getContent: () => 'x' }]) } catch { threw = true }
    assert(!threw, 'skills 关闭时 setSkills → warn 不抛错')
    assert(sdk.inspect().skills.length === 0, 'skills 关闭时 setSkills → inspect 仍为空(no-op)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
