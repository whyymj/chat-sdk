import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clickByText, waitForAgentIdle, clearChat } from './_helpers'

/**
 * rag-demo 浏览器 E2E:memory 异步注入链路(followup P1,D 真测固化)
 *
 * rag-demo 配置(见 examples/rag-demo/App.vue):
 *  - memory 传异步函数(模拟 400ms 网络延迟加载知识库),首次对话前后台求值
 *  - 三个 mock 知识库 faq/product/guide;switchKb() 调 setMemory + refreshMemory 切换
 *  - storage:'memory';未配 skills(故无 load_skill 场景,按任务约定只测 memory 注入)
 *  - 未暴露 window.sdk / window.agent;有 memory preview UI(.kb-preview pre)+ status(.status[data-status])
 *
 * 注:memory 被 LLM 真正「引用」靠真 LLM(D 真测已证)。本 spec 确定性测的是**注入链路**:
 *   memory 异步求值 → augmentPrompt 把 memory 文本拼进 systemPrompt → 首轮 LLM 请求体里出现 memory 内容。
 * 断言依据:harness/memory.ts 的 augmentPrompt 返回「## 持久指令(Memory)\n${state.memory}」,
 *   该段被拼入 system message 随首轮请求发出 → 捕获 LLM 请求体即可确定性校验 memory 已注入。
 */
test.describe('rag-demo: memory 异步注入链路', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/rag-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  /** 等 memory 异步求值完成(status loading → ready,约 400ms) */
  async function waitMemoryReady(page: import('@playwright/test').Page, timeout = 10_000): Promise<void> {
    await page.waitForFunction(() => {
      const el = document.querySelector('.status')
      return !!el && el.getAttribute('data-status') === 'ready'
    }, { timeout })
  }

  /** 等 memory preview(.kb-preview pre)包含指定关键词 */
  async function waitPreviewContains(page: import('@playwright/test').Page, keyword: string, timeout = 10_000): Promise<void> {
    await page.waitForFunction((kw) => {
      const pre = document.querySelector('.kb-preview pre')
      return !!pre && !!pre.textContent && pre.textContent.includes(kw)
    }, keyword, { timeout })
  }

  test('场景1:memory 异步求值 → 注入 systemPrompt(首轮 LLM 请求含 FAQ 内容)+ preview 含知识库', async ({ page }) => {
    // 1. 等 memory 异步求值完成(preview 同步填入 lastLoaded)
    await waitMemoryReady(page)
    await waitPreviewContains(page, '¥99/月')

    // 断言 A(memory preview UI 含 FAQ 知识库内容):证明异步函数求值 → lastLoaded 填充 → 注入链路前置就绪
    const preview = await page.textContent('.kb-preview pre')
    expect(preview).toContain('¥99/月')
    expect(preview).toContain('## 产品 FAQ')

    // 2. 捕获发往 LLM 的请求体:augmentPrompt 注入的 memory 文本会出现在 system message 里。
    //    用 page.on('request')(与 route 正交,顺序无关)而非额外 route(会被 mockLlm 抢先 fulfill)。
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try {
          const body = req.postData()
          if (body) requestBodies.push(JSON.parse(body))
        } catch { /* ignore */ }
      }
    })
    await mockLlm(page, [{ text: '已就绪。' }])

    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 B(核心:memory 真注入了发给 LLM 的 prompt):首轮请求体 messages 整体序列化后含 FAQ 关键词
    expect(requestBodies.length, '应至少发出 1 轮 LLM 请求').toBeGreaterThanOrEqual(1)
    const firstReqJson = JSON.stringify(requestBodies[0].messages || [])
    expect(firstReqJson, 'systemPrompt 应含 memory 注入的 FAQ 价格').toContain('¥99/月')
    expect(firstReqJson, 'systemPrompt 应含 memory 注入的 FAQ 标题').toContain('## 产品 FAQ')
    // 同时确认 demo 自身 systemPrompt(业务身份段)也在
    expect(firstReqJson).toContain('知识库问答助手')
  })

  test('场景2:切换知识库 → setMemory + refreshMemory → 首轮新请求含 product 内容 + preview 更新', async ({ page }) => {
    // 初始 faq 就绪
    await waitMemoryReady(page)
    await waitPreviewContains(page, '¥99/月')

    // 捕获切换后首次 LLM 请求(切换前不发起对话,确保捕获到的是 product memory)
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try {
          const body = req.postData()
          if (body) requestBodies.push(JSON.parse(body))
        } catch { /* ignore */ }
      }
    })
    await mockLlm(page, [{ text: '已切换。' }])

    // 点 product 切换知识库(setMemory 换异步函数 + refreshMemory 强制刷新)
    await clickByText(page, 'product')
    // 等 preview 更新为 product 内容(避免 status 瞬态竞态,直接等文本变化)
    await waitPreviewContains(page, 'PageAgent Pro')

    // 断言 A:preview 已更新为产品规格(不再是 FAQ)
    const preview = await page.textContent('.kb-preview pre')
    expect(preview).toContain('PageAgent Pro')
    expect(preview).toContain('CPU')
    expect(preview).not.toContain('## 产品 FAQ')

    // 发起对话,捕获首次请求验证 product memory 注入 systemPrompt
    await fillInput(page, '产品规格')
    await clickSend(page)
    await waitForAgentIdle(page)

    expect(requestBodies.length, '切换后应至少发出 1 轮 LLM 请求').toBeGreaterThanOrEqual(1)
    const firstReqJson = JSON.stringify(requestBodies[0].messages || [])
    expect(firstReqJson, 'systemPrompt 应含切换后的 product memory').toContain('PageAgent Pro')
    expect(firstReqJson).toContain('产品规格 v2')
    // 旧 faq 内容应已不在(同一段 memory 被替换,而非追加)
    expect(firstReqJson).not.toContain('## 产品 FAQ')
  })
})
