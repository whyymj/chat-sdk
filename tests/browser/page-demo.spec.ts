import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/**
 * page-demo 浏览器 E2E:read → write → read 确认流程
 *
 * 验证 refactor 后 data 读写工具链正常工作:
 * - read 工具能读到 window.page.title
 * - write 工具能改 window.page.title(经 schema 校验)
 * - 页面 DOM 实时更新(h1.pr-title 文本变化)
 */
test.describe('page-demo: read → write → read', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('read 当前 title → write 改成「测试改写」→ read 确认', async ({ page }) => {
    // mock LLM 脚本:read(title) → write(patch title) → read(title) → 文本完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '测试改写', patch: { op: 'set', jsonPath: 'title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '已完成,标题已改为「测试改写」。' },
    ])

    // 发送用户消息
    await fillInput(page, '把标题改成「测试改写」')
    await clickSend(page)

    // 等待 agent 处理完毕
    await waitForAgentIdle(page)

    // 断言 1:页面标题 DOM 已更新
    const title = await page.textContent('.pr-title')
    expect(title).toBe('测试改写')

    // 断言 2:window.page.title 已更新
    const pageTitle = await page.evaluate(() => (window as any).page.title)
    expect(pageTitle).toBe('测试改写')

    // 断言 3:agent 回复包含完成信息
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('测试改写')
  })

  test('read 整个数据 → write 改 theme → read 确认', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { tool_calls: [{ name: 'write', arguments: { value: 'dark', patch: { op: 'set', jsonPath: 'theme' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'theme' } }] },
      { text: '主题已切换为 dark。' },
    ])

    await fillInput(page, '主题改成 dark')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言:页面 data-theme 属性已更新
    const dataTheme = await page.getAttribute('.pr', 'data-theme')
    expect(dataTheme).toBe('dark')

    const pageTheme = await page.evaluate(() => (window as any).page.theme)
    expect(pageTheme).toBe('dark')
  })
})
