# Change: refine-tool-layering

> 对应 `doc/待确认问题.md` #1 #2 #6 #12 #3(分阶段落地计划**阶段 1**:核心架构 / 低成本高收益)。
> 核心矛盾:内置工具(windowOps/fetchDoc)当前被 `createPageAgent` **硬编码无条件装配**,与「框架无关、能力可关」理念冲突——纯调研场景也被强塞 10 个 window 工具。

## Why

1. **内置工具不可关、不可独立注入**(#1 #2 #6)。即使集成方不做任何 window 操作(纯 researcher/调研场景),也被强制带上 `windowOps`(10 个工具)+ `fetchDoc`,白占 system prompt + token、增加上下文噪音。
2. **工具集未导出**(#1 #6)。`createWindowOps` / `fetchDocTools` 未从入口导出,集成方无法 `import` 后手动注入——「主要业务工具集(window 操作)单独引入、按需注入」的诉求无法满足,内置工具集对调用方完全不透明。
3. **装了工具不教用法**(#3)。`write_todos` / `snapshot` 回退 / `spawn_agent` 等能力默认不在 system prompt 里告诉 agent「怎么用、何时用」——除非集成方自写 systemPrompt 或套 preset。能力开启但无引导 → 使用率低、误用。
4. **默认 maxTokens 偏小**(#12)。`maxTokens=8192` 对「set 整个大 window 对象」(agent 需输出整段 JSON)可能不够。

## What Changes

1. **内置工具可关**:`capabilities` 加 `windowOps?: boolean`(默认 `true`)/ `fetch?: boolean`(默认 `true`);关闭则对应工具集不进主 agent 工具池。
2. **工具集独立导出**:`createWindowOps` / `fetchDocTools` 从入口导出;另提供 `fetchTools` 静态 toolset 预设(window 工具依赖 `windowProps`,不预构造,文档示例手动 `createWindowOps(props)`)。
3. **默认 maxTokens 提高**:`8192` → `16384`(`.env` `VITE_AI_MAX_TOKENS` 仍可覆盖)。
4. **能力用法默认提示**(克制,仅能力开启时注入):planning 开 → 提示 `write_todos` 拆解;windowOps 开 → 提示 `restore_window_snapshot` 可回退误改;子 agent 默认 systemPrompt 补「只有只读工具,结论简洁」。

## Impact

- **改造**:`src/core/sdk/createPageAgent.ts`(装配 + `capabilities` + 用法提示中间件)、`src/core/index.ts` + `types/index.d.ts`(导出)、`src/core/harness/createAgent.ts`(maxTokens 默认)、`src/core/harness/subagent.ts`(默认 systemPrompt)。
- **影响规范**:`specs/page-agent-core.md` 增量(3 条新 Requirement)。
- **向后兼容**:`capabilities` 默认全开 = 完全现状行为;不传任何选项 = 零配置体验不变。

## Non-goals

- **不做** UI 改造 / 可见性(阶段 2 `improve-observability-and-ui`)。
- **不做** 验证增强(阶段 3 `enhance-verify-and-rollback`)。
- **不做** npm 改名(阶段 0 收尾,目标名 `chat-sdk`)。
- **不改** windowOps 内部逻辑、不改子 agent 只读白名单筛选机制本身(仅随主工具池变化)。
