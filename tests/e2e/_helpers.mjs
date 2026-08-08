// e2e 共享:环境 stub / 断言工厂 / 常用配置
import { createChatSdk, z, defineTool, defineSkill, presets, systemPromptHelpers, createMemoryBackend } from '../../dist/page-agent-sdk.js'

export { createChatSdk, z, defineTool, defineSkill, presets, systemPromptHelpers, createMemoryBackend }

// contextWindow:200000 声明(harden-context-resilience ≥200K 硬约束;声明优先于查表,model:'fake' 不命中表原本 32K 会被拦)
export const FAKE_LLM = { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'fake', contextWindow: 200000 }
export const MIN_CAPS = { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false }

// node 环境构造 window/document stub(mount 的 pagehide/visibility guard 需 addEventListener;data 单对象不再依赖 window,但保留无害)
export function setupEnv() {
  if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, app: {} }
  if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }
}

// stub sessionStorage / localStorage(给 storage 后端测试用)
export function makeStore() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size },
  }
}

// 断言工厂:返回 {assert, pass, fail};pass/fail 用 getter 取最终值
export function createAssert() {
  let pass = 0, fail = 0
  const assert = (cond, msg) => {
    if (cond) { pass++; console.log('  ✓', msg) }
    else { fail++; console.error('  ✗', msg) }
  }
  return { assert, get pass() { return pass }, get fail() { return fail } }
}
