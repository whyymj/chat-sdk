import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/**
 * complex-demo 浏览器 E2E(真实复杂度基准:30 类型 + ~70 实例专题页)
 *
 * 覆盖:
 *  - read 全量 / write patch 改组件属性 / read 子路径确认(基础)
 *  - read title / write title(顶层字段)
 *  - read 带 fields 裁剪(字段投影)
 *  - **mission capture**:send 任务型 user → LLM 请求 systemPrompt 含「当前主线目标」pin 段(revive-mission-anchor)
 *  - **深嵌套 patch**:section → grid → coupon 的深层 jsonPath 改(验证 isPathAllowed 逐段校验 + 大 schema 递归)
 */
test.describe('complex-demo: 真实复杂度(30 类型 + 70 实例)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/complex-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('textarea') // 等 ChatDialog input 渲染就绪(异步)
  })

  test('read 全量 → write patch 改 navbar title → read 子路径确认', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { tool_calls: [{ name: 'write', arguments: { value: '测试改标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.0.props.title' } }] },
      { text: '已完成,导航栏标题已改为「测试改标题」。' },
    ])

    await fillInput(page, '把导航栏标题改成「测试改标题」')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:window.page.components[0].props.title(navbar)已更新
    const navbarTitle = await page.evaluate(() => (window as any).page.components[0].props.title)
    expect(navbarTitle).toBe('测试改标题')
    // 断言 2:DOM .navbar-title 文本更新
    const domTitle = await page.textContent('.navbar-title')
    expect(domTitle).toBe('测试改标题')
  })

  test('read 子路径 → write patch 改页面 title → read 确认', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '重构自测标题', patch: { op: 'set', jsonPath: 'title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '标题已改为「重构自测标题」。' },
    ])

    await fillInput(page, '把页面标题改成「重构自测标题」')
    await clickSend(page)
    await waitForAgentIdle(page)

    const pageTitle = await page.evaluate(() => (window as any).page.title)
    expect(pageTitle).toBe('重构自测标题')
  })

  test('read 带 fields 裁剪 → 验证字段投影', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', fields: ['type', 'id'] } }] },
      { text: '已列出组件清单。' },
    ])
    await fillInput(page, '列出组件类型和 id')
    await clickSend(page)
    await waitForAgentIdle(page)
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('组件')
  })

  /**
   * mission capture + 深嵌套 patch(真实复杂度核心):
   * send「把领券中心第一张券面额改成 100 元」(任务型 user,含「改」)→
   * ① mission capture → LLM 请求 systemPrompt 含「## 当前主线目标」pin 段(goal = user 原文)
   * ② write 深嵌套 patch:components.6(领券 section).children.0(grid).children.0(首券).props.amount = 100
   *    验证 isPathAllowed 逐段校验穿过 section(grid)→ coupon(union 选项)→ amount,大 schema 递归 OK
   */
  test('mission capture + 深嵌套 patch:改领券首券面额 → systemPrompt 含主线 pin', async ({ page }) => {
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })

    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: 100, patch: { op: 'set', jsonPath: 'components.6.props.children.0.props.children.0.props.amount' } } }] },
      { text: '已将领券中心第一张优惠券面额改为 100 元。' },
    ])

    await fillInput(page, '把领券中心第一张优惠券面额改成 100 元')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:深嵌套 patch 落地(section → grid → coupon → amount)
    const amount = await page.evaluate(() => (window as any).page.components[6].props.children[0].props.children[0].props.amount)
    expect(amount, '深嵌套 patch:components.6.props.children.0.props.children.0.props.amount = 100').toBe(100)

    // 断言 2:mission capture → LLM 请求 systemPrompt 含「当前主线目标」pin + goal
    const sysText = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'system').map((m: any) => m.content))
      .join('\n')
    expect(sysText, 'mission capture → systemPrompt 含「当前主线目标」pin 段').toContain('当前主线目标')
    expect(sysText, 'mission pin 含 user goal(领券)').toContain('领券')
  })

  /**
   * read 大 JSON 分页:components 数组(~21 顶层)整体 read 返回大,验证 read 正常(可能 offload vfs)
   * + 深路径 read(单个 coupon 子树)
   */
  test('read components 全量(大 JSON)+ read 深路径子树(领券首券)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components' } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.6.props.children.0.props.children.0' } }] },
      { text: '已读取组件清单与领券首券详情。' },
    ])
    await fillInput(page, '看看组件清单和领券第一张券')
    await clickSend(page)
    await waitForAgentIdle(page)
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('组件')
  })
})
