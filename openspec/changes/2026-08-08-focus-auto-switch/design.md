# Design: focus-auto-switch

## 决策定论

### A. restore 校验 → 方案②(getSchemaAtPath 校验失效丢弃)

applySnapshot 恢复 focus 时补 `getSchemaAtPath` 校验,path 在当前 schema 失效则丢弃(debug warn)。方案①(靠首轮 wrapToolCall PATH_DENIED 自纠)实际不触发:PATH_DENIED 查「写 scope 是否在 focus 子树内」(focus.ts:114),**不查 focus.path 本身是否存在**;恢复失效 path → agent 收到矛盾信号(「聚焦 components.3」+ 写时 SCHEMA 错,非 PATH_DENIED),自纠成本高。与 sdk.setFocus(createChatSdk.ts:1613 已做 getSchemaAtPath 校验)单一真相。无 schema(dataOps 关)时丢弃(focus 本无意义)。

### B. 子 agent getSchema → 新增透传项

`SubagentOptions`/`SubagentsMiddlewareOptions` 现有字段(allTools/llm/writablePaths 等)**均无法导出主数据 schema** —— allTools 是工具自身的 args schema(非主数据 schema);子 agent 用裸 createAgent(无 liveData 闭包)。唯一干净路径:createChatSdk 装配点(createSubagentMiddleware:920 / createSubagentsMiddleware:939)注入 `getSchema: () => liveData()?.schema ?? null`(与主 focusMw 的 getSchema :730 同源),经 SubagentOptions → runSubagent → 子 createFocusMiddleware 透传。预声明子 agent 经 configToSubOpts 从 main.getSchema 继承。

### C. createFocusMiddleware 初始 focus → initialFocus 构造参数

子 agent 继承焦点是「构造时已知」的初始态,显式构造参数比「构造后立刻 setFocus」两步契约更直白(不依赖调用方记得先 construct 再 setFocus)。主 agent 不传 initialFocus(从 undefined 起,靠 set_focus 工具/sdk.setFocus 后续设)→ 向后兼容。代价极小:FocusMiddlewareOptions 加一个可选字段。

## 跨模块一致性(已逐处核对)

| 检查项 | 结论 |
|---|---|
| Focus 类型(state.ts:43-48 `{path,label?}`) | 三模块/持久化/子 agent 共用,无平行类型 |
| 门控一致 | usageHints `rc.focus && !simple` = set_focus 工具 `useFocus && toolMode==='advanced'`(createChatSdk.ts:861) |
| getSchema 同源 | 主 `() => liveData()?.schema`(:730);子透传 `() => liveData()?.schema ?? null`(同一 liveData 闭包) |
| reset 链完整 | switchSession(:1355)/resetSession(:1382)已调 focusMw.reset();restore 复用 setFocus |
| 持久化与 mission/workingMemory 同链 | SnapshotKind/SessionSnapshot/persistRuntime/applySnapshot/switchSession 对称追加,泛 kind 迭代 |
| inspect(:1557)/setLlm(:1458) | 无需改(inspect 读 focusMw.getFocus 自动反映;setLlm 不碰 focusMw,焦点跨模型保留) |
| 子 agent PATH_DENIED vs writablePaths | 两层独立校验(中间件层 vs 工具层 Proxy),最严者胜 |
