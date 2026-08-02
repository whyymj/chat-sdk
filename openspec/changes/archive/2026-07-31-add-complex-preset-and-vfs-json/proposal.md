# Change: add-complex-preset-and-vfs-json

> 体验平面改进(Phase 3 of「复杂任务 + 超大 JSON」演进)。直击 P2:complex 上下文预设 + vfs JSON 感知 + 分池存储。配套:前三变更(数据/记忆/编排平面)。本变更是体验优化,不阻塞核心能力,可最后实施。

## Why

1. **默认窗口偏小**。`useContextManager` 默认 `windowRounds=6`,长任务频繁触发压缩丢细节;复杂任务场景需更大窗口 + 更 aggressive preserve。

2. **vfs 纯文本语义**。无 JSON 感知读写;大 JSON 草稿需 LLM 自行维护合法 JSON 字符串;`vfs_read` 按行分页,不能按 jsonPath 读 JSON 子树。

3. **draft 与 offload 共享 LRU**。`add-data-paging-and-chunked-write` 已引入 drafts/ 分池,但 `large_results/` 池仍 4MB 单池,大结果 + 草稿混存易 LRU 误删。

4. **offload 元数据弱**。大结果外存返回 flat text + path,LLM 需从工具返回解析 path,无结构化索引(总字符数、预览、建议读取计划)。

## What Changes

### 1. complex 上下文预设(P2)

- 新增 `contextPreset: 'complex'`(与现有 `auto`/`conservative`/`aggressive` 并列)
- 配置:`windowRounds=12`(默认 6 的 2 倍)+ `summaryThreshold=0.6`(更晚触发压缩)+ `preserveLastToolResults` 默认含 `['describe_data','read','query_data','search_data']` + `enableLLMSummary=true`
- 适用:多步复杂任务、大 JSON 操作、长流程编排

### 2. vfs JSON 感知工具(P2)

- 新增 `vfs_json_read({ path, jsonPath? })`:在 vfs 文件内按 jsonPath 读 JSON 子树(先 parse 整文件,再 getByPath)
- `vfs_write` 支持 `jsonString` 参数:写入前校验 JSON 合法性(非法返回 `VFS_JSON_INVALID`)
- `vfs_json_patch({ path, patches })`:在 vfs 文件内做 jsonPath patch(set/remove/merge/append),原子性

### 3. vfs 分池存储强化(P2)

- `large_results/` 池:默认 4MB(现状)
- `drafts/` 池:默认 2MB(由 `add-data-paging-and-chunked-write` 引入)
- `user_files/` 池:默认 2MB(集成方/LLM 显式 vfs_write 的文件,与 offload 分离)
- 三池独立 LRU,互不挤占
- `vfs.maxBytes` 仍为总上限(默认 8MB,三池之和);可单独配置每池

### 4. offload 元数据增强(P2)

- 大结果外存返回结构化:`{ path, totalChars, preview(200字符), suggestedReadPlan }`
- `suggestedReadPlan`:若 totalChars > 10000,建议 `vfs_read({ path, offset: 0, limit: 100 })` 分页
- LLM 基于元数据决定读取策略,而非盲读

## Impact

- **改造**:
  - `src/core/composables/useContextManager.ts`:`contextPreset: 'complex'` 配置
  - `src/core/backends/vfs.ts`:三池分池;`vfs_json_read`/`vfs_json_patch` 工具;`vfs_write` JSON 校验;offload 元数据增强
  - `src/core/sdk/createChatSdk.ts`:`contextPreset: 'complex'` 映射;新工具装载
- **新增**:`contextPreset: 'complex'`;`vfs_json_read`/`vfs_json_patch` 工具;三池分池;offload 结构化元数据
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 2 条 Requirement(complex 预设 / vfs JSON 感知)
- **向后兼容**:
  - `contextPreset` 不传 = `auto`(现状)
  - `vfs_json_read`/`vfs_json_patch` 是新工具,不影响现有 vfs_read/vfs_write
  - `vfs_write` 增 `jsonString` 参数是可选(不传 = 现状,写纯文本)
  - 三池分池是内部优化,API 不变
- **测试**:selftest 加 complex 预设/vfs_json_read/vfs_json_patch/分池/元数据 断言;e2e 加 inspect().contextPreset

## Non-goals

- **不做** vfs 跨 agent 共享(三池仍是当前 agent 私有)
- **不做** vfs 持久化分池配置(集成方配 `vfs.maxBytes` 总上限;三池比例内部固定)
- **不做** offload 的自动清理策略(仍由 LRU;`suggestedReadPlan` 只是建议)
- **不做** complex 预设的自动检测(集成方显式配置;不根据任务复杂度自动切)
