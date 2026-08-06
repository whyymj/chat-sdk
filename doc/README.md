# page-agent-sdk 文档

> **[English](./README.en.md)** · **[中文](./README.md)**

> **给 AI agent**:先读仓库根 [`../README.md`](../README.md) 的「Agent 接入速查」小节(导出/选项表/扩展点/内置工具/文件结构),再按需查下表;架构与约定坑见 [`../CLAUDE.md`](../CLAUDE.md)。

| 文档 | 内容 |
|---|---|
| [**使用手册**](./usage-guide.md) | **入门首选** · 安装 / 快速开始 / 配置项 / 能力详解 / 自定义中间件 / FAQ |
| [功能架构](./architecture.md) | 分层结构 / 组装挂载 / ReAct 主循环(含格式自纠+verify自纠) / 数据操作与乐观锁 / **冲突人工介入(状态机+abort联动)** / 上下文压缩持久化(6 张 mermaid 图) |
| [上下文组成与压缩策略](./context-management.md) / [EN](./context-management.en.md) | 上下文 3 部分组成 / 外存 + 3 层压缩(每层原理/流程/参数/边界)/ 压缩后结构 / 3 张流程图 / 预设档位 / 与 Deep Agents 差异 |
| [系统提示词构成](./system-prompt.md) | 两层拼接(base 身份+规则 / augmentPrompt 动态段)/ 数据段注入 / 各中间件段次序 / `augmentSystem` 钩子 |
| [page-agent 架构对比](./page-agent-architecture-comparison.md) | 与阿里 `alibaba/page-agent` 逐行源码对比:定位差异 / 结构性差距(DOM 交互层 / MCP server 形态 / 模型兼容)/ 我方优势 / 可借鉴落地建议(MCP server → 薄客户端 → 强制反射) |
| [占位符替换读写设计](./placeholder-protected-rw.md) | **待实施功能设计**:精确值保护(freeze 冻结 / verbatim 原样保留 / 资源池生命周期 / 跨压缩 pin)原理 + 6 张流程/时序/状态图 + 实施前审查结论(A1-A3 架构缺口 / B1-B4 语义锁死) |

## 已归档(历史参考)

> 一次性自测 / 审计 / 实测报告与已完成的演进设想,移入 [`./archive/`](./archive/) 保留溯源。

| 文档 | 内容 |
|---|---|
| [能力边界报告](./archive/capability-boundaries.md) | SDK 能做/做不到的复杂任务边界 + 升级路径(历史参考,多数边界 2.18-2.20 已实现) |
| [复杂场景+自动化设计报告](./archive/complex-agent-roadmap.md) | 定位升级蓝图(胜任复杂 + 浏览器内后台自动化)+ 6 层能力全景 + 分期路线图(Phase 1-4 已全部落地) |
| [演进设想与建议](./archive/roadmap.md) | 待办项 #3-#21 的逐条设计设想(版本目标 2.11-3.0,已过时,仅作决策溯源) |
| 自测/修复/审计报告 | [`refactor-selftest.md`](./archive/refactor-selftest.md) · [`testing-fix-report.md`](./archive/testing-fix-report.md) · [`tool-design-audit-report.md`](./archive/tool-design-audit-report.md)(一次性记录) |

## 其他信息源(仓库内)
- **规范真相源**(Requirements):[`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **变更记录**(proposal / design / tasks):[`../openspec/changes/archive/`](../openspec/changes/archive/)
- **项目指引 / 约定与坑**:[`../CLAUDE.md`](../CLAUDE.md)
- **框架无关集成示例**:[`../demo/plain.html`](../demo/plain.html)
- **自测**:`npm test`(`../src/core/__tests__/selftest.ts`,1130 项断言)+ `npm run test:e2e`(集成层 e2e,286 项)+ `npm run test:browser`(浏览器 E2E,25 项)

## 快速开始
```bash
npm run dev    # 双栏 demo:左 JSON 响应式页面 + 右对话框(@3000,被占则 3001)
npm run build  # 库模式构建
npm test       # 核心逻辑自测
```

```ts
import { createChatSdk } from 'page-agent-sdk'
import { z } from 'zod'

createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl, model },
  systemPrompt: '你是JSON 操作助手…',
  data: {
    schema: z.object({ theme: z.enum(['light','dark']).describe('主题') }),
    bind: app,
  },
  tools: [], skills: [], memory: '',
}).mount()
```
