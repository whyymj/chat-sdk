# Design: enhance-verify-and-rollback

## 1. 对抗子 agent 配只读工具(核心改进)

**现状**(`verify.ts` `runAdversarial` L229-233):`createAgent({ llm, maxToolRounds:1, systemPrompt, onLog })` —— **无 tools**,纯文本审查。

**改造**:
- `VerifyMiddlewareOptions.adversarial` 加 `tools?: StructuredToolInterface[]`(只读工具集)。
- `createPageAgent` 构造 verifyMw 时,`adversarial.tools` = 从 `allTools` 按 `DEFAULT_READONLY_TOOLS` 白名单筛选(`get_window_prop`/`get_window_paths`/`list_window_props`/`describe_window_prop`/`fetch_document`),复用 subagent 筛选语义。
- `runAdversarial`:`createAgent({ llm, tools: opts.adversarial.tools ?? [], maxToolRounds: 4, systemPrompt, onLog })`。有 tools 则子 agent 可多轮读回检查;无 tools(高级用法未传)退化为现状文本审查。

**readonlyTools 来源**:`createPageAgent` 已有 `allTools`(含 windowOps + fetchDoc + mcp + user)。筛只读:
```ts
const READONLY = ['get_window_prop','get_window_paths','list_window_props','describe_window_prop','fetch_document']
const readonlyTools = allTools.filter(t => READONLY.includes(t.name))
```
传 `adversarial: { llm: options.llm, tools: readonlyTools }`(仅当 options.verify.adversarial)。

⚠️ 若 windowOps 被关(`capabilities.windowOps:false`),readonlyTools 不含 window 工具 → 对抗子 agent 只有 fetch(或空)。符合语义(没 window 操作就不查 window)。

## 2. 对抗审查 prompt 聚焦 window 典型错误

`runAdversarial` 审查 prompt(构造 user 消息)追加重点:
```
重点检查 window 修改:① 属性路径是否正确(是否误写未注册路径);② 值类型是否符合该属性的 schema;③ 语义是否符合属性 description 的预期用途。
可用只读工具(get_window_prop 等)读回实际值实证。发现问题给出具体可操作的修正;无问题则简短回复"无问题"。
```

## 3. verify 默认策略文档

- `CLAUDE.md` Verify 小节:补「window 修改场景:开 verify 即用 createWriteBackCheck(写后读回 + schema,低成本必备);adversarial 作可选增强(语义复杂场景才开,每次烧一个配工具子 agent)」。
- `doc/usage-guide.md` 6.10 Verify 小节:同。

## 4. 回退文档 + 可选 UI

- `doc/usage-guide.md` 新增「数据回退」章节:`snapshot_window_prop`(命名检查点)/ `list_window_snapshots`(时间线)/ `restore_window_snapshot(path, id?)`(回退,不传 id=最近)。讲清「自动快照(set/edit/delete 前)+ 手动检查点 + 一键回退」。
- ChatDialog 撤销 UI(可选):需知道某回复改了哪些 path。agent 回复不自带此信息。**降级**:本期仅文档(撤销 UI 需 agent 步骤里提取 set/edit 的 path,挂到消息,复杂)—— 留后续。tasks 标注「UI 降级为文档」。

## 验证

- `tsc` + `test`(runAdversarial 配工具无纯函数可测,整体依 LLM;补 readonlyTools 筛选若有纯函数可测则加)+ `build`。
- `npm run verify:probe`:对抗子 agent 现能调只读工具(日志 `tool_call` 带 `source:'adversarial'`)。
- `npm run dev`:window 操作后开 `verify:{adversarial:true}`,确认对抗子 agent 读回检查。
