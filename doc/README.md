# page-agent 文档

| 文档 | 内容 |
|---|---|
| [**使用手册**](./usage-guide.md) | **入门首选** · 安装 / 快速开始 / 配置项 / 能力详解 / 自定义中间件 / FAQ |
| [功能架构](./architecture.md) | 分层结构 / 运行控制流(ReAct+中间件)/ window 操作安全流(三张 mermaid 图 + 模块映射) |
| [文件全览(Review 版)](./architecture-files.md) | 逐文件职责 / 模块依赖 / import 图 / 一次请求数据流 / Review 关注点 |
| [进化规划书](./evolution-roadmap.md) | 6 个进化方向(子 agent / plan mode / MCP / 任务系统 / verify / caching)的原理 + 落地设计 + 工作量 |

## 其他信息源(仓库内)
- **规范真相源**(Requirements):[`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **变更记录**(proposal / design / tasks):[`../openspec/changes/archive/`](../openspec/changes/archive/)
- **进行中的 change**:[`../openspec/changes/generalize-page-agent/`](../openspec/changes/generalize-page-agent/)(通用化抽离:provider / headless / capabilities / MCP)
- **项目指引 / 约定与坑**:[`../CLAUDE.md`](../CLAUDE.md)
- **框架无关集成示例**:[`../demo/plain.html`](../demo/plain.html)
- **自测**:`npm test`(`../src/core/__tests__/selftest.ts`,103 项)

## 快速开始
```bash
npm run dev    # 双栏 demo:左 JSON 响应式页面 + 右对话框(@3000,被占则 3001)
npm run build  # 库模式构建
npm test       # 核心逻辑自测
```

```ts
import { createPageAgent } from 'page-agent'
import { z } from 'zod'

createPageAgent({
  container: '#root',
  llm: { apiKey, baseUrl, model },
  systemPrompt: '你是页面操作助手…',
  windowProps: [
    { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
  ],
  tools: [], skills: [], memory: '',
}).mount()
```
