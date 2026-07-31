# 浏览器 E2E 探索任务

> 用途:让 Cursor Agent 经 Playwright MCP 自己驱动浏览器,探索 page-agent-sdk 各 demo,
> 验证 refactor(模块抽离)后**运行时行为零变化**。探索完把稳定路径落成 Playwright 脚本进 CI。
>
> 使用:确保 dev server 已起(`npm run dev`,默认 3000)+ `.env` 含 `VITE_AI_API_KEY`;
> 在 Cursor Agent 模式下粘贴本文件内容(或 `/browser-e2e` 调用)。

---

## 前置检查(先做)

1. 确认 dev server 在跑:`curl -s http://localhost:3000 | head -1` 应返回 HTML
2. 确认 `.env` 有 `VITE_AI_API_KEY`(否则工具循环不工作,只能测 UI 骨架)
3. 首次运行需装浏览器二进制:`npx playwright install chromium`

## 探索约定

- **每步都 `browser_snapshot()` 确认**状态(不要盲点)
- 读不动就 `browser_console_messages()` 看报错
- **遇到异常(ReferenceError / 工具永挂 / UI 不更新)立刻停下**,贴 snapshot + console 报告,不要自行重试覆盖问题
- 真实 LLM 响应有延迟,act 后等一拍再 snapshot

---

## 任务 1 — page-demo(基础 read/write + schema 注入)

目标 URL:`http://localhost:3000/`(根 index.html 主入口)

1. `browser_navigate` → `browser_snapshot`:确认 ChatDialog 渲染(输入框 + 发送按钮 + 消息区)
2. 输入「读一下主数据」→ 回车 → 等 LLM → snapshot:确认 `read` 工具返回值 + hash
3. 输入「把 title 改成『E2E测试改写』」→ 确认 `write` 成功 + 新 hash
4. 输入「再次读主数据」→ 确认 title 已变为『E2E测试改写』
5. **断言点**:改写前后行为与 refactor 前一致(无报错、数据真正落地)

## 任务 2 — human-confirm-demo(conflictManager 抽离后重点)

目标 URL:`http://localhost:3000/examples/human-confirm-demo/`

> 这是 refactor 期二 conflictManager 抽离的高风险区,重点验证。

1. navigate + snapshot
2. 触发需要人工确认的写(按 demo 提示)→ snapshot 确认**确认框 / 冲突条**出现
3. 点「确认 / 强制覆盖」→ 确认工具继续 + 数据写入
4. **断言点**:
   - 无 `ReferenceError: resolveConflict is not defined`(期二搬迁曾漏改的裸调用)
   - 冲突挂起 → resolve 后工具不永挂
   - 切会话/停止生成时,挂起冲突被按 keep_external 收口(switchSession / stream-abort 路径)

## 任务 3 — complex-demo(10 组件 discriminated union + 大 schema)

目标 URL:`http://localhost:3000/examples/complex-demo/`

1. 输入「列出所有组件」→ 确认 read 概览段带约束
2. 输入「给第一个组件加一个 text 属性『hello』」→ 确认 edit patch 增量(非整体重传)
3. 输入「读第一个组件」→ 确认子路径读 + schema 子投影

---

## 每步报告格式

- ✅ 通过:`[任务N.步骤] 观察到的关键事实(读到 X / 改成功 / 页面更新)`
- ❌ 异常:`[任务N.步骤] 现象 + snapshot 片段 + console 错误 + 停下`

## 收尾(探索稳定后)

把 **任务 1 的 read→write→read 验证** 落成 `tests/browser/page-demo.spec.ts`(Playwright 脚本,固定断言;LLM 用 mock fixture 返回预设工具调用)。这样 AI 探索的临时路径沉淀为 CI 回归套件。
