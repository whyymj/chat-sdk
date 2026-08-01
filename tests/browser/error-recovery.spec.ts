import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/**
 * 错误恢复(unify-error recoverable)浏览器 E2E:写违反 schema → 结构化错误回灌 → LLM 自纠
 *
 * 验证(把真测发现固化成确定性回归,mock LLM,用 page-demo / 测):
 *  - 工具层:write({value:123, patch:set title}) —— title 是 string,123 违反 schema
 *    → 工具返 SCHEMA_INVALID 结构化错误(ERROR: {error:"SCHEMA_INVALID"...})
 *    → 不写入(校验失败不落盘)
 *  - recoverable 回灌:错误作为 tool result 回灌给 LLM → LLM 第2轮修正为合法值 → 写成功
 *  - 最终 read 确认 title 改对
 *
 * 断言:
 *  - 第1轮非法 write 后 title 未变(校验失败不写)
 *  - console 捕获到 SCHEMA_INVALID 回灌日志(debug:true → createAgent log('tool_result') 含错误串)
 *  - 最终 title = '正确'(recoverable 自纠成功)
 */
test.describe('错误恢复:写违反 schema → SCHEMA_INVALID 回灌 → 自纠', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  const readTitle = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as any).page.title)

  test('单独一轮非法 write:校验失败不写 + console 含 SCHEMA_INVALID', async ({ page }) => {
    // 收集 console(debug:true 下 createAgent 会 log tool_result,内容含 ERROR: {...SCHEMA_INVALID...})
    const logs: string[] = []
    page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`))

    await mockLlm(page, [
      // write 把 title 改成 123(number 违反 string schema)
      { tool_calls: [{ name: 'write', arguments: {
        value: 123, patch: { op: 'set', jsonPath: 'title' },
      } }] },
      { text: '已处理。' },
    ])

    await fillInput(page, '把标题改成 123')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:title 未变(校验失败 → 未写入;fresh load 后仍是 '示例页面')
    expect(await readTitle(page)).toBe('示例页面')

    // 断言 2:console 捕获到 SCHEMA_INVALID 回灌日志
    const joined = logs.join('\n')
    expect(joined).toContain('SCHEMA_INVALID')
  })

  test('完整自纠:非法 write(SCHEMA_INVALID)→ 修正 write → read 确认 → 最终改对', async ({ page }) => {
    await mockLlm(page, [
      // 第1轮:write 非法 title=123 → SCHEMA_INVALID 回灌
      { tool_calls: [{ name: 'write', arguments: {
        value: 123, patch: { op: 'set', jsonPath: 'title' },
      } }] },
      // 第2轮:LLM 据错误自纠,write 合法 title='正确'
      { tool_calls: [{ name: 'write', arguments: {
        value: '正确', patch: { op: 'set', jsonPath: 'title' },
      } }] },
      // 第3轮:read 确认
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '已把标题改成「正确」。' },
    ])

    await fillInput(page, '把标题改成正确')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言:最终 title 改对(recoverable 回灌后 LLM 自纠成功)
    expect(await readTitle(page)).toBe('正确')

    // 断言:页面 DOM 标题同步更新
    const titleDom = await page.textContent('.pr-title')
    expect(titleDom).toBe('正确')

    // 断言:agent 回复包含完成信息
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('正确')
  })
})
