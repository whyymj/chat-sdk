---
name: browser-e2e-testing
description: 用 Playwright + mock LLM 跑浏览器 E2E 测试,验证 page-agent-sdk 各 demo 的运行时行为(read/write/确认/冲突/页面更新)。改 dataOps/ChatDialog/确认流程后主动使用。
---

# 浏览器 E2E 测试(page-agent-sdk)

## 何时用本 skill

- 改了 `dataOps.ts`(read/write/edit 工具行为、拦截器、乐观锁)
- 改了 `ChatDialog.vue`(确认 UI、冲突条、输入框、思考过程展示)
- 改了 `humanConfirm.ts` / `conflictManager.ts`(确认/冲突中间件)
- 改了 demo 的 schema 或 data 绑定
- refactor 后验证「运行时行为零变化」
- **发布前必跑**(见 CLAUDE.md「发布前必跑顺序」)

## 测试架构

```
tests/browser/
├── _helpers.ts              # mock LLM SSE + DOM 交互工具
├── page-demo.spec.ts        # read→write→read 流程
├── human-confirm-demo.spec.ts  # 两层确认(主动征询 + 写前确认)
└── complex-demo.spec.ts     # 列组件 + edit patch + 子路径读
```

### 核心:mock LLM(确定性,不依赖真 API)

`_helpers.ts` 的 `mockLlm(page, script)` 用 `page.route()` 拦截 `**/chat/completions**`,按脚本返回 OpenAI 兼容 SSE 流:

```ts
await mockLlm(page, [
  { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
  { tool_calls: [{ name: 'write', arguments: { value: '新标题', patch: { op: 'set', jsonPath: 'title' } } }] },
  { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
  { text: '完成' },
])
```

SDK 在浏览器里执行 ReAct 循环(真跑 read/write 工具),mock 只提供 LLM 响应。**不需要 API key,可进 CI**。

### DOM 交互工具(绕 ref 失效)

Vue 响应式更新后 Playwright ref 易失效,`_helpers.ts` 用 CDP `page.evaluate()` + CSS 选择器替代:

- `fillInput(page, text)` — 填 textarea(原生 setter 触发 Vue 响应式)
- `clickSend(page)` — 点发送按钮(输入区域最后一个可点击按钮)
- `clickByText(page, text)` — 按文本点按钮(选项按钮/允许/拒绝)
- `clickByTitle(page, title)` — 按 title 属性点按钮(图标按钮)
- `waitForAgentIdle(page)` — 先等「停止生成」出现,再等它消失
- `clearChat(page)` — 清空对话(避免持久化残留)

## 运行

```bash
# 全部(自动启 dev server,复用已跑的)
npm run test:browser

# 单个 demo
npx playwright test tests/browser/page-demo.spec.ts

# 带 UI(调试用,可视化操作)
npm run test:browser:ui

# 生成 HTML 报告
npx playwright test --reporter=html
```

**前置**:首次需 `npx playwright install chromium`(浏览器二进制)。`playwright.config.ts` 已内置 `PLAYWRIGHT_BROWSERS_PATH`,无需手动设 env。

## 写新测试

### 1. 新建 spec 文件

```ts
import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

test.describe('your-demo: 场景描述', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/your-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('用例名', async ({ page }) => {
    await mockLlm(page, [
      // 按 ReAct 轮次排 LLM 响应
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { tool_calls: [{ name: 'write', arguments: { value: 'xxx' } }] },
      { text: '完成' },
    ])

    await fillInput(page, '用户指令')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 window 数据
    const data = await page.evaluate(() => (window as any).yourData)
    expect(data.field).toBe('xxx')

    // 断言 DOM
    const text = await page.textContent('.selector')
    expect(text).toContain('xxx')
  })
})
```

### 2. 工具名速查

| 工具 | 参数 | 用途 |
|---|---|---|
| `read` | `{ jsonPath?, fields?, depth? }` | 读主数据(不传 jsonPath 返回说明+格式) |
| `write` | `{ value?, patch?, patches?, del? }` | 写主数据(set/edit/delete/批量) |
| `request_human_confirmation` | `{ question, options?, recommendation? }` | 主动征询(弹选项按钮) |

### 3. 测试约定(强制)

- **每轮 mock 响应必须匹配 agent 实际会走的 ReAct 路径**(read → write → read → done)
- **断言三层**:① `window` 数据落地 ② DOM 文本/属性 ③ agent 回复包含关键词
- **清空对话**:`beforeEach` 调 `clearChat(page)` 避免持久化残留
- **等待策略**:用 `waitForAgentIdle` 而非固定 sleep(先等「停止生成」出现再等消失)
- **不依赖真 LLM**:所有测试用 mock,CI 友好

## 与手动浏览器探索的区别

| | 本 skill(Playwright 自动化) | `/browser-e2e` 命令(MCP 交互式) |
|---|---|---|
| LLM | mock(确定性) | 真 LLM(DeepSeek API) |
| 断言 | `expect()` 硬断言 | agent 肉眼判断 |
| 速度 | ~10s/用例 | ~30s/轮(等流式) |
| CI | ✅ 进 CI | ❌ 手动 |
| 适合 | 回归门禁、发布前 | 探索新功能、复现 bug |

**两者互补**:开发时用 `/browser-e2e` 交互式探索,稳定后沉淀为 `tests/browser/*.spec.ts` 进 CI。
