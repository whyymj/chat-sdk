# Tasks: generalize-page-agent

> 状态:**部分实现完成**(Phase 1 provider / 2 headless / 3 capabilities / 6 presets 已实现并门禁通过)。Phase 4(MCP)待规划(单独 change,涉及新依赖 + 体积评估);Phase 5(DataSource)决策**暂缓**(偏离 page-agent window 核心定位,泛化收益不抵复杂度,按需再做)。
> 关联:`doc/evolution-roadmap.md`(进化设计)、本目录 `design.md`。

- [x] **Phase 1 — LLM provider 抽离(最高价值)** ✅ 已实现
  - [x] `CreateAgentOptions` 加 `llm?: BaseChatModel`(优先于 apiKey/model 配置;字段名用 `llm` 避免与 model 名冲突)
  - [x] `createAgent` 用 `options.llm ?? new ChatOpenAI(llm配置)`
  - [x] `createPageAgent({ llm: BaseChatModel | LLMConfig })` 联合类型 + `isChatModel` 判断;subagent 同步支持实例透传
  - [x] 兼容 `reasoning_content` 等多 provider 字段(`coreModelCall` 已容错);`bindTools` 可选兜底
  - [x] docs 注明(CLAUDE.md 技术栈 + usage-guide 配置项)+ .d.ts `ChatModelLike`;门禁 tsc/test/build 通过
- [x] **Phase 2 — headless / UI 可替换** ✅ 已实现(核心)
  - [x] `PageAgentOptions` 加 `ui?: boolean | 'default'`(`false` = headless);`container` 改可选
  - [x] `mount()`:`ui === false` 跳过 Vue 渲染,只 init agent + flush 兜底
  - [x] `PageAgent` 接口加 `messages: AgentMessage[]`(响应式数组,headless 自建 UI 读)
  - [x] docs(CLAUDE.md / usage-guide)注明 headless 用法;门禁 tsc/test/build 通过
  - [ ] `render?: (ctx) => void` 自定义渲染 + `state?`(loading/error)只读 —— 留后续(headless 已可用 messages + send/stream 覆盖大多数自建 UI 场景)
- [x] **Phase 3 — 能力开关 capabilities** ✅ 已实现
  - [x] `PageAgentOptions` 加 `capabilities?: { planning?, skills?, vfs?, summarization?, memory?, subagent? }`(默认全开)
  - [x] `createPageAgent` middlewares 按 capabilities 条件装载(usePlanning/useSkills/...);subagent 合并 `capabilities.subagent` 与 `subagent.enabled`
  - [x] 文档标注中间件依赖(vfs 关 → 大结果退化截断;summarization 关 → 长会话不压缩):CLAUDE.md / usage-guide(含 FAQ 更新)
  - [x] 门禁 tsc/test/build 通过;`agent.inspect()` 可验证关掉后工具集缩减
- [ ] **Phase 4 — MCP client**(待规划:新依赖 + 体积评估,拟拆单独 change 推进)
  - [ ] 新模块 `src/core/mcp/`(client + SSE/WebSocket transport)
  - [ ] `createPageAgent({ mcp: [{ transport, url }, ...] })`
  - [ ] mount 时连 server → listTools → 转 StructuredToolInterface → 合并 allTools
  - [ ] 评估 `@modelcontextprotocol/sdk` 体积(懒加载 / 自实现轻量 client)
  - [ ] 自测:mock MCP server 工具注入;单 server 断连不影响主
- [ ] **Phase 5 — DataSource 接口**(决策:**暂缓** —— 偏离 page-agent window 核心定位,泛化收益不抵复杂度;仅当有明确非 window 场景需求时重启)
  - [ ] 仅当有明确非 window 场景需求时启动
  - [ ] 定义 `DataSource` 接口;`windowDataSource` 作为默认实现(封装现 windowOps)
  - [ ] `createPageAgent({ dataSource? })`
  - [ ] 评估:window 的 schema/快照/Vue reactive 兼容如何映射到通用接口
- [x] **Phase 6 — 预设 presets** ✅ 已实现
  - [x] 新 `src/core/presets.ts` 导出 `presets.pageBuilder` / `researcher` / `minimal`
  - [x] `index.ts` + `.d.ts` 导出 presets
  - [x] 文档:CLAUDE.md / usage-guide 补预设用法;门禁 tsc/test/build 通过
- [x] **文档与归档**(Phase 1/2/3/6 部分)
  - [x] 每完成一项:更新 `CLAUDE.md` + `doc/usage-guide.md`(已同步)
  - [ ] specs 增量合入 `openspec/specs/page-agent-core.md`(待 Phase 4 定夺后一并合入)
  - [ ] 全部完成(含 Phase 4)→ change 移入 `openspec/changes/archive/`

> 备注:Phase 1–4 已有部分铺垫(provider/headless 在 roadmap 隐含;MCP 是 roadmap #3)。实施时优先 Phase 1(provider 抽离,改动小收益大)。
