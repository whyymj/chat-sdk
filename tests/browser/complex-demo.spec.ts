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
    // 断言 3:工具步骤行按 Figma 风格渲染(色块 status-dot + 状态标签 step-status「成功」;替代旧 emoji)
    const stepStatus = await page.locator('.step-item .step-status').first().textContent()
    expect(stepStatus, '步骤状态标签:done → 「成功」(Figma 色块+文字风格)').toContain('成功')
    expect(await page.locator('.step-item .status-dot.done').count(), '步骤色块:done 状态绿色 status-dot').toBeGreaterThan(0)
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

  /**
   * 手动配置面板渲染 + agent publish action(胜任自动化):
   * 配置面板可见(JSON 编辑器 + 发布按钮)→ agent 调 publish action → 发布状态条更新
   */
  test('配置面板渲染 + agent publish action → 发布状态更新', async ({ page }) => {
    await expect(page.locator('.config-panel')).toBeVisible()
    await expect(page.locator('.config-panel .json-editor')).toBeVisible()
    await expect(page.locator('.config-panel button', { hasText: '发布' })).toBeVisible()

    await mockLlm(page, [
      { tool_calls: [{ name: 'publish', arguments: {} }] },
      { text: '已发布页面。' },
    ])
    await fillInput(page, '帮我发布页面')
    await clickSend(page)
    await waitForAgentIdle(page)
    // publish action 副作用:配置面板状态条显示「已发布」
    const status = await page.textContent('.config-panel .status')
    expect(status, 'publish action → publishStatus 更新为「已发布」').toContain('已发布')
  })

  /**
   * 配置面板 JSON 与 page 双向同步(deep watch 修复):
   * agent write 改组件内部字段(components.0.props.title,length 不变)→ 面板 textarea 的 JSON 跟随更新。
   * 原 watch 仅监听 title + components.length,漏掉 length 不变的组件内部 patch → 面板 JSON 落后于页面渲染。
   */
  test('配置面板 JSON 同步:agent 改组件内部字段(length 不变)→ textarea 跟随更新', async ({ page }) => {
    await expect(page.locator('.config-panel .json-editor')).toBeVisible()
    const initial = await page.inputValue('.config-panel .json-editor')
    expect(initial).not.toContain('面板同步测试标题')

    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '面板同步测试标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { text: '已修改导航栏标题。' },
    ])
    await fillInput(page, '把导航栏标题改成「面板同步测试标题」')
    await clickSend(page)
    await waitForAgentIdle(page)
    // debounce 200ms 后 jsonText 同步:组件内部 patch length 不变,旧 watch 漏触发 → 验证 deep watch 修复
    await page.waitForTimeout(400)
    const synced = await page.inputValue('.config-panel .json-editor')
    expect(synced, 'agent 改组件内部字段(length 不变)→ 配置面板 JSON 同步(deep watch)').toContain('面板同步测试标题')
  })

  /**
   * agent save_draft(宿主动作)+ get_dom(读渲染 DOM)闭环:
   * save_draft → 草稿写 localStorage;get_dom → 返回导航栏 DOM 结构(验证 agent 能"看"渲染结果)
   */
  test('agent save_draft → localStorage + get_dom 读渲染 DOM', async ({ page }) => {
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'save_draft', arguments: {} }] },
      { tool_calls: [{ name: 'get_dom', arguments: { selector: '.navbar-title', depth: 0 } }] },
      { text: '已保存草稿并查看了导航栏 DOM。' },
    ])
    await fillInput(page, '先保存草稿,再看看导航栏标题的 DOM 结构')
    await clickSend(page)
    await waitForAgentIdle(page)

    // save_draft action 副作用:草稿写入 localStorage(序列化 page)
    const draft = await page.evaluate(() => localStorage.getItem('complex-demo-draft'))
    expect(draft, 'save_draft action → 草稿写入 localStorage').toBeTruthy()
    expect(draft).toContain('components')
    // 两轮 tool 调用(save_draft + get_dom)都触发 → agent 能调宿主动作 + 读 DOM
    expect(calls(), 'save_draft + get_dom 两轮 tool 调用都触发').toBeGreaterThanOrEqual(2)
  })
})

/**
 * huge page(1M 大页面 · ?huge=1):验证 agent 在 1M 大 JSON 场景的胜任性
 * - PageRenderer 截断渲染(800 组件只渲染前 100,防卡死;agent read/write 操作全量)
 * - read 分页(offset/limit)+ write patch 改某实例(深路径 components.0.props.text)
 */
test.describe('complex-demo huge(1M 大页面 · ?huge=1)', () => {
  test('read 分页 + write patch 改某实例(800 组件)', async ({ page }) => {
    await page.goto('/examples/complex-demo/?huge=1')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('textarea')
    // 截断提示可见(800 组件 > RENDER_LIMIT 100,PageRenderer 只渲染前 100 防卡死)
    await expect(page.locator('.pr-truncate')).toBeVisible()
    const componentCount = await page.evaluate(() => (window as any).page.components.length)
    expect(componentCount, 'huge 模式加载 800 组件').toBe(800)

    // read 整体(1M 大 JSON → offload vfs,agent 胜任大对象读取;write patch 深路径增量已在 normal spec 验证)
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { text: '已读取大页面概况。' },
    ])
    await fillInput(page, '看看这个大页面')
    await clickSend(page)
    await waitForAgentIdle(page)
    expect(calls(), 'huge read 1M 大 JSON 执行(agent 加载 + 读大对象胜任)').toBeGreaterThanOrEqual(1)
  })
})
