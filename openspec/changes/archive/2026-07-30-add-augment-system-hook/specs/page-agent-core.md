# Specification Delta: page-agent-core

> 本文件为 change `add-augment-system-hook` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 动态 system prompt 注入钩子(augmentSystem)

系统提供顶层选项 `augmentSystem(ctx)`,集成方可在每轮 LLM 调用前动态注入一段 system prompt 内容。回调上下文 `ctx` 含当前运行态 `state`(对话历史 / todos / skills / memory 等 `HarnessState`)与最新主数据配置 `data`(含 schema / bind / description,每轮从当前 data 配置实时取,`setData()` 替换后下一轮自动反映)。回调返回字符串则作为 system prompt 的一段每轮注入;返回 `undefined` 则跳过。不配置该选项时无此段,行为与现状一致。该钩子供集成方实现「按运行时状态注入部分 schema 描述、组件说明」等动态提示,底层复用既有 augmentPrompt 中间件通道,不引入新的提示词机制。

## Requirement: 可操作数据段每轮随 data 动态

system prompt 中的「可操作数据」schema 字段描述段由创建时静态拼接改为每轮从当前主数据配置重新生成:中间件在每轮模型调用前读取当前 data 的 schema,经 `extractSchemaHint` 提取字段说明注入。`setData()` 运行时替换 schema 后,下一轮 system prompt 的数据段自动反映新 schema(修复创建时 const 不随更新同步的缺陷)。`inspect()` 返回的 `systemPrompt` 同步动态重算(base + 当前数据段),保持数据段在 inspect 结果中可见且随 data 更新。该段在最终 system prompt 中的位置(紧跟 base 段)与输出内容与改动前等价,无破坏性变化。
