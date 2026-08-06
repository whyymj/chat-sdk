# page-agent(阿里开源)架构对比参考

> 对比对象:[`alibaba/page-agent`](https://github.com/alibaba/page-agent)(v1.12.2,monorepo 8 包) vs **本仓库 `page-agent-sdk`**。
> 日期:2026-08-04。用途:定位差异备忘 + 「值得补什么」的决策参考。对比依据为对方源码逐行阅读(证据索引见 §6),非网络二手资料。
> 关联:[`doc/前景规划.md`](./前景规划.md)(定位与拓展方向)、[`doc/archive/capability-boundaries.md`](./archive/capability-boundaries.md)、[`doc/问题.md`](./问题.md)。

---

## 1. 定位差异(一句话)

两个项目名字接近但**做的是不同的事**:

- **page-agent**:**网页自动化 agent** —— 核心是「DOM 抽取脱水 → 元素索引化 → 点/输/滚/执行 JS」,LLM 只负责每步决策。**对手/同赛道参照物**。
- **page-agent-sdk(我们)**:**规范化 JSON 操作 agent** —— 核心是「`data` 槽 + schema 白名单 + jsonPath 增量 patch + 乐观锁」,LLM 读写宿主 `window`/`bind` 数据。

这个差异决定了多数「不足」的方向性:他们强在「**操控页面**」,我们强在「**安全地操作页面内的数据**」。对比不是「谁抄谁」,而是**双方边界在哪、我们缺的能补哪块**。

---

## 2. 总览对比表

| 维度 | page-agent | page-agent-sdk(我们) | 差距 |
|---|---|---|---|
| **核心定位** | 浏览器自动化(点/输/滚/JS) | 规范化 JSON 操作(schema + patch) | 互补,不重叠 |
| **DOM 交互层** | ✅ PageController(索引化元素 + 高亮 + mask) | ❌ 仅 `get_dom` 只读检查(opt-in) | **结构性缺失** |
| **MCP 对外形态** | ✅ 正式 MCP **server** 包(execute_task/get_status/stop_task) | ⚠️ 仅 MCP **client**(`src/core/mcp/client.ts`) | 缺 server 端 |
| **LLM 层** | 自研薄客户端 + `modelPatch`/`normalizeResponse`/`disableNamedToolChoice` | LangChain(`@langchain/openai`)+ `proxyLlm` | 模型兼容手段弱 |
| **每步交互** | 单 MacroTool + 强制反射(评估/记忆/下目标) | 标准多工具绑定 + mission/write_todos 软锚定 | 无 schema 级强制反思 |
| **事件模型** | history(持久,进上下文) vs activity(瞬态,只给 UI) 显式分离 | `messages` + onEvent/hook,靠中间件约定 | 无强制分层抽象 |
| **上下文管理** | ❌ 无(每步全量重发 history) | ✅ 滑动窗口 + token 驱动压缩 + 召回 + workingMemory | **我们领先** |
| **数据操作安全** | ❌ 无(schema 仅校验入参) | ✅ schema 白名单 + 乐观锁 + 快照 + 冲突介入 | **我们领先** |
| **编排能力** | 仅 EventTarget 事件(无子 agent/verify/approval/checkpoint/storage/skills) | ✅ 全套 | **我们领先** |
| **浏览器扩展/多标签** | ✅ WXT 扩展 + MultiPageAgent + TabsController | ❌ 单页对话框 | 缺分发渠道 |
| **发布工程化** | 8 包 monorepo + pre/post-publish 自动切 dist + sync-version + API extractor | 单包 + 手动 types/index.d.ts + checklist 人工发布 | 自动化弱 |
| **测试密度** | 仅 llms 包有单测 | 1097 selftest + 286 e2e + 25 browser E2E | **我们领先** |

---

## 3. 结构性差距(我们缺什么,按严重度排序)

### 3.1 缺「网页操作层」—— 最大结构性差距

page-agent 有一整层我们完全没有:PageController(`packages/page-controller/src/PageController.ts`,435 行)。

| 能力 | page-agent 实现 | 我们现状 |
|---|---|---|
| **DOM 抽取脱水** | `FlatDomTree`(移植 browser-use 0.5.9)+ 简化 HTML(`flatTreeToString`) | `get_dom` 只读、深度≤3、属性白名单 |
| **元素交互** | 索引化后 `clickElement(33)` / `inputText(33,text)` / `selectOption` / `scroll`(垂直/水平/容器) | ❌ 无 —— 交互只能靠集成方 `actions` 手写 run |
| **视觉反馈** | SimulatorMask 遮罩 + 元素高亮 + React patch(`patches/react.ts`) | ❌ 无 |
| **视口感知** | `<browser_state>` 带 viewport 尺寸、pages above/below、pixels 滚动提示 | ❌ 无 |

他们的 LLM 每步看到的 `<browser_state>` 是「`[33]<button>Submit</button>` + 视口/滚动头尾」,天生适配「操作网页」;我们的 agent 只能「改数据」,要看效果靠 `get_dom` 被动回读。

**若要承担「浏览器端 agent」角色,这是必须补的层。** 价值大但工程量也最大 —— 是否补取决于定位是否从「JSON 操作」扩展成「网页自动化」(见 §5)。

### 3.2 缺 MCP server 对外形态(「成为其他 agent 子 agent」的缺口坐实)

page-agent 有正式 `@page-agent/mcp` 包(`packages/mcp/src/index.js`):

- **stdio MCP server**:注册 `execute_task` / `get_status` / `stop_task` 三个工具
- **HubBridge**(HTTP + WebSocket)连接浏览器 hub + 启动时自动 `open` 启动器
- 其他 agent(Claude Code / Cursor)直接当子 agent 调用:`execute_task({ task: "在浏览器里订机票" })`

我们**只有 MCP client**(`src/core/mcp/client.ts`,连远程 server 注入 tools),**没有把自己暴露成 MCP server 的入口**。

> 备注:上一轮「本项目如何成为其他 agent 的子 agent」已论证「MCP server 是缺失部分」——此对比直接坐实:他们有、我们没有。**这是工作量最小的补法**(headless `sdk.send` / `sdk.batch` 包一层 stdio transport 即可),且直接解决「成为子 agent」诉求。

### 3.3 LLM 层依赖 LangChain,模型兼容/修复能力弱

page-agent 的 `@page-agent/llms` 是**自研薄客户端**(`packages/llms/src/OpenAIClient.ts` ~150 行),围绕「各家用各家脾气」做整套防御:

- `InvokeError` 分类:auth / rate-limit / server / **context-length** / content-filter / invalid-args / tool-exec
- **`normalizeResponse`**:模型返回格式错时自动修复
- **`modelPatch`**:集中式模型补丁表(内置 Kimi K3、通义等;还有 skill 自动维护模型列表)
- **`disableNamedToolChoice`**:一行开关绕过「模型拒绝 `tool_choice` 对象」—— 各家 OpenAI 兼容端点的常见坑
- `transformRequestBody` / `customFetch`(自定义 header/凭据/代理)

我们依赖 `@langchain/openai`。好处是通用;坏处是**模型奇偶性的修复手段要侵入 LangChain 抽象层**,没有他们那种「一行开关解决一类模型」的集中 patch 机制。我们仅有的应对是 `proxyLlm`(防 apiKey 泄漏),他们靠 hub 桥解决。

### 3.4 缺「单 MacroTool + 每步强制反射」的鲁棒交互设计

page-agent 的核心交互(`PageAgentCore.ts` `#packMacroTool`)是**每步只有一个工具** `AgentOutput`:

```ts
{ evaluation_previous_goal, memory, next_goal, action: { toolName: input } }
```

配 `parallel_tool_calls: false` + `tool_choice` 强制。收益:

1. **强制每步结构化反思**(评估上一步 → 记忆 → 下个目标),天然防跑偏、可追踪
2. **单一 schema** → 格式错误面最小,对「多工具支持不稳」的模型友好

我们走标准多工具绑定,虽有 mission / `write_todos` / workingMemory 做软锚定,但**没有在 schema 层强制每步反射**。低成本借鉴:给 `write` 前加一个可选 reflection 字段。

### 3.5 事件模型缺「持久记忆 vs 瞬态 UI」分离

page-agent 明确分两层(`packages/core/src/types.ts`):

- **`history`**(持久):进 LLM 上下文,构成 agent 记忆(step / observation / user_takeover / error / retry)
- **`activity`**(瞬态):只给 UI 反馈(thinking / executing / executed / retrying / error),**不进上下文**

我们:`messages` 数组 + `onEvent`/`hook`,事件种类更丰富(`data_change`/`tool_call`/`round_start`…),但**没有强制的「哪些进 LLM 上下文 / 哪些只给 UI」分离抽象**,靠中间件约定。他们的模型在「上下文不被瞬态噪音污染」上更干净。

### 3.6 缺浏览器扩展 / 多标签分发

page-agent 有 WXT 扩展(`packages/extension/`)+ `MultiPageAgent`(多标签:`TabsController` + `tabTools` 的 open/switch/close_tab + `RemotePageController` 跨 context)。我们只有单页对话框。作为「浏览器端 agent」,他们多了扩展这条分发渠道 + 跨标签操控能力。

### 3.7 DOM 状态描述管线弱(3.1 的延伸)

他们 `<browser_state>` 的 header/footer 是**为 LLM 阅读优化**的:viewport 尺寸、`pages_above/below`、`pixels_below`、`[Start/End of page]` —— 让模型判断「该不该滚、滚多少」。我们的 `get_dom` 是结构化 JSON(偏程序消费),不是「为 LLM 描述可操作环境」的脱水管线。

### 3.8 工程化发布自动化

page-agent 8 包 monorepo:source-first + publish 时 `pre-publish.js` 自动切 `dist`、`sync-version.js`、API extractor、CI 脚本、commitlint + husky + lint-staged。我们单包 + 手动 `types/index.d.ts` + 发布靠 CLAUDE.md checklist 人工执行。

---

## 4. 我们强于他们的(避免一边倒)

- **上下文管理**:他们有但完全没有 —— 每步**全量重发** `<agent_history>`,无滑动窗口 / token 驱动压缩 / 召回。我们的 `useContextManager` + 压缩 + workingMemory + mission 领先一个量级。
- **数据操作安全**:schema 白名单 + jsonPath 增量 patch + 乐观锁 + 冲突人工介入 + 快照/checkpoint,他们完全没有。
- **编排层**:子 agent(`spawn_agent`/预声明 `use_<id>`)/ verify 自检 / approval 人工确认 / checkpoint / storage / skills —— 他们只有 EventTarget 事件。
- **UI 组件**:ChatDialog / DebugDrawer / 确认条 / 上下文面板 vs 他们的 vanilla Panel(历史列表 + 输入框)。
- **测试密度**:1097 + 286 + 25 断言(selftest/e2e/browser,mock LLM 确定性)vs 他们仅 llms 包有单测。
- **框架无关**:我们 Vue 打进包、对外框架无关;他们的 `@page-agent/ui` Panel 是 vanilla DOM 手动拼。

---

## 5. 可借鉴的落地建议(按性价比排序)

> 三条都是「低破坏、可独立发布」的增量,不做架构迁移。**是否补 DOM 交互层(3.1)单独决策**,取决于定位是否扩展。

### 5.1 MCP server 模式(最该做,工作量最小)

- **做什么**:headless 包装暴露成 MCP server —— 工具 `execute_task`(`sdk.send` 包装,带 `data` 读写)/ `get_status`(`inspect()` 摘要)/ `stop_task`(`agent.stop`)。stdio transport(浏览器端换成 http/websocket 由宿主起)。
- **价值**:直接解决「成为其他 agent 子 agent」;复用现有 `sdk.batch`(automation 批处理)可做多任务。
- **对照**:page-agent `packages/mcp/src/index.js` 就是模板。
- **前置**:无。依赖 `@modelcontextprotocol/sdk`(已是 optional peerDep,仅用时动态 import)。

### 5.2 自研薄 LLM 客户端 + 模型 patch 机制(摆脱 LangChain 掣肘)

- **做什么**:把 LLM 调用从 `@langchain/openai` 收口到自家薄客户端(OpenAI 兼容协议直接 fetch),加:
  - `InvokeError` 分类(含 context-length 专门标识,喂给压缩触发判断)
  - `normalizeResponse` 格式自修钩子
  - `modelPatch` 集中补丁表 + `disableNamedToolChoice` 开关
- **价值**:模型奇偶性修复从「侵入 LangChain」变成「一行配置」;`disableNamedToolChoice` 这类开关对我们的 `summarization`/`decide`(agent-driven-compression)同样适用。
- **风险**:大改造 —— 我们的 ReAct harness、`bindTools`、ToolMessage 回灌、usageHints 全建立在 LangChain `BaseChatModel`/`StructuredTool` 抽象上。**建议先做「LangChain 之上加一层 `normalizeResponse`/`disableNamedToolChoice` 透传」的轻量版**,不整体替换。
- **对照**:page-agent `packages/llms/`(OpenAIClient + utils:modelPatch/zodToOpenAITool)。

### 5.3 每步强制反射(低成本,提升可追踪性)

- **做什么**:在简单交互路径上加一个可选 reflection(评估上一步 / 记忆 / 下个目标)字段,或一个 `reflect` 工具;不做单 MacroTool 大改。
- **价值**:防跑偏 + 审计可读性;和 mission / `write_todos` / `onAudit` 互补。
- **对照**:page-agent `MacroToolInput`(强制 reflection-before-action)的设计意图。

### 5.4 暂不建议

- **DOM 交互层(3.1)**:价值最大但工程量最大,且偏离「规范化 JSON 操作」定位 —— 除非定位扩展为网页自动化,否则先不做;`get_dom` 已覆盖「读渲染效果」的检查需求。
- **浏览器扩展 / 多标签(3.6)**:分发渠道,等 MCP server 形态验证了「作为子 agent」价值后再评估。
- **8 包 monorepo(3.8)**:对我们单包 + 高测试密度反而更优;发布自动化可单独补脚本,不必拆包。

---

## 6. 参考源码索引(证据)

> 对方仓库路径前缀 `page-agent/`;我们仓库路径前缀省略 = `src/`。

### page-agent(对比参照)

| 文件 | 内容 | 相关 § |
|---|---|---|
| `packages/core/src/PageAgentCore.ts`(661 行) | ReAct 主循环 + MacroTool 打包 + 事件 + 观察流 | 3.4 / 3.5 |
| `packages/core/src/tools/index.ts`(202 行) | 内置 9 工具(done/wait/ask_user/click/input/select/scroll/JS) | 3.1 |
| `packages/core/src/types.ts`(285 行) | AgentReflection / MacroToolInput / history-vs-activity 类型 | 3.4 / 3.5 |
| `packages/core/src/prompts/system_prompt.md` | browser-use 风格,`<browser_state>` 元素索引 + 滚动规则 | 3.1 / 3.7 |
| `packages/page-controller/src/PageController.ts`(435 行) | DOM 抽取 / 索引化 / 交互 / mask / dispose | 3.1 |
| `packages/page-controller/src/dom/dom_tree/index.js` | 移植 browser-use 0.5.9 的 DOM 树抽取引擎 | 3.1 |
| `packages/llms/src/OpenAIClient.ts` | 自研 OpenAI 兼容客户端(错误分类/normalizeResponse/modelPatch/tool_choice) | 3.3 |
| `packages/llms/src/utils.ts` | `modelPatch` / `zodToOpenAITool` | 3.3 |
| `packages/mcp/src/index.js`(100 行) | stdio MCP server:execute_task/get_status/stop_task + HubBridge | 3.2 / 5.1 |
| `packages/ui/src/panel/Panel.ts` | vanilla 面板(history 列表 + activity 头) | 3.5 / 4 |
| `packages/page-agent/src/PageAgent.ts` | 主入口:Core + PageController + Panel 组装 | — |
| `packages/extension/src/agent/*` | MultiPageAgent / TabsController / tabTools / RemotePageController | 3.6 |

### 我们(对照现状)

| 文件 | 内容 | 相关 § |
|---|---|---|
| `src/core/mcp/client.ts` | **仅** MCP client(连远程 server 注入 tools;无 server 端) | 3.2 |
| `src/core/llm/proxyLlm.ts` | 代理连接模块(防 apiKey 泄漏:proxy/direct) | 3.3 |
| `src/core/tools/dataOps.ts` | schema 白名单 + jsonPath 增量 + 乐观锁 + 快照(我们护城河) | 4 |
| `src/core/harness/createAgent.ts` | 自研 ReAct harness + 中间件(mission/workingMemory/usageHints) | 4 |
| `src/core/composables/useContextManager.ts` | 滑动窗口 + token 驱动压缩 + 召回 | 4 |
| `src/core/components/ChatDialog.vue` / `DebugDrawer.vue` | 对话框 / 调试面板(含上下文查看规划中) | 4 |

---

## 附:一份结论备忘

> **他们缺的都是我们的强项(上下文/安全/编排),我们缺的是他们的强项(操控网页/MCP server 形态/模型兼容)。**
> 最值得补的三件事:`MCP server`(最小成本解决「成为子 agent」)→ `normalizeResponse`/`disableNamedToolChoice` 轻量版(模型兼容)→ 每步强制反射(可追踪性)。
> DOM 交互层是否补 = 定位决策(保持「JSON 操作」则不补;扩展「网页自动化」则补,参照 §3.1)。
