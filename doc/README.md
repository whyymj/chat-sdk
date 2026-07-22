# page-agent 文档

| 文档 | 内容 |
|---|---|
| [功能架构](./architecture.md) | 分层结构 / 运行控制流(ReAct+中间件)/ window 操作安全流(三张 mermaid 图 + 模块映射) |

## 其他信息源(仓库内)
- **规范真相源**(Requirements):[`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **变更记录**(proposal / design / tasks):[`../openspec/changes/archive/`](../openspec/changes/archive/)
- **项目指引 / 约定与坑**:[`../CLAUDE.md`](../CLAUDE.md)
- **框架无关集成示例**:[`../demo/plain.html`](../demo/plain.html)
- **自测**:`npm test`(`../src/core/__tests__/selftest.ts`,51 项)

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
