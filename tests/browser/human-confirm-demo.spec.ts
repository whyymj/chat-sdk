import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clickByText, waitForAgentIdle, clearChat } from './_helpers'

/**
 * human-confirm-demo 浏览器 E2E:两层 human-in-the-loop
 *
 * 验证 refactor 后 conflictManager + humanConfirm + approval 中间件正常:
 * - 第一层:LLM 主动征询(request_human_confirmation)→ 选项按钮出现
 * - 用户选方案 → LLM 落地 write → 第二层写前确认(允许/拒绝)
 * - 用户点「允许」→ write 执行 → 页面 appConfig 更新
 */
test.describe('human-confirm-demo: 两层确认', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/human-confirm-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('主动征询 → 选方案 → 写前确认 → 允许 → 页面更新', async ({ page }) => {
    await mockLlm(page, [
      // 第一层:LLM 主动征询,弹选项按钮
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '给你两个方案:',
        options: ['暗夜紫+紧凑+6px', '暖橙+宽松+24px'],
        recommendation: '推荐暗夜紫',
      } }] },
      // 第二层:用户选了方案 A,LLM 落地 write(触发写前确认)
      { tool_calls: [{ name: 'write', arguments: {
        value: { theme: 'night-purple', density: 'compact', radius: 6 },
      } }] },
      // 第三层:write 完成,LLM 回复
      { text: '已完成,界面已切换为暗夜紫风格。' },
    ])

    await fillInput(page, '换个感觉,给几个方案我挑')
    await clickSend(page)

    // === 第一层:等待选项按钮出现 ===
    await page.waitForSelector('button:has-text("暗夜紫")', { timeout: 15_000 })

    // 断言:选项按钮存在
    const optionBtn = page.locator('button', { hasText: '暗夜紫+紧凑+6px' })
    await expect(optionBtn).toBeVisible()

    // 点击方案 A
    await clickByText(page, '暗夜紫+紧凑+6px')

    // === 第二层:等待写前确认出现(允许/拒绝) ===
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })

    // 断言:允许按钮存在
    await expect(page.locator('button', { hasText: '允许' })).toBeVisible()

    // 点击允许
    await clickByText(page, '允许')

    // 等待 agent 完成
    await waitForAgentIdle(page)

    // 断言:window.appConfig 已更新
    const config = await page.evaluate(() => {
      const c = (window as any).appConfig
      return { theme: c.theme, density: c.density, radius: c.radius }
    })
    expect(config.theme).toBe('night-purple')
    expect(config.density).toBe('compact')
    expect(config.radius).toBe(6)

    // 断言:页面 DOM 已更新(theme code 文本)
    const themeCode = await page.textContent('.cfg code:has-text("night-purple")')
    expect(themeCode).toContain('night-purple')
  })

  test('主动征询 → 选方案 → 写前确认 → 拒绝 → write 不执行', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '给你两个方案:',
        options: ['方案A', '方案B'],
      } }] },
      { tool_calls: [{ name: 'write', arguments: {
        value: { theme: 'warm-orange', density: 'spacious', radius: 24 },
      } }] },
      { text: '好的,已取消修改。' },
    ])

    await fillInput(page, '换个风格')
    await clickSend(page)

    // 第一层:选方案 A
    await page.waitForSelector('button:has-text("方案A")', { timeout: 15_000 })
    await clickByText(page, '方案A')

    // 第二层:等写前确认,点拒绝
    await page.waitForSelector('button:has-text("拒绝")', { timeout: 15_000 })
    await clickByText(page, '拒绝')

    await waitForAgentIdle(page)

    // 断言:appConfig 未变(还是初始值)
    const config = await page.evaluate(() => {
      const c = (window as any).appConfig
      return { theme: c.theme, density: c.density, radius: c.radius }
    })
    expect(config.theme).toBe('fresh-blue')
    expect(config.density).toBe('cozy')
    expect(config.radius).toBe(12)
  })
})
