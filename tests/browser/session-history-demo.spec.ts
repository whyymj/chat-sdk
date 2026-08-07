import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/**
 * session-history-demo 浏览器 E2E:会话历史管理端到端
 *
 * 验证 session-history-management 的对外 API 在浏览器真实 DOM 下工作:
 *  - 新建会话(switchSession)→ 历史列表 +1 + 新会话为当前(active)
 *  - 多会话切换(switchSession(id))→ 点历史项,当前会话切换(高亮迁移)
 *  - 删除历史(deleteSession)→ 列表 -1;当前会话不可删(无 ✕ 按钮)
 * 纯会话管理 UI + storage,不依赖 LLM 工具调用(mockLlm 保险防 mount 意外调用)。
 * 用 expect.poll 等异步(switchSession/listSessions/deleteSession 经 P1-2 串行化排队)。
 */
test.describe('session-history-demo: 新建/列表/切换/删除', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/session-history-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('[data-test="toggle-history"]')
    await page.click('[data-test="toggle-history"]')   // 展开右侧弹出历史层(Figma 布局:历史项在弹出层,非常驻)
    await page.waitForSelector('.hist-item')
    await mockLlm(page, [{ text: 'ok' }])  // 保险:不发消息,但防 mount 意外触发 LLM
  })

  test('新建会话 → 历史列表 +1 + 新会话为当前(active 仅一个)', async ({ page }) => {
    const before = await page.locator('.hist-item').count()
    await page.click('[data-test="new-chat"]')
    // switchSession + refreshSessions 异步(经 P1-2 串行化),用 poll 等响应式 sessions 更新
    await expect.poll(async () => page.locator('.hist-item').count(), { timeout: 5000 }).toBe(before + 1)
    // 新会话是当前 → active 仅一个(sdk.sessions 响应式刷新触发重渲染,读最新 sdk.sessionId)
    await expect.poll(async () => page.locator('.hist-item.active').count(), { timeout: 3000 }).toBe(1)
  })

  test('多会话切换:点历史项 → 该项变 active(当前会话切换)', async ({ page }) => {
    const before = await page.locator('.hist-item').count()
    // 新建 2 个会话
    await page.click('[data-test="new-chat"]')
    await expect.poll(async () => page.locator('.hist-item').count(), { timeout: 5000 }).toBe(before + 1)
    await page.click('[data-test="new-chat"]')
    await expect.poll(async () => page.locator('.hist-item').count(), { timeout: 5000 }).toBe(before + 2)
    // 当前是最新新建(active 仅一个)
    await expect.poll(async () => page.locator('.hist-item.active').count(), { timeout: 3000 }).toBe(1)
    // 找一个非当前项点开切换(倒序下最后一项是最旧,非当前;用 data-sid 定位,不依赖切换后排序位置变化)
    const target = page.locator('.hist-item').last()
    const targetSid = await target.getAttribute('data-sid')
    const currentSid = await page.locator('.hist-item.active').getAttribute('data-sid')
    expect(targetSid, '目标项确为非当前会话').not.toBe(currentSid)
    await target.click()
    // 该 sid 项变 active
    await expect.poll(async () => page.locator(`.hist-item[data-sid="${targetSid}"].active`).count(), { timeout: 5000 }).toBe(1)
    // 当前会话高亮仅一个
    await expect.poll(async () => page.locator('.hist-item.active').count(), { timeout: 3000 }).toBe(1)
  })

  test('删除历史(非当前)→ 列表 -1;当前会话无 ✕ 按钮(不可删)', async ({ page }) => {
    const before = await page.locator('.hist-item').count()
    await page.click('[data-test="new-chat"]')
    await expect.poll(async () => page.locator('.hist-item').count(), { timeout: 5000 }).toBe(before + 1)
    await page.click('[data-test="new-chat"]')
    await expect.poll(async () => page.locator('.hist-item').count(), { timeout: 5000 }).toBe(before + 2)
    // 当前(active)项无 del-btn(不可删当前会话)
    expect(await page.locator('.hist-item.active [data-test="del-btn"]').count()).toBe(0)
    // 删第一个非当前项
    const delBefore = await page.locator('.hist-item').count()
    await page.locator('.hist-item [data-test="del-btn"]').first().click()
    await expect.poll(async () => page.locator('.hist-item').count(), { timeout: 5000 }).toBe(delBefore - 1)
  })

  test('清空对话 → UI 消息清空 + 无 ReferenceError(P0-4 resetSession 收编 onClear)', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 生成回复后:有 message-md
    await page.waitForFunction(() => document.querySelectorAll('.chat-dialog .message-md').length > 0, { timeout: 5000 })
    expect(await page.locator('.chat-dialog .message-md').count()).toBeGreaterThan(0)
    // 清空对话(更多 → 清空)→ onClear → core.resetSession(P0-4 修复前此处抛 ReferenceError)
    await clearChat(page)
    await page.waitForTimeout(300)
    // UI 消息清空
    await expect.poll(async () => page.locator('.chat-dialog .message-md').count(), { timeout: 3000 }).toBe(0)
    // 无 P0-4 的 ReferenceError(lastTitle 越界)
    expect(consoleErrors.some((e) => /ReferenceError|lastTitle/i.test(e))).toBe(false)
  })
})
