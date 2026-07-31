---
description: 浏览器 e2e 探索(refactor 行为零变化验证)。委派 browser-tester subagent 驱动 Playwright 探索 page-demo/human-confirm-demo/complex-demo,异常即停。
argument-hint: [demo名,留空跑全部]
---

# 浏览器 E2E 探索(refactor 验证)

> 以下探索任务**委派给 `browser-tester` subagent 执行**(Playwright MCP 工具 + 大块 DOM 隔离在 subagent 里,不撑爆主上下文)。你(主对话)拿到的是 browser-tester 回报的结论。

## 前置(先确认,失败就停下让用户处理)

1. dev server 在跑:`curl -s http://localhost:3000 | head -1` 返回 HTML;没跑就提示用户 `! npm run dev`
2. `.env` 含 `VITE_AI_API_KEY`(否则工具循环跑不动,只能测 UI 骨架)
3. `playwright` MCP server 已信任(首次连会弹一次信任确认;拒过就 `claude mcp reset-project-choices` 重置)

## 探索任务

### 任务 1 — page-demo(基础 read/write + schema 注入)
URL:`http://localhost:3000/`
1. navigate → snapshot:确认 ChatDialog 渲染(输入框 + 发送按钮 + 消息区)
2. 输入「读一下主数据」→ 等 LLM → snapshot:确认 `read` 返回值 + hash
3. 输入「把 title 改成『E2E测试改写』」→ 确认 `write` 成功 + 新 hash
4. 输入「再次读主数据」→ 确认 title 已变
5. **断言**:无报错、数据真正落地

### 任务 2 — human-confirm-demo(conflictManager 抽离后重点)
URL:`http://localhost:3000/examples/human-confirm-demo/`
1. navigate + snapshot
2. 触发需人工确认的写(按 demo 提示)→ snapshot 确认确认框 / 冲突条出现
3. 点「确认 / 强制覆盖」→ 工具继续 + 数据写入
4. **断言**:
   - 无 `ReferenceError: resolveConflict is not defined`(期二搬迁曾漏的裸调用)
   - 冲突挂起 → resolve 后工具不永挂
   - 切会话 / 停止生成时,挂起冲突按 keep_external 收口(switchSession / stream-abort 路径)

### 任务 3 — complex-demo(10 组件 discriminated union + 大 schema)
URL:`http://localhost:3000/examples/complex-demo/`
1. 输入「列出所有组件」→ 确认 read 概览带约束
2. 输入「给第一个组件加一个 text 属性『hello』」→ 确认 edit patch 增量(非整体重传)
3. 输入「读第一个组件」→ 确认子路径读 + schema 子投影

## 完成后

把每个任务的结论(✅/❌ + 关键事实)汇总回主对话;稳定的验证路径(任务 1 的 read→write→read)沉淀为 `tests/browser/page-demo.spec.ts`(Playwright 脚本 + mock LLM fixture)进 CI 回归。

如 `$ARGUMENTS` 指定了单个 demo(如 `human-confirm-demo`),只跑对应任务。
