# Spec Delta: page-agent-core

> 本文件为 `add-complex-preset-and-vfs-json` 变更对 `openspec/specs/page-agent-core.md` 的增量。归档时合入主规范。

## Requirement: complex 上下文预设

`contextPreset` 新增 `'complex'` 选项(与 `auto`/`conservative`/`aggressive` 并列),配置为比例制 `summaryThresholdRatio=0.7`、`windowRatio=0.6`、`recallTopK=5`、`enableLLMSummary=true`(经 `unify-context-compression` 重构为比例制,非旧绝对值 `windowRounds`/`summaryThreshold`),适用于多步复杂任务、大 JSON 操作、长流程编排。`preserveLastToolResults` 默认按 preset 取(complex 扩为 `['describe_data','read','query_data','search_data']`,在 `createChatSdk.ts`;其余预设保持 `['describe_data','read']` 或更少)。`contextOptions` 显式配置时逐字段覆盖预设(不整体替换)。不传 `contextPreset` = `auto`(现状)。

## Requirement: vfs JSON 感知工具

系统提供 `vfs_json_read({ path, jsonPath? })` 工具在 vfs 文件内按 jsonPath 读 JSON 子树(先 parse 整文件再 getByPath;文件非合法 JSON 返回 `VFS_JSON_INVALID`),与 `vfs_json_patch({ path, patches })` 工具在 vfs 文件内做原子 jsonPath patch(set/remove/merge/append,在 clone 上 patch 后校验写回,失败不污染原文件)。`vfs_write` 支持 `jsonString?: boolean` 参数(true 时校验 content 是合法 JSON,非法返回 `VFS_JSON_INVALID`;省略/false 时写纯文本不校验)。

## Requirement: vfs 三池分池存储

vfs 内部按 path 前缀分三池独立 LRU:`large_results/*`(offload 自动,默认 4MB)、`drafts/*`(draft_write 自动,默认 2MB)、其他(userFiles,vfs_write 显式,默认 2MB)。三池独立 LRU 互不挤占;`vfs.maxBytes`(默认 8MB)为三池之和总上限;`vfs.poolBytes` 可单独配置每池。`vfs_read`/`vfs_ls`/`vfs_glob`/`vfs_grep` 跨池透明(按 path 前缀自动路由)。

## Requirement: offload 大结果结构化元数据

工具结果外存 vfs 时返回结构化 `{ offloaded: true, path, totalChars, preview(200字符), suggestedReadPlan? }`,其中 `suggestedReadPlan` 在 `totalChars > 10000` 时建议分页 `vfs_read({ path, offset, limit })` 读取策略,使 LLM 基于元数据决定读取策略而非盲读。
