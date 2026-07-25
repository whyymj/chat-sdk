# page-agent-sdk 文档

> **[English](./README.en.md)** · **[中文](./README.md)**

> **给 AI agent**：先读仓库根 [`../README.md`](../README.md) 的「Agent 接入速查」小节（导出/选项表/扩展点/内置工具/文件结构），再按需查下表；架构与约定坑见 [`../CLAUDE.md`](../CLAUDE.md)。

| 文档 | 内容 |
|---|---|
| [**使用手册**](./usage-guide.md) | **入门首选** · 安装 / 快速开始 / 配置项 / 能力详解 / 自定义中间件 / FAQ |
| [功能架构](./architecture.md) | 分层结构 / 运行控制流(ReAct+中间件)/ window 操作安全流(三张 mermaid 图 + 模块映射) |
| [上下文组成与压缩策略](./context-management.md) | 上下文 3 部分组成 / 4 层压缩策略 / 压缩后结构 / 3 张流程图 / 预设档位 / 与 Deep Agents 差异 |
| [文件全览(Review 版)](./architecture-files.md) | 逐文件职责 / 模块依赖 / import 图 / 一次请求数据流 / Review 关注点 |
| [进化规划书](./evolution-roadmap.md) | 6 个进化方向(子 agent / plan mode / MCP / 任务系统 / verify / caching)的原理 + 落地设计 + 工作量 |

## 其他信息源(仓库内)
- **规范真相源**(Requirements):[`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **变更记录**(proposal / design / tasks):[`../openspec/changes/archive/`](../openspec/changes/archive/)
- **进行中的 change**:[`../openspec/changes/generalize-chat-sdk/`](../openspec/changes/generalize-chat-sdk/)(通用化抽离:provider / headless / capabilities / MCP)
- **项目指引 / 约定与坑**:[`../CLAUDE.md`](../CLAUDE.md)
- **框架无关集成示例**:[`../demo/plain.html`](../demo/plain.html)
- **自测**:`npm test`(`../src/core/__tests__/selftest.ts`,341 项)

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
  systemPrompt: '你是页面操作助手…',
  windowProps: [
    { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
  ],
  tools: [], skills: [], memory: '',
}).mount()
```
