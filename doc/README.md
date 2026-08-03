# page-agent-sdk 文档

> **[English](./README.en.md)** · **[中文](./README.md)**

> **给 AI agent**:先读仓库根 [`../README.md`](../README.md) 的「Agent 接入速查」小节(导出/选项表/扩展点/内置工具/文件结构),再按需查下表;架构与约定坑见 [`../CLAUDE.md`](../CLAUDE.md)。

| 文档 | 内容 |
|---|---|
| [**使用手册**](./usage-guide.md) | **入门首选** · 安装 / 快速开始 / 配置项 / 能力详解 / 自定义中间件 / FAQ |
| [功能架构](./architecture.md) | 分层结构 / 组装挂载 / ReAct 主循环(含格式自纠+verify自纠) / 数据操作与乐观锁 / **冲突人工介入(状态机+abort联动)** / 上下文压缩持久化(6 张 mermaid 图) |
| [上下文组成与压缩策略](./context-management.md) | 上下文 3 部分组成 / 外存 + 3 层压缩(每层原理/流程/参数/边界)/ 压缩后结构 / 3 张流程图 / 预设档位 / 与 Deep Agents 差异 |
| [能力边界报告](./capability-boundaries.md) | SDK 能做/做不到的复杂任务边界 + 升级路径 + 判断框架(后期优化参考;与 deferred.md 互补) |
| [复杂场景+自动化设计报告](./complex-agent-roadmap.md) | 定位升级(胜任复杂 + 浏览器内后台自动化)+ 6 层能力全景 + 分期路线图(Phase 1-4)+ 分层默认映射(OpenSpec 蓝图) |

## 其他信息源(仓库内)
- **规范真相源**(Requirements):[`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **变更记录**(proposal / design / tasks):[`../openspec/changes/archive/`](../openspec/changes/archive/)
- **项目指引 / 约定与坑**:[`../CLAUDE.md`](../CLAUDE.md)
- **框架无关集成示例**:[`../demo/plain.html`](../demo/plain.html)
- **自测**:`npm test`(`../src/core/__tests__/selftest.ts`,1092 项断言)+ `npm run test:e2e`(集成层 e2e,283 项)+ `npm run test:browser`(浏览器 E2E,25 项)

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
