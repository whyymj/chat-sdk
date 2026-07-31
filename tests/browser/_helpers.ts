/**
 * 浏览器 E2E 测试共享:mock LLM(网络拦截 SSE)+ DOM 交互工具
 *
 * 原理:page.route() 拦截 LLM API 端点,按脚本返回 OpenAI 兼容 SSE 流,
 * 使 agent ReAct 循环确定性走完(read → write → read → done),不依赖真 LLM。
 */
import type { Page, Route } from '@playwright/test'

// ===== 类型:脚本化的 LLM 响应 =====

export interface ToolCallResponse {
  tool_calls: { name: string; arguments: Record<string, unknown> }[]
}

export interface TextResponse {
  text: string
}

export type MockResponse = ToolCallResponse | TextResponse

/**
 * 拦截 LLM API 端点,按 script 顺序返回 mock 响应。
 * 超出 script 长度后返回空文本 stop(防止死循环)。
 *
 * @param page Playwright Page
 * @param script LLM 响应脚本(按 ReAct 轮次顺序)
 * @returns callCount 跟踪器(用于断言调用了几轮)
 */
export async function mockLlm(page: Page, script: MockResponse[]): Promise<{ calls: () => number }> {
  let calls = 0
  await page.route('**/chat/completions**', (route: Route) => {
    const idx = calls++
    const resp = script[idx] ?? { text: '完成' }
    const sse = toSse(resp, idx)
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache', 'connection': 'keep-alive' },
      body: sse,
    })
  })
  return { calls: () => calls }
}

/**
 * 把一个 mock 响应转成 OpenAI 兼容 SSE 流(3-4 个 chunk + [DONE])。
 */
function toSse(resp: MockResponse, idx: number): string {
  const id = `chatcmpl-mock-${idx}`
  const created = 1
  const model = 'mock'
  const chunks: string[] = []

  if ('tool_calls' in resp) {
    // 第一个 chunk:声明 tool_calls 骨架(name + 空 arguments)
    for (let i = 0; i < resp.tool_calls.length; i++) {
      const tc = resp.tool_calls[i]
      chunks.push(sseChunk(id, created, model, {
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [{ index: i, id: `call_${idx}_${i}`, type: 'function', function: { name: tc.name, arguments: '' } }],
        },
        finish_reason: null,
      }))
    }
    // 后续 chunk:填充 arguments(JSON 字符串分片)
    for (let i = 0; i < resp.tool_calls.length; i++) {
      const tc = resp.tool_calls[i]
      const argsStr = JSON.stringify(tc.arguments)
      chunks.push(sseChunk(id, created, model, {
        delta: { tool_calls: [{ index: i, function: { arguments: argsStr } }] },
        finish_reason: null,
      }))
    }
    // 结束 chunk
    chunks.push(sseChunk(id, created, model, { delta: {}, finish_reason: 'tool_calls' }))
  } else {
    // 文本响应:content 分片
    const text = resp.text
    const mid = Math.ceil(text.length / 2)
    if (mid > 0) {
      chunks.push(sseChunk(id, created, model, {
        delta: { role: 'assistant', content: text.slice(0, mid) },
        finish_reason: null,
      }))
      if (text.length > mid) {
        chunks.push(sseChunk(id, created, model, {
          delta: { content: text.slice(mid) },
          finish_reason: null,
        }))
      }
    }
    chunks.push(sseChunk(id, created, model, { delta: {}, finish_reason: 'stop' }))
  }

  chunks.push('data: [DONE]')
  return chunks.join('\n\n') + '\n\n'
}

function sseChunk(id: string, created: number, model: string, choice: Record<string, unknown>): string {
  return 'data: ' + JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, ...choice }],
  })
}

// ===== DOM 交互工具(绕过 ref 失效问题,用选择器定位) =====

/** 填充 textarea 并触发 Vue 响应式(用原生 setter + input 事件) */
export async function fillInput(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement
    if (!ta) throw new Error('textarea not found')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta, t)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

/** 点击发送按钮(在输入区域内找最后一个可点击按钮) */
export async function clickSend(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dialog = document.querySelector('.chat-dialog')
    if (!dialog) throw new Error('.chat-dialog not found')
    const inputArea = dialog.querySelector('.chat-input-area, .input-area, .chat-footer')
    const btns = inputArea ? Array.from(inputArea.querySelectorAll('button')) : Array.from(dialog.querySelectorAll('button'))
    const enabled = btns.filter((b) => !b.disabled)
    if (!enabled.length) throw new Error('no enabled button in input area')
    enabled[enabled.length - 1].click()
  })
}

/** 点击 title 属性匹配的按钮(用于图标按钮) */
export async function clickByTitle(page: Page, title: string): Promise<void> {
  await page.evaluate((t) => {
    const btn = document.querySelector(`button[title="${t}"]`) as HTMLButtonElement
    if (!btn) throw new Error(`button[title="${t}"] not found`)
    btn.click()
  }, title)
}

/** 点击文本内容匹配的按钮 */
export async function clickByText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const btns = Array.from(document.querySelectorAll('button'))
    const btn = btns.find((b) => (b.textContent || '').includes(t) && !b.disabled)
    if (!btn) throw new Error(`button containing "${t}" not found or disabled`)
    btn.click()
  }, text)
}

/** 等待 agent 处理完成:先等「停止生成」出现(开始处理),再等它消失(完成) */
export async function waitForAgentIdle(page: Page, timeout = 30_000): Promise<void> {
  // 阶段 1:等 agent 开始处理(停止生成按钮出现)
  await page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('.chat-dialog button'))
    return btns.some((b) => (b.textContent || '').includes('停止'))
  }, { timeout: 10_000 }).catch(() => {})

  // 阶段 2:等 agent 处理完毕(停止生成按钮消失)
  await page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('.chat-dialog button'))
    const stopBtn = btns.some((b) => (b.textContent || '').includes('停止'))
    return !stopBtn
  }, { timeout })
}

/** 清空对话(避免上一轮残留) */
export async function clearChat(page: Page): Promise<void> {
  await clickByTitle(page, '清空对话').catch(() => {})
  // 点确认弹窗(如果有)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const confirm = btns.find((b) => (b.textContent || '').trim() === '确认' && !b.disabled)
    if (confirm) confirm.click()
  }).catch(() => {})
  await page.waitForTimeout(200)
}
