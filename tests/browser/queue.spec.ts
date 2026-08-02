import { test, expect, type Page } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clickByTitle, clearChat } from './_helpers'

/**
 * 排队续跑浏览器 E2E(修 loading 中回车输入丢失 bug):
 * - 生成中(loading)用户回车 → 入排队区(可见,不进 messages)
 * - 生成完自动依次执行排队任务
 * - 排队任务可撤销 / 修改(填回输入框)
 *
 * 用 mockLlm delays 制造"生成中"窗口(第一轮延迟),让用户在 loading 时排队。
 */
test.describe('queue: 生成中排队 + 撤销/修改', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  // 等 agent 进入 loading(send 按钮变 stop-btn class + title「停止生成」;SVG 按钮无文字,用 class 判定)
  const waitLoading = (page: Page) => page.waitForSelector('.chat-dialog .stop-btn', { timeout: 10_000 })

  test('生成中发 B → 排队区可见 → A 完自动执行 B(顺序正确)', async ({ page }) => {
    // 第一轮延迟 2000ms 制造 loading 窗口;A=read+text,B=text(排队后自动执行)
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: 'A 完成回复' },
      { text: 'B 完成回复' },
    ], [2000, 0, 0])

    await fillInput(page, '任务A')
    await clickSend(page)
    await waitLoading(page)

    // loading 中回车发 B → 入排队区(不进 messages,可见)
    await fillInput(page, '任务B')
    await page.keyboard.press('Enter')

    await expect(page.locator('.queued-bar')).toBeVisible()
    await expect(page.locator('.queued-text')).toHaveText('任务B')
    await expect(page.locator('.queued-count')).toHaveText('1')

    // 等 B 续跑(A 的 read+text 共 2 calls;B 续跑触发第 3 个 call)+ B 回复出现
    await expect.poll(() => calls(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3)
    await expect.poll(async () => (await page.textContent('.chat-dialog')) || '', { timeout: 30_000 }).toContain('B 完成回复')
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('A 完成回复')
    expect(dialogText).toContain('B 完成回复')
  })

  test('排队任务可撤销 → 不执行被撤任务', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { text: 'A 完成回复' },
      { text: '被撤不该出现' }, // B 若执行会出(撤销了不该)
    ], [2000, 0, 0])

    await fillInput(page, '任务A')
    await clickSend(page)
    await waitLoading(page)

    await fillInput(page, '任务B')
    await page.keyboard.press('Enter')
    await expect(page.locator('.queued-text')).toHaveText('任务B')

    // 撤销 B
    await clickByTitle(page, '撤销该任务')
    await expect(page.locator('.queued-bar')).toHaveCount(0)

    // 等 A 完成(无续跑,B 已撤)
    await page.waitForFunction(
      () => (document.querySelector('.chat-dialog')!.textContent || '').includes('A 完成回复'),
      null,
      { timeout: 30_000 },
    )

    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('A 完成回复')
    expect(dialogText).not.toContain('被撤不该出现')
    expect(dialogText).not.toContain('任务B') // B 从未进 messages(排队撤销)
  })

  test('排队任务可修改 → 填回输入框 + 移出队列', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { text: 'A 完成回复' },
    ], [2000, 0])

    await fillInput(page, '任务A')
    await clickSend(page)
    await waitLoading(page)

    await fillInput(page, '任务B原始')
    await page.keyboard.press('Enter')
    await expect(page.locator('.queued-text')).toHaveText('任务B原始')

    // 修改(填回输入框 + 移出队列)
    await clickByTitle(page, '修改(填回输入框编辑)')
    await expect(page.locator('.queued-bar')).toHaveCount(0)
    const inputVal = await page.inputValue('.chat-dialog textarea')
    expect(inputVal).toBe('任务B原始')
  })
})
