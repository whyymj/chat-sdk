import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clickByText, waitForAgentIdle, clearChat } from './_helpers'

/**
 * nested-demo 浏览器 E2E:嵌套子路径写 + 确认 gating + checkpoint 回滚
 *
 * 验证(把真测发现固化成确定性回归,mock LLM):
 *  - 场景1:深层 jsonPath 写(sections.0.children.0.style.color)+ approval 写前确认 gating
 *    · 允许 → 字段真改(window.Editor.PageInfo 读到新值)
 *    · 拒绝 → 字段不写(保持原值)
 *  - 场景2:checkpoint 整体回滚 —— 两轮 write 后点 ↩ 回退 → 数据回到第一轮值 + 对话消息数减少
 *
 * nested-demo 配置要点(见 examples/nested-demo/App.vue):
 *  - data.bind = window.Editor.PageInfo(递归 schema;z.lazy 自引用任意深度)
 *  - approval: { tools: ['write'] } —— 每次 write 弹「允许/拒绝」确认条
 *  - checkpoint: true —— 每轮自动存档;ChatDialog footer 渲染 ↩ 回退 按钮(canUndo)
 */
test.describe('nested-demo: 嵌套子路径写 + 确认 gating + checkpoint 回滚', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/nested-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  // 主标题 b-title = sections.0.children.0,初始 style.color = '#ffffff'
  const COLOR_PATH = 'sections.0.children.0.style.color'
  const readColor = async (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as any).Editor.PageInfo.sections[0].children[0].style.color)

  test('场景1A:read 子路径 → write patch 改深层 color → 允许 → 字段真改', async ({ page }) => {
    await mockLlm(page, [
      // 1. read 子路径(拿当前 style + hash)
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'sections.0.children.0.style' } }] },
      // 2. write patch set 深层 color(触发 approval 写前确认)
      { tool_calls: [{ name: 'write', arguments: {
        value: '#ff0000',
        patch: { op: 'set', jsonPath: COLOR_PATH },
      } }] },
      // 3. write 完成,LLM 回复
      { text: '已把主标题颜色改成红色。' },
    ])

    await fillInput(page, '把主标题改成红色')
    await clickSend(page)

    // === 写前确认条出现,点「允许」 ===
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })
    await expect(page.locator('.approval-bar')).toBeVisible()
    await clickByText(page, '允许')

    await waitForAgentIdle(page)

    // 断言 1:window.Editor.PageInfo 深层 color 真改了
    const color = await readColor(page)
    expect(color).toBe('#ff0000')

    // 断言 2:agent 回复包含完成信息
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('红色')
  })

  test('场景1B:read 子路径 → write patch 改深层 color → 拒绝 → 字段不写', async ({ page }) => {
    // 先记下初始值(clearChat 不动 data;fresh goto 后为 '#ffffff')
    const before = await readColor(page)
    expect(before).toBe('#ffffff')

    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'sections.0.children.0.style' } }] },
      // write 触发 approval → 用户拒绝 → 工具不执行,返「已拒绝」结果给 LLM
      { tool_calls: [{ name: 'write', arguments: {
        value: '#00ff00',
        patch: { op: 'set', jsonPath: COLOR_PATH },
      } }] },
      { text: '好的,已取消修改。' },
    ])

    await fillInput(page, '把主标题改成绿色')
    await clickSend(page)

    // 写前确认条出现,点「拒绝」
    await page.waitForSelector('button:has-text("拒绝")', { timeout: 15_000 })
    await clickByText(page, '拒绝')

    await waitForAgentIdle(page)

    // 断言:color 保持初始值(拒绝 → 未写入)
    const after = await readColor(page)
    expect(after).toBe('#ffffff')
  })

  test('场景2:两轮 write 改 color → ↩ 回退 → 数据回到第一轮值 + 消息数减少', async ({ page }) => {
    // mock 脚本跨两轮 user 消息(同一个 mockLlm 计数器贯穿):
    //  turn1: read style → write red(确认) → 文本完成
    //  turn2: write blue(确认) → 文本完成
    await mockLlm(page, [
      // ---- turn 1 ----
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'sections.0.children.0.style' } }] },
      { tool_calls: [{ name: 'write', arguments: {
        value: '#ff0000', patch: { op: 'set', jsonPath: COLOR_PATH },
      } }] },
      { text: '主标题已改成红色。' },
      // ---- turn 2 ----
      { tool_calls: [{ name: 'write', arguments: {
        value: '#0000ff', patch: { op: 'set', jsonPath: COLOR_PATH },
      } }] },
      { text: '主标题已改成蓝色。' },
    ])

    // === turn 1:把主标题改成红色 ===
    await fillInput(page, '把主标题改成红色')
    await clickSend(page)
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })
    await clickByText(page, '允许')
    await waitForAgentIdle(page)

    // turn 1 后 color 应为 red
    expect(await readColor(page)).toBe('#ff0000')

    // === turn 2:把主标题改成蓝色 ===
    await fillInput(page, '再把主标题改成蓝色')
    await clickSend(page)
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })
    await clickByText(page, '允许')
    await waitForAgentIdle(page)

    // turn 2 后 color 应为 blue(回退前)
    expect(await readColor(page)).toBe('#0000ff')

    // 回退前的对话消息数
    const msgsBefore = await page.locator('.message-row').count()
    expect(msgsBefore).toBeGreaterThan(0)

    // === 点 ↩ 回退(footer 的 undo-foot-btn) ===
    await page.waitForSelector('button.undo-foot-btn', { timeout: 10_000 })
    await clickByText(page, '回退')

    // 给回滚一点时间(Vue 重渲染)
    await page.waitForTimeout(300)

    // 断言 1:color 回滚到第一轮的值(red),不是 blue 也不是初始 '#ffffff'
    expect(await readColor(page)).toBe('#ff0000')

    // 断言 2:对话消息数减少(checkpoint 整体回滚:撤销 turn 2 的 agent 改动 + 历史)
    const msgsAfter = await page.locator('.message-row').count()
    expect(msgsAfter).toBeLessThan(msgsBefore)
  })
})
