---
description: 跑 Playwright 浏览器 E2E 测试(mock LLM,确定性,可进 CI)。验证 dataOps/ChatDialog/确认流程的运行时行为。
argument-hint: [spec文件名或demo名,留空跑全部]
---

# 浏览器 E2E 测试(Playwright + mock LLM)

> 用 `tests/browser/*.spec.ts` 跑确定性浏览器测试。mock LLM 拦截 API 返回脚本化 SSE,不依赖真 LLM。
> 详细原理与写法见 `.claude/skills/browser-e2e-testing/SKILL.md`。

## 执行

### 全部测试

```bash
! npm run test:browser
```

### 指定 demo / spec 文件

如果 `$ARGUMENTS` 是 spec 文件名:
```bash
! npx playwright test tests/browser/$ARGUMENTS
```

如果 `$ARGUMENTS` 是 demo 名(如 `page-demo`):
```bash
! npx playwright test tests/browser/$ARGUMENTS.spec.ts
```

如果 `$ARGUMENTS` 为空,跑全部。

### 调试模式(可视化 UI)

```bash
! npm run test:browser:ui
```

## 前置检查

1. **浏览器已安装**:首次需 `! npx playwright install chromium`(`playwright.config.ts` 已内置路径)
2. **dev server**:Playwright 自动启 `npm run dev`(复用已跑的);CI 下自动启新的
3. **不需要 `.env`**:mock LLM 不调真 API

## 结果解读

- ✅ `N passed` — 全绿,可发布
- ❌ `N failed` — 看错误上下文:
  - `SCHEMA_INVALID` → write 工具 schema 校验问题(检查 mock arguments 格式)
  - `TimeoutError` → `waitForAgentIdle` 超时(检查 mock LLM 脚本是否匹配 ReAct 轮次)
  - `expect(received).toBe(expected)` → 断言不匹配(检查 DOM 选择器或 window 数据路径)

## 完成后

- 如果新增了测试用例,同步更新 `CLAUDE.md` 测试流程小节的断言计数
- 如果测试失败,先定位是 mock 脚本问题还是真实 bug,再修
- 稳定的交互式探索路径(来自 `/browser-e2e`)应沉淀为 `tests/browser/*.spec.ts` 进 CI
