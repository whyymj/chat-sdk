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

  /**
   * offset/limit 翻页(followup P1):
   * 真测发现 LLM 主动带 limit(usageHint 生效),但 demo 默认 5 个组件 < 默认 limit 50,
   * offset += limit 的翻页链路从未被压测。这里 page.evaluate 把 window.page.components
   * 填到 60 个(> 50 强制触发分页),形状符合 pageSchema(button union),驱动两轮 read 翻页。
   *
   * 断言依据:read 工具对数组目标返回串含「数组分页[offset=X,limit=Y]... (total=N, hasMore=...)」
   * (dataOps.ts:581);该结果作为 ToolMessage content 回灌,出现在下一轮 LLM 请求体的 role:tool 消息里。
   * 故捕获 LLM 请求体即可确定性断言 offset 推进 + hasMore 翻转(不依赖 console 序列化)。
   */
  test('read components offset/limit 翻页:60 元素 → hasMore true→false + offset 0→50 推进', async ({ page }) => {
    // 把 window.page.components 填到 60 个(> 默认 limit 50 触发翻页);形状符合 pageSchema 的 button union
    await page.evaluate(() => {
      const pageObj = (window as any).page
      const arr = []
      for (let i = 0; i < 60; i++) {
        arr.push({ type: 'button', label: '按钮' + i, variant: i % 2 === 0 ? 'primary' : 'secondary' })
      }
      pageObj.components = arr
    })
    // 顺便校验写入成功 + 绑定生效(SDK bind 即 window.page 同一引用)
    const lenBefore = await page.evaluate(() => (window as any).page.components.length)
    expect(lenBefore).toBe(60)

    // 捕获发往 LLM 的请求体:tool 结果在下一轮请求里以 role:tool 消息回灌(ground truth)。
    // 用 page.on('request') 而非额外 page.route —— route 处理顺序会被 mockLlm 抢先 fulfill,
    // 而 request 事件对每个请求都触发(与 route 正交),postData() 在 fulfill 前就可读。
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try {
          const body = req.postData()
          if (body) requestBodies.push(JSON.parse(body))
        } catch { /* ignore */ }
      }
    })

    // mock LLM 脚本(2 轮 read 翻页 + 文本完成):
    //  轮1: read(components, offset=0,  limit=50) → 前 50 个 + hasMore=true
    //  轮2: read(components, offset=50, limit=50) → 后 10 个 + hasMore=false
    //  轮3: 文本完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', offset: 0, limit: 50 } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', offset: 50, limit: 50 } }] },
      { text: '已分两页读完 60 个组件。' },
    ])

    await fillInput(page, '分页读取所有组件')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 至少 3 轮 LLM 请求:轮1(user) / 轮2(含 read#1 结果) / 轮3(含 read#1+#2 结果)
    expect(requestBodies.length, '应至少 3 轮 LLM 请求(read×2 + 文本)').toBeGreaterThanOrEqual(3)

    // 提取单个请求体里所有 role:tool 消息的 content(即工具返回串)
    const toolContents = (body: any): string =>
      ((body?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content).join('\n'))

    // 断言 1:轮2 请求含 read#1 结果(offset=0,total=60,hasMore=true)
    const round2 = toolContents(requestBodies[1])
    expect(round2, '轮2 应含第 1 页 read 结果').toContain('offset=0,limit=50')
    expect(round2).toContain('total=60')
    expect(round2).toContain('hasMore=true')

    // 断言 2:轮3 请求含 read#2 结果(offset=50,hasMore=false,已到末页)
    const round3 = toolContents(requestBodies[2])
    expect(round3, '轮3 应含第 2 页 read 结果').toContain('offset=50,limit=50')
    expect(round3).toContain('hasMore=false')

    // 断言 3:两轮 read 都读到的是同一个 60 元素数组(分页不丢元素)
    expect(round2).toContain('total=60')
    expect(round3).toContain('total=60')

    // 断言 4:翻页只读不改,components 数组仍为 60 个
    const lenAfter = await page.evaluate(() => (window as any).page.components.length)
    expect(lenAfter).toBe(60)
  })
})
