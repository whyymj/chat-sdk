// 导出项:完整导出(39+ 函数/组件) + 工具函数可用(isQuotaError/estimateTokens/jpEval/searchJson) + source=builtin
import { setupEnv, createAssert, createChatSdk, FAKE_LLM } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:exports] 导出项可用:presets / systemPromptHelpers / defineTool / defineSkill / createMemoryBackend')
  {
    const mod = await import('../../dist/page-agent-sdk.js')
    assert(typeof mod.presets === 'object' && mod.presets !== null, 'presets 导出为对象')
    assert(['pageBuilder', 'researcher', 'minimal'].every((k) => k in mod.presets), 'presets 含 pageBuilder/researcher/minimal')
    assert(typeof mod.systemPromptHelpers?.reliableWriteRules === 'string' && mod.systemPromptHelpers.reliableWriteRules.length > 0, 'systemPromptHelpers.reliableWriteRules 为非空字符串')
    assert(typeof mod.defineTool === 'function', 'defineTool 导出为 function')
    assert(typeof mod.defineSkill === 'function', 'defineSkill 导出为 function')
    assert(typeof mod.createMemoryBackend === 'function', 'createMemoryBackend 导出为 function')
  }

  console.log('[e2e:exports] 导出项完整:中间件工厂 / 工具函数 / 存储后端 / 上下文预设')
  {
    const mod = await import('../../dist/page-agent-sdk.js')
    const expectFns = [
      'createAgent', 'createSubagentMiddleware', 'createSubagentsMiddleware',
      'createVerifyMiddleware', 'createWriteBackCheck',
      'createApprovalMiddleware', 'createHumanConfirmTool', 'createHumanConfirmMiddleware',
      'createCheckpointManager', 'createCheckpointMiddleware',
      'createUsageHintsMiddleware', 'createVfs',
      'createSessionStore', 'createMemoryBackend', 'createWebStorageBackend', 'isQuotaError',
      'createWindowOps', 'fetchDocTools', 'fetchTools', 'defineWindowToolset', 'selectBuiltinTools',
      'connectMcp', 'extractText',
      'resolveContextOptions', 'resolveModelCaps', 'estimateTokens', 'offloadThresholdChars', 'offloadPassThroughChars',
      'jpEval', 'searchJson', 'runSandboxedScript',
      'toolError', 'zodError', 'jsonParseError', 'formatZodIssues',
      'ChatDialog', 'MessageContent', 'CodePreview', 'useChat',
    ]
    let allOk = true
    for (const fn of expectFns) {
      if (typeof mod[fn] === 'undefined') { allOk = false; console.error('  ✗ 缺导出:', fn) }
    }
    assert(allOk, `导出项齐全(${expectFns.length} 个函数/组件均导出)`)
    assert('CONTEXT_PRESETS' in mod && typeof mod.CONTEXT_PRESETS === 'object', 'CONTEXT_PRESETS 导出为对象')
  }

  console.log('[e2e:exports] 工具函数可用:isQuotaError / estimateTokens / jpEval / searchJson')
  {
    const mod = await import('../../dist/page-agent-sdk.js')
    const quotaErr = new Error('quota exceeded')
    quotaErr.name = 'QuotaExceededError'
    assert(mod.isQuotaError(quotaErr) === true, 'isQuotaError 对 QuotaExceededError 返回 true')
    assert(mod.isQuotaError(new Error('other')) === false, 'isQuotaError 对普通 error 返回 false')
    assert(typeof mod.estimateTokens('hello world') === 'number' && mod.estimateTokens('hello world') > 0, 'estimateTokens 对字符串返回正数')
    assert(typeof mod.offloadThresholdChars === 'function' && typeof mod.offloadThresholdChars(8192) === 'number', 'offloadThresholdChars 为函数,调用返回 number')
    assert(typeof mod.offloadPassThroughChars === 'function' && typeof mod.offloadPassThroughChars(8192) === 'number', 'offloadPassThroughChars 为函数,调用返回 number')
    try {
      const r = mod.jpEval({ a: { b: 42 } }, '$.a.b')
      assert(Array.isArray(r) && r.length > 0, 'jpEval(root, expr) 返回非空数组')
    } catch (e) { assert(false, 'jpEval 执行失败:' + e.message) }
    try {
      const hits = mod.searchJson({ a: { b: 'hello' } }, 'hello')
      assert(Array.isArray(hits) && hits.length > 0, 'searchJson 命中字符串返回非空数组')
    } catch (e) { assert(false, 'searchJson 执行失败:' + e.message) }
  }

  console.log('[e2e:exports] windowOps 工具 source=builtin / fetch_document source=builtin')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-source', storage: 'memory', llm: FAKE_LLM,
      capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
    })
    await sdk.mount()
    const setTool = sdk.inspect().tools.find((t) => t.name === 'set_window_prop')
    assert(setTool?.source === 'builtin', 'set_window_prop source=builtin')
    const fetchTool = sdk.inspect().tools.find((t) => t.name === 'fetch_document')
    assert(fetchTool?.source === 'builtin', 'fetch_document source=builtin')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
