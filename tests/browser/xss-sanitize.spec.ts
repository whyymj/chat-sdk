import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat, clearStorage } from './_helpers'

/**
 * xss-sanitize 浏览器 E2E(P0-2):AI 回复经 v-html 渲染前必须经 DOMPurify sanitize,
 * 剥事件属性(onerror/onload)与危险协议(javascript:),防宿主 origin 执行脚本。
 * selftest sec-51 已覆盖 escapeHtmlAttr 纯函数;此 spec 覆盖真 DOM 渲染管线(sanitize 真接入)。
 */
test.describe('xss-sanitize: Markdown sanitize 真行为(P0-2)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('AI 回复含 <img onerror> → sanitize 剥 onerror,脚本不执行', async ({ page }) => {
    await mockLlm(page, [
      { text: '看图:<img src=x onerror="window.__xss=true"> 完成' },
    ])
    await fillInput(page, '回复点啥')
    await clickSend(page)
    await waitForAgentIdle(page)
    // img 渲染了(markdown inline HTML),但 onerror 被 DOMPurify 剥
    await page.waitForFunction(() => document.querySelector('.chat-dialog .message-md img') !== null, { timeout: 5000 })
    const onerror = await page.evaluate(() => document.querySelector('.chat-dialog .message-md img')?.getAttribute('onerror'))
    expect(onerror).toBeNull()
    // onerror 未执行(window.__xss 未设 = 脚本未跑)
    const xss = await page.evaluate(() => (window as any).__xss)
    expect(xss).toBeFalsy()
  })

  test('AI 回复含 <a href="javascript:..."> → sanitize 拦危险协议', async ({ page }) => {
    await mockLlm(page, [
      { text: '链接:<a href="javascript:window.__xss2=true">点我</a>' },
    ])
    await fillInput(page, '回复')
    await clickSend(page)
    await waitForAgentIdle(page)
    await page.waitForFunction(() => document.querySelector('.chat-dialog .message-md a') !== null, { timeout: 5000 })
    const href = await page.evaluate(() => document.querySelector('.chat-dialog .message-md a')?.getAttribute('href'))
    // javascript: 协议被 DOMPurify 拦(href 整个移除 → null,或改写;总之不含 javascript:)
    expect(href ?? '').not.toContain('javascript:')
    const xss2 = await page.evaluate(() => (window as any).__xss2)
    expect(xss2).toBeFalsy()
  })
})
