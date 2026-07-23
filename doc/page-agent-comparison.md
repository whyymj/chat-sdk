# 对比结论报告:alibaba `page-agent` vs 本项目(`zhuanti-agent`)

> 调研日期:2026-07-23
> 调研对象:alibaba 开源项目 [`page-agent`](https://github.com/alibaba/page-agent)(v1.12.2,monorepo)
> 对照对象:本项目(仓库目录 `zhuanti-agent`,npm 包名 `page-agent`,v1.0.0)
> 调研方法:源码级阅读(`packages/core`、`llms`、`page-controller`、`ui`、`extension`、`mcp`),结论均基于真实代码,非臆测。

---

## 一、执行摘要(TL;DR)

两者 **npm 包名相同(都叫 `page-agent`)**,但解决的是**完全不同的问题**,属于不同范式:

| | alibaba `page-agent` | 本项目 `zhuanti-agent` |
|---|---|---|
| **本质** | 通用**浏览器自动化 Agent**(AI 版 RPA) | 宿主应用的**数据操作 Copilot**(AI 版数据编辑器) |
| **一句话** | 操作「页面长什么样」 | 操作「应用知道什么」 |
| **操作对象** | DOM 元素(按 index 点击/输入/滚动) | `window` 属性(属性注册表 + schema 校验) |
| **与应用关系** | **黑盒**(适配任意陌生网页) | **白盒契约**(集成方预声明可读写属性) |
| **技术血统** | browser-use 衍生(移植其 DOM 引擎) | 自研 Deep Agents 风格 harness |

**核心洞察**:这不是「谁更好」的问题,而是**通用性 vs 可靠性**的根本取舍。alibaba 版要适配全宇宙网页,只能用脆弱的通用启发式(猜哪些元素可点击、合成鼠标事件、React 值注入);本项目走属性契约,在受控范围内精确、可校验、可回退,代价是不能操作任意网页。两者下游所有设计差异都源于此。

---

## 二、两者定位详解

### alibaba `page-agent`
**"The GUI Agent Living in Your Webpage"** —— 一行 `<script>` 给任意网页注入一个能**自己点击、输入、滚动**的 AI Agent。典型场景:智能表单填充、SaaS AI Copilot、无障碍访问、跨标签页多步任务。基于 [`browser-use`](https://github.com/browser-use/browser-use) 的 DOM 处理与 prompt 衍生而来。提供三层产品形态:**页面内 SDK + Chrome 扩展(跨标签)+ MCP server(外部 Agent 驱动浏览器)**。

### 本项目 `zhuanti-agent`
**框架无关的页面内 Agent JS SDK** —— 以对话框形态挂载到网页,内置 ReAct Tool-Calling Agent,通过自定义 tool **直接读写宿主 `window` 对象上的属性**(基于属性注册表 + schema 校验),并具备 planning / skills / 虚拟工作区 / 快照回退 / context 管理 / 持久化 / 子 agent 编排能力。由原 Vue3「什么值得买专题」业务库重构为通用 SDK。**单一形态**:页面内 SDK(对话框 / headless)。

---

## 三、全维度对比

| 维度 | alibaba `page-agent` (v1.12.2) | 本项目 `zhuanti-agent` (v1.0.0) |
|---|---|---|
| **操作对象** | DOM 元素(`[index]` 定位) | `window` 属性(注册表内路径) |
| **感知方式** | 提取 DOM → 脱水成 `[index]<tag>text` 文本 | 读注册属性值 / vfs 工作区 |
| **Agent loop** | **反思-行动**:宏工具 `AgentOutput` 强制 `tool_choice` | **ReAct + 中间件**(Deep Agents 风格) |
| **思考载体** | 结构化 tool args(强制:`evaluation`/`memory`/`next_goal`/`action`) | 自由文本 Thought + tool call |
| **核心工具** | `click_element_by_index` / `input_text` / `select_dropdown_option` / `scroll` / `scroll_horizontally` / `execute_javascript`(默认禁用) / `done` / `wait` / `ask_user` + tab 工具 | `list`/`describe`/`get`/`get_paths`/`set`/`edit`/`delete_window_prop` + `snapshot`/`list`/`restore_window_snapshot` + `fetch_doc` + vfs(~13 个) |
| **数据校验** | 工具 inputSchema(zod) + `autoFixer` 畸形输出修复 | 属性 schema(zod) + 增量 patch + 快照回退 |
| **大结果处理** | 原样回写 history | **外存 vfs**(>6000 字符转存 + 预览引用) |
| **持久化** | 无(每步重新提取 DOM,状态在浏览器) | **IndexedDB 多后端** + 多 agent 隔离 + 配额/LRU 淘汰 |
| **LLM 接入** | **自研 `OpenAIClient`**(单实现) + `modelPatch`(十多家模型补丁表) + `transformRequestBody` hook + 固定 100ms 重试 | **LangChain 浏览器子包**(`@langchain/openai`+`core`) + provider 注入(可传任意 `BaseChatModel`);不引 langchain 整包/LangGraph |
| **高级能力** | 视觉遮罩 `SimulatorMask` + AI 光标动画 | 中间件生态(todos/skills/memory/summarization/permissions)+ **子 agent 编排**(`spawn_agent`/`spawn_agents`) |
| **工程架构** | **monorepo**(8 包,npm workspaces) | 单包库(`src/core/` 内分层) |
| **集成形态** | **三层**:页面 SDK + 扩展(WXT+React) + MCP server | 单一:页面内 SDK |
| **UI 技术** | 页面内 = **原生 DOM**(零框架);扩展 = React | **Vue 3.5**(打包进 SDK) |
| **多页/跨标签** | 扩展支持(`MultiPageAgent` + `RemotePageController`) | 无(多实例靠 `id` 隔离) |
| **停止/重试** | abort + LLM `withRetry`(可重试错误分类) | abort(保留半截内容)+ 模型调用重试 + UI 重试 |
| **响应式绑定** | 无(直接改 DOM) | Vue `reactive()`(set 子属性不替换引用) |
| **成熟度** | 成熟开源(alibaba / HN 热议 / Chrome 商店 / Trendshift) | 自研重构中 |

---

## 四、关键差异深度解析

### 差异 1:Agent 循环范式 —— 架构分水岭

**alibaba 的「反思-行动」(Reflection-Before-Action)** 不信任 LLM 的自由文本推理:

```
每轮:
  observe  → PageController.getBrowserState() 拉 DOM + 脱水文本
  think    → LLM 强制调用唯一宏工具 AgentOutput(tool_choice:'required')
             返回结构化四字段:{ evaluation_previous_goal, memory, next_goal, action }
  act      → 执行 action 对应子工具(如 click_element_by_index)
  record   → history.push({reflection, action}); done 则退出,否则 step++
  (默认 maxSteps=40)
```

- 把**所有工具合并成一个宏工具 `AgentOutput`**,强制模型只能调它,反思被拆成结构化三段。
- 配 **`autoFixer`**(核心亮点):自动修复模型各种畸形输出 —— 没返回 `tool_calls` 但 content 里塞 JSON、把 action 名当顶层 tool name、多层包装、双重 JSON 字符串、缺 action 兜底成 `wait`、单字段工具收到原始值自动提升等。
- **哲学:LLM 不可靠 → 用 schema + 修复器主动兜底。**

**本项目的「ReAct + 中间件」** 走标准循环,靠中间件增强:

```
每轮:
  beforeModel(中间件正序) → augmentPrompt
  model call → Thought 文本 + tool_call
  wrapToolCall(洋葱) → 执行工具
  afterModel(中间件逆序)
  (大结果外存 vfs / todos 收口 / memory 压缩)
```

- 思考是**自由文本**,工具调用按标准 tool-calling。
- 能力(压缩/记忆/权限/子 agent)**全部做成中间件注入**,不硬编码进循环。
- **哲学:循环可插拔,能力靠中间件组合。**

> **借鉴点**:alibaba 的「宏工具强制 + autoFixer」对提升复杂 JSON 操作稳定性非常有效。本项目当前主要靠重试,可考虑引入结构化反思 + 畸形输出修复。

### 差异 2:与应用的关系 —— 决定可靠性天花板

- **alibaba 操作 DOM 是启发式猜**:用 `cursor: pointer` 启发式判定可交互性(自称 "Genius fix")、按 W3C 规范合成 Pointer/Mouse 事件序列、用原生 value setter 绕过 React 值拦截。注定有边界(Monaco/CodeMirror/Draft.js 不支持,`index` 仅当轮 `updateTree` 后有效)。要适配全宇宙网页 → 必须用脆弱的通用启发式。
- **本项目走属性契约**:集成方明确声明「可读写哪些数据」(path + schema),Agent 在受控范围操作 → 天然**精确、可校验、可回退(快照栈)、可增量编辑(patch)**。代价是**只能操作接入了 SDK 的应用**,不能动任意网页。

> **本质**:通用性 ↔ 可靠性的取舍,无对错,定位不同。

### 差异 3:LLM 多 Provider 抹平策略相反

- **alibaba**:写**一个** OpenAI 兼容 client,把所有模型差异**硬编码进 `modelPatch` 巨表**(qwen 关 thinking、deepseek 删 tool_choice、claude 改 `{type:'any'}`、gemini 设 reasoning_effort、kimi 删 parallel_tool_calls…),外加用户 `transformRequestBody` hook。**更轻、更可控**(不依赖 LangChain),但要持续维护补丁表。
- **本项目**:走 **LangChain 抽象 + provider 注入**(传任意 `BaseChatModel` 实例,差异由 LangChain 各 provider 包消化)。**更标准、扩展性好**,但绑了 LangChain 子包。

> **注**:本项目 `temperature` 仍保留;alibaba 已把 `temperature` 标 `@deprecated`(很多新模型拒绝该字段,推荐用 `transformRequestBody` 精准注入)—— 这是新模型适配的一个细节信号。

### 差异 4:工程架构与产品形态

- **alibaba 是完整产品矩阵**(monorepo 8 包):
  - `core`(无 UI 的 `PageAgentCore`)/ `llms` / `page-controller`(DOM 引擎,独立于 LLM)/ `ui`(原生 DOM Panel)/ `page-agent`(主入口)/ `extension`(WXT+React 跨标签)/ `mcp`(外部 Agent 驱动)/ `website`
  - **同一套 DOM 引擎 + 同一个 agent 内核**贯穿三层形态,扩展只是把「直接 PageController」换成「`RemotePageController`(消息代理)」,上层零改动。
  - 精巧点:扩展用「`chrome.storage` 心跳 + content script 轮询」控制目标页遮罩显隐,规避 MV3 service worker 生命周期不可预测的问题。
- **本项目是单包库**(`src/core/` 内部分层:harness/sdk/tools/backends/composables/components),形态单一但内聚。

---

## 五、能力矩阵(各自独有)

### alibaba 独有(本项目暂无)
- ✅ **DOM 自动化**(点击/输入/滚动/选下拉/执行 JS)
- ✅ **跨标签多页任务**(扩展 `MultiPageAgent`)
- ✅ **MCP server**(让 Claude/Cursor 等外部 Agent 驱动浏览器)
- ✅ **视觉遮罩 + AI 光标动画**(`SimulatorMask`,自动化时物理隔离用户误操作)
- ✅ **autoFixer**(模型畸形输出自动修复)
- ✅ **`ask_user` 工具**(主动向用户提问)
- ✅ Chrome 商店分发渠道

### 本项目独有(alibaba 暂无)
- ✅ **属性注册表 + schema 校验 + 增量编辑 + 快照回退**(精确数据操作)
- ✅ **中间件生态**(todos/skills/memory/summarization/permissions,可插拔)
- ✅ **子 agent 编排**(`spawn_agent`/`spawn_agents`,过程隔离 + 并行)
- ✅ **大结果外存 vfs**(>6000 字符转存,不丢信息)
- ✅ **持久化存储**(IndexedDB 多后端 + 多 agent 隔离 + 配额/LRU 淘汰)
- ✅ **响应式绑定**(Vue reactive,set 子属性触发 UI 更新)
- ✅ **planning / 渐进式 skills 披露 / AGENTS.md 风格 memory**

---

## 六、可借鉴清单(优先级排序)

| # | 借鉴点 | 来源 | 价值 | 难度 |
|---|---|---|---|---|
| 1 | **宏工具强制 + autoFixer**(结构化反思 + 畸形输出修复) | `core/utils/autoFixer.ts` | 显著提升 DeepSeek 等模型复杂 JSON 操作稳定性,减少重试 | 中 |
| 2 | **MCP server 形态**(外部 Agent 驱动) | `packages/mcp` | 本项目已依赖 `@modelcontextprotocol/sdk`,天然契合;让 Claude/Cursor 调用本项目 | 中 |
| 3 | **`ask_user` 工具**(主动提问) | `core/tools` | 对话型 Agent 的基础能力,提升交互闭环 | 低 |
| 4 | **PageController 式解耦**(操作后端独立、全 async 接口) | `page-controller` | 便于未来扩展/远程形态,`windowOps` 可抽成更纯粹后端 | 中 |
| 5 | **三层产品矩阵思路**(SDK + 扩展 + MCP) | 整体架构 | 产品化路径参考 | 高 |
| 6 | **`temperature` 弃用 + `transformRequestBody` 精准注入** | `llms/utils.ts` | 适配新模型拒绝 temperature 字段的问题 | 低 |

---

## 七、⚠️ 风险与待决事项

### 1. npm 包名冲突(高优先级)
- 本项目 `package.json` 的 `name` 为 **`"page-agent"`**(v1.0.0)。
- alibaba 已占用 **`npmjs.com/package/page-agent`**(v1.12.2,高下载量)。
- **两者无法共存**:本项目**无法发布到 npm 公共 registry**,除非改名。
- **建议**:尽早确定新包名(如 `@scope/page-agent`、`page-agent-sdk`、或保留历史名 `zhuanti-agent`),同步更新 `package.json` / `CLAUDE.md` / `vite.config.ts` 的 globals / CDN 引用。

### 2. 定位澄清
- 两者方向不同,**不存在直接竞争**。本项目若面向「自家应用的 AI 数据 Copilot」,无需也不应模仿 alibaba 的 DOM 自动化路线(那是另一套工程量)。
- 若未来确实需要「操作任意网页」能力,可评估**接入 alibaba 作为补充**(它就是为此而生),而非自研 DOM 引擎。

### 3. MCP 方向已埋点
- 本项目 `package.json` 已依赖 `@modelcontextprotocol/sdk` ^1.29.0,说明 MCP 在规划中。
- alibaba 的 `packages/mcp`(stdio→WS 适配器 + hub 心跳 + 用户确认)是**现成范式**,可直接参考其安全分层设计(token 鉴权 / 用户批准外部连接)。

---

## 八、结论

1. **两者同名不同源不同质**:alibaba `page-agent` 是**通用浏览器自动化 Agent**(操作 DOM,黑盒,browser-use 衍生);本项目是**宿主应用数据操作 Copilot**(操作 window 属性,白盒契约,Deep Agents 风格)。属不同范式,不可直接横向评比优劣。

2. **核心分水岭是「思考强制方式」与「应用关系」**:alibaba 用「宏工具 + autoFixer」对抗 LLM 不可靠;本项目用「属性 schema + 中间件」换取受控范围内的精确与可回退。

3. **最值得借鉴**:① autoFixer(提升模型稳定性);② MCP server 形态(本项目已有依赖,契合度高);③ `ask_user` 工具。

4. **最需立即处理**:npm 包名 `page-agent` 与 alibaba 冲突,发布前必须改名。

5. **不必照搬**:DOM 自动化、视觉遮罩、Chrome 扩展、monorepo 拆包 —— 这些服务于「通用网页自动化」目标,与本项目定位不符,盲目引入会增加体积与维护负担。

---

## 附录:关键源码路径索引(alibaba page-agent)

> 均在 `/Users/wuhao/Desktop/smzdm/page-agent/packages/` 下

- **Agent 内核**:`core/src/PageAgentCore.ts`(ReAct 循环 + prompt 拼装 + 宏工具打包)
- **工具定义**:`core/src/tools/index.ts`
- **畸形修复**:`core/src/utils/autoFixer.ts`
- **System Prompt**:`core/src/prompts/system_prompt.md`
- **LLM 客户端**:`llms/src/index.ts`(重试外壳)、`llms/src/OpenAIClient.ts`、`llms/src/utils.ts`(modelPatch)、`llms/src/errors.ts`
- **DOM 引擎**:`page-controller/src/dom/dom_tree/index.js`(提取,移植自 browser-use 0.5.9)、`page-controller/src/dom/index.ts`(脱水 `flatTreeToString` + `getSelectorMap`)
- **DOM 操作**:`page-controller/src/PageController.ts`、`page-controller/src/actions.ts`(W3C 事件序列)
- **视觉遮罩**:`page-controller/src/mask/SimulatorMask.ts`
- **页面内 UI**:`ui/src/panel/Panel.ts`(原生 DOM)、`ui/src/panel/types.ts`(`PanelAgentAdapter` 契约)
- **扩展**:`extension/src/agent/{MultiPageAgent,RemotePageController*,TabsController*,tabTools}.ts`
- **MCP**:`mcp/src/{index,hub-bridge}.js`、`mcp/src/launcher.html`
