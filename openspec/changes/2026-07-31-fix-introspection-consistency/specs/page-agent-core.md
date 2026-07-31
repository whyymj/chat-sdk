# Specification Delta: page-agent-core

> 本文件为 change `fix-introspection-consistency` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: inspect() 返回的 systemPrompt 与运行时实际注入一致

`inspect()`(及 DebugDrawer 经 `getInfo()` 读取)返回的 `systemPrompt` 字段,必须等于 agent 运行时实际注入 LLM 的完整 system prompt,即 base(用户 systemPrompt + 可靠写入规则)+ `buildDataPrompt`(可操作数据段)+ **所有已装载中间件的 `augmentPrompt` 段**(含 usageHints 工具用法提示、todos 任务清单、skills 技能索引、memory 持久指令、subagents 预声明索引、augmentSystem 用户钩子等)。该一致性通过 `createAgent` 暴露 `getEffectiveSystemPrompt()`(复用内部 `buildSystemPrompt()` 的权威拼装)实现,`getInfo` 的 `systemPrompt` 字段代理到该出口,消除"展示拼装"与"运行时拼装"两套逻辑分叉。agent 尚未构造时(initDone 未 resolve 的早期 inspect)回退到 `base + buildDataPrompt`。该修复使调试方观察到的系统提示词与真实请求完全一致,不再漏掉 usageHints / todos / skills / memory / subagents 等段。
