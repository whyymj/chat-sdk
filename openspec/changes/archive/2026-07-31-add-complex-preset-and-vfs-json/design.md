# Design: add-complex-preset-and-vfs-json

> 核心约束:**complex 预设是新增,不改 auto/conservative/aggressive**;**vfs JSON 工具是新增,不改 vfs_read/vfs_write 现有语义**;**分池是内部优化,API 不变**。所有改动向后兼容。

## 1. contextPreset: 'complex'

**预设映射**(`src/core/sdk/contextPreset.ts` 的 `CONTEXT_PRESETS`;字段为**比例制**,经 `unify-context-compression` 重构,非旧绝对值制 `windowRounds`/`summaryThreshold`):
```ts
export type ContextPreset = 'auto' | 'conservative' | 'aggressive' | 'complex'

export const CONTEXT_PRESETS = {
  auto:         { summaryThresholdRatio: 0.5, windowRatio: 0.4, recallTopK: 3, enableRecall: true },
  conservative: { summaryThresholdRatio: 0.7, windowRatio: 0.5, recallTopK: 2, enableRecall: true, enableLLMSummary: false },
  aggressive:   { summaryThresholdRatio: 0.3, windowRatio: 0.3, recallTopK: 5, enableRecall: true, enableLLMSummary: true },
  // complex:多步复杂任务 / 大 JSON / 长流程 → 最大窗口 + 最晚触发 + 最多召回 + LLM 摘要
  complex:      { summaryThresholdRatio: 0.7, windowRatio: 0.6, recallTopK: 5, enableRecall: true, enableLLMSummary: true },
}
```
- `windowRatio: 0.6`:四档最大保留窗口(对应旧 `windowRounds=12` 的「更大窗口」意图)
- `summaryThresholdRatio: 0.7`:最晚触发压缩(与 conservative 同阈值,靠 windowRatio/recallTopK/LLM 摘要区分)
- `recallTopK: 5` + `enableLLMSummary: true`:复杂任务多召回 + 连贯压缩
- `resolveContextOptions` 无需改(已用 `CONTEXT_PRESETS[preset]`,加 `complex` 自动生效)

**`preserveLastToolResults`(在 `createChatSdk.ts`,非预设字段)**:现状硬编码 `['describe_data','read']`(createChatSdk.ts:870-872,不看 preset)。complex 需扩为 `['describe_data','read','query_data','search_data']`——改为按 preset 取默认:
```ts
const PRESET_PRESERVE: Record<ContextPreset, string[]> = {
  auto: ['describe_data', 'read'],
  conservative: ['describe_data'],
  aggressive: ['describe_data', 'read'],
  complex: ['describe_data', 'read', 'query_data', 'search_data'],
}
preserveLastToolResults:
  (options.contextOptions as any)?.preserveLastToolResults ?? PRESET_PRESERVE[options.contextPreset ?? 'auto']
```

**集成方覆盖**:`resolveContextOptions` 已 spread 逐字段覆盖预设(不整体替换),`contextPreset:'complex', contextOptions:{ windowRatio:0.7 }` → complex 基础 + windowRatio=0.7,天然支持。

## 2. vfs JSON 感知工具

**vfs_json_read**:
```ts
vfs_json_read({ path: string, jsonPath?: string })
// path: vfs 文件路径(必须存在)
// jsonPath 省略:返回整个 JSON(经 parse)
// jsonPath 指定:返回子树(getByPath)
// 文件非合法 JSON → VFS_JSON_INVALID
// jsonPath 不存在 → VFS_PATH_NOT_FOUND
```

**vfs_json_patch**:
```ts
vfs_json_patch({ path: string, patches: EditOp[] })
// 在 vfs 文件内做 jsonPath patch(set/remove/merge/append)
// 原子性:先 parse → applyPatchToClone → 校验 JSON 合法 → 写回
// 失败不污染原文件(返 PATCH_FAILED toolError)
// 成功返 string「已应用 N 个 patch(影响 M 处:...),文件现 K 字符」(与 vfs_write 口径一致;affectedPaths 在文案里)
```

**vfs_write JSON 校验**:
```ts
vfs_write({ path, content, jsonString? })
// jsonString=true:写入前校验 content 是合法 JSON(非法 VFS_JSON_INVALID)
// jsonString 省略/false:现状(写纯文本,不校验)
```

## 3. vfs 三池分池

**结构**(`vfs.ts`):
```ts
interface VfsPools {
  largeResults: { files: Map<string, string>, maxBytes: 4_000_000, lru: string[] }
  drafts: { files: Map<string, string>, maxBytes: 2_000_000, lru: string[] }
  userFiles: { files: Map<string, string>, maxBytes: 2_000_000, lru: string[] }
}
```

**路由**:
- `large_results/*` → largeResults 池(offload 自动)
- `drafts/*` → drafts 池(**依赖前序 change `add-data-paging-and-chunked-write` 的 `draft_write`,当前未实现** → 本期只建空池结构 + 独立 LRU 占位,等前序接入;largeResults/userFiles 分池立即生效)
- 其他 → userFiles 池(vfs_write 显式)

**LRU 独立**:每池独立 LRU 淘汰,互不挤占。`vfs.maxBytes`(默认 8MB)是三池之和的总上限;单池可单独配置 `vfs.poolBytes: { largeResults: 6_000_000, drafts: 4_000_000 }`。

**API 不变**:`vfs_read`/`vfs_ls`/`vfs_glob`/`vfs_grep` 跨池透明(按 path 前缀路由);`vfs_write`/`vfs_edit` 按 path 前缀自动入池。

## 4. offload 元数据增强

**当前**(`createAgent.ts` offloadLargeResult):
```ts
// 返回:`结果已转存 vfs:large_results/{toolName}-{hash}.txt,用 vfs_read 读取`
```

**改为**:
```ts
{
  offloaded: true,
  path: 'large_results/{toolName}-{hash}.txt',
  totalChars: number,
  preview: string,           // 前 200 字符
  suggestedReadPlan?: string  // totalChars > 10000 时建议分页读取
}
```

**suggestedReadPlan 示例**:
```
结果较大(15000 字符),建议分页读取:
  vfs_read({ path: 'large_results/read-abc123.txt', offset: 0, limit: 100 })
  vfs_read({ path: 'large_results/read-abc123.txt', offset: 100, limit: 100 })
```

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| complex 预设 token 开销大 | 集成方显式配置;默认仍是 auto;complex 适合长任务 |
| vfs_json_read parse 大文件慢 | 文件已在内存(vfs);parse 是纯 CPU;超大文件(>1MB)warn |
| vfs_json_patch 原子性失败 | 在 clone 上 patch;失败不写回 |
| 三池配置复杂 | 默认比例固定;集成方只配总 maxBytes 即可 |
| offload 元数据体积 | 结构化返回 < 300 字符;远小于原结果 |
