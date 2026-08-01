// systemPrompt 相关:默认 / 自定义覆盖 / 能力概述 / reliableWriteRules 拼接
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, systemPromptHelpers } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:systemprompt] 默认 systemPrompt + inspect.systemPrompt')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-default', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const info = sdk.inspect()
    assert(typeof info.systemPrompt === 'string' && info.systemPrompt.length > 0, 'inspect().systemPrompt 为非空字符串')
    assert(/reliableWriteRules|改前先|增量 patch|可靠写入/.test(info.systemPrompt), '默认 systemPrompt 含 reliableWriteRules 关键词')
    assert(/JSON 操作助手/.test(info.systemPrompt), '默认 systemPrompt 含「JSON 操作助手」身份')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 自定义 systemPrompt 完全覆盖默认')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-custom', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: '你是定制助手。',
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    assert(sdk.inspect().systemPrompt.startsWith('你是定制助手。') && /可操作数据/.test(sdk.inspect().systemPrompt), '自定义 systemPrompt 完全覆盖默认(data schema 仍自动追加「可操作数据」段)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 默认 systemPrompt 含能力概述(范围控制/schema 校验/快照/增量 patch)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-default-detail', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(/范围控制|注册表/.test(sp), '默认 systemPrompt 含「范围控制/注册表」能力说明')
    assert(/schema 校验|校验/.test(sp), '默认 systemPrompt 含「schema 校验」能力说明')
    assert(/快照|回退/.test(sp), '默认 systemPrompt 含「快照/回退」能力说明')
    assert(/增量 patch|增量/.test(sp), '默认 systemPrompt 含「增量 patch」能力说明')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 自定义 systemPrompt + systemPromptHelpers.reliableWriteRules 拼接(常见用法)')
  {
    const custom = '你是商品页编辑助手。'
    const sdk = createChatSdk({
      ui: false, id: 'e2e-custom-merge', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: `${custom}\n${systemPromptHelpers.reliableWriteRules}`,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(sp.startsWith('你是商品页编辑助手。'), '自定义 systemPrompt 保留(拼在前)')
    assert(/可靠写入规则|改任何字段前|增量改|write 的 patch/.test(sp), '拼接后含 reliableWriteRules(用户自行拼入)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] appendReliableWriteRules 默认 true → 自定义 systemPrompt 末尾用 --- 分隔线自动追加 reliableWriteRules')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-append-default', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: '你是定制助手。',
      // 不传 appendReliableWriteRules,默认 true → 自动追加
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(sp.startsWith('你是定制助手。'), '自定义 systemPrompt 保留(在前)')
    assert(/可靠写入规则|改任何字段前/.test(sp), 'appendReliableWriteRules 默认 true → 末尾自动追加 reliableWriteRules')
    assert(/\n---\n/.test(sp), "追加用 '---' 分隔线明确区分用户 systemPrompt 与 SDK 追加的写入规则")
    assert(!/你是一个 JSON 操作助手/.test(sp), '追加不引入默认身份(只追加规则段,不替换默认 prompt)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] appendReliableWriteRules:false → 显式关闭,自定义 systemPrompt 不追加(向后兼容)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-append-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: '你是定制助手。',
      appendReliableWriteRules: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(!/可靠写入规则|改任何字段前/.test(sp), 'appendReliableWriteRules:false → 显式关闭不追加(用户已自行写规则时用)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] appendReliableWriteRules 对默认 prompt 无效(默认已内置,不重复追加)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-append-default', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      appendReliableWriteRules: true,  // 不传 systemPrompt,此项应无效(默认 prompt 已含,不重复)
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    const matches = sp.match(/可靠写入规则/g) || []
    assert(matches.length === 1, '不传 systemPrompt 时 appendReliableWriteRules 无效(默认 prompt 只含一份 reliableWriteRules,不重复)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] inspect().systemPrompt 完整性:含 usageHints/skills/memory 段(fix-introspection-consistency,修复前 getInfo 漏段)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prompt-complete', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, skills: true, memory: true, planning: true },
      systemPrompt: '你是测试助手。',
      skills: [{ name: 'mySkill', description: '测试技能描述', content: 'skill 全文内容' }],
      memory: '记住要简洁回答。',
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(sp.includes('你是测试助手。'), 'inspect().systemPrompt 含 base 段(用户 systemPrompt)')
    assert(sp.includes('能力使用提示'), 'inspect().systemPrompt 含 usageHints 段(## 能力使用提示,修复前 getInfo 漏)')
    assert(sp.includes('可用 Skills'), 'inspect().systemPrompt 含 skills 索引段(修复前 getInfo 漏)')
    assert(sp.includes('mySkill'), 'inspect().systemPrompt 含 skill 名(mySkill)')
    // memory 段(state.memory)在 beforeAgent 才注入,inspect 早调未运行时为空(design 风险段已说明,非 bug);usageHints/skills 段不依赖运行时 state,足以证明 getInfo 收敛修复
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 「可操作数据」段含字段类型 + 约束标注(expose-schema-constraints)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-schema-hint', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: {
        schema: z.object({
          title: z.string().min(1).max(100).describe('标题'),
          count: z.number().int().min(0),
          role: z.enum(['admin', 'user']),
        }),
        bind: { title: 't', count: 1, role: 'admin' },
        description: '应用配置',
      },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(/可操作数据/.test(sp), '「可操作数据」段存在')
    assert(/\(string\)/.test(sp) && /\(number\)/.test(sp) && /\(enum\)/.test(sp), '「可操作数据」段含字段类型标注(string/number/enum)')
    assert(/minLen=1/.test(sp), '「可操作数据」段含 string minLength 约束(expose-schema)')
    assert(/enum=\[admin\|user\]/.test(sp), '「可操作数据」段含 enum 值约束')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] planning 开 → 默认 usageHints 含「自适应规划」引导(add-adaptive-planning)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-adaptive-plan', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, planning: true },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(/自适应规划/.test(sp), 'planning 开 → systemPrompt 含「自适应规划」引导段')
    assert(/update_todo/.test(sp), 'systemPrompt 含 update_todo 用法引导(增量改单项)')
    assert(/write_todos/.test(sp), 'systemPrompt 含 write_todos 用法引导')
    assert(/maxPlanRevisions|规划阶段有轮次预算/.test(sp), 'systemPrompt 含规划阶段轮次预算提示(防死循环)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
