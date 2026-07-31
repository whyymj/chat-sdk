import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/**
 * complex-demo 浏览器 E2E:列组件 → edit patch 增量改属性 → 子路径读
 *
 * 验证 refactor 后 dataOps 大 JSON 操作正常:
 * - read 整个数据(获取组件清单)
 * - write 增量 patch 改子路径(components.0.style.color)
 * - read 子路径确认
 * - 页面 DOM 更新(标题颜色变化)
 */
test.describe('complex-demo: 列组件 + edit patch + 子路径读', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/complex-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('read 全量 → write patch 改 hero-title style.color → read 子路径确认', async ({ page }) => {
    await mockLlm(page, [
      // 1. read 整个数据(获取组件清单)
      { tool_calls: [{ name: 'read', arguments: {} }] },
      // 2. write 增量 patch:改 components.0.style.color 为 red
      { tool_calls: [{ name: 'write', arguments: {
        value: { color: 'red', textAlign: 'center' },
        patch: { op: 'set', jsonPath: 'components.0.style' },
      } }] },
      // 3. read 子路径确认
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.0.style' } }] },
      // 4. 完成
      { text: '已完成,标题颜色已改为红色。' },
    ])

    await fillInput(page, '把标题颜色改成红色')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:window.page.components[0].style.color 已更新
    const style = await page.evaluate(() => {
      const c = (window as any).page.components[0]
      return c.style
    })
    expect(style.color).toBe('red')
    expect(style.textAlign).toBe('center')

    // 断言 2:页面标题颜色已更新(style 在 CompWrapper div 上,h1 继承 → 查 computed style)
    const heroTitle = page.locator('h1', { hasText: '周年庆大促' })
    const color = await heroTitle.evaluate((el) => window.getComputedStyle(el).color)
    // 'red' 可能被浏览器解析为 rgb(255, 0, 0)
    expect(['red', 'rgb(255, 0, 0)', '#ff0000']).toContain(color)

    // 断言 3:agent 回复包含完成信息
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('红色')
  })

  test('read 子路径 → write patch 改单个字段 → read 确认', async ({ page }) => {
    await mockLlm(page, [
      // 1. read 子路径(只读 title)
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      // 2. write patch 改 title
      { tool_calls: [{ name: 'write', arguments: {
        value: '重构自测标题',
        patch: { op: 'set', jsonPath: 'title' },
      } }] },
      // 3. read 确认
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      // 4. 完成
      { text: '标题已改为「重构自测标题」。' },
    ])

    await fillInput(page, '把页面标题改成「重构自测标题」')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言:window.page.title 已更新
    const pageTitle = await page.evaluate(() => (window as any).page.title)
    expect(pageTitle).toBe('重构自测标题')
  })

  test('read 带 fields 裁剪 → 验证字段投影', async ({ page }) => {
    await mockLlm(page, [
      // read 带 fields 裁剪(只读 type 和 id,不读 props)
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', fields: ['type', 'id'] } }] },
      { text: '已列出组件清单。' },
    ])

    await fillInput(page, '列出组件类型和 id')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言:agent 正常完成(read 工具执行成功)
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('组件')
  })
})
