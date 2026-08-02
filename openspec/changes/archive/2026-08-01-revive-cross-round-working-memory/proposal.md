# Change: revive-cross-round-working-memory(Phase 1)

> 复活 `add-cross-round-working-memory`(2026-08-01 定位升级重启授权)。**解绑 C 组** → 独立中间件,**只 pin 关键态(path/hash)**,跨压缩保留。默认「**分层默认核心开**」。
> 旧 proposal 在 [`../2026-07-31-add-cross-round-working-memory/proposal.md`](../2026-07-31-add-cross-round-working-memory/proposal.md);调整点见 `decision-record.md`。

## Why

1. **几百 K 频繁压缩 → 丢定位**:`read`/`query` 定位的 path + `read` 的 hash 随 older 轮次被压缩/截断,后续轮 LLM 丢失定位 → 重复检索(浪费 token,长任务累积显著)。
2. **lastReadHash 跨压缩不持久**:`lastReadHash` 是 `createDataOps` 闭包变量(`dataOps.ts`),压缩后 LLM 凭记忆写,hash 不匹配 → 乐观锁冲突误报。
3. **定位升级重启**:旧暂缓理由「绑 C 组(依赖 draft+mission)+ 工作记忆段抵消压缩经济性」—— 新定位下**解绑**(独立中间件)+ **只 pin 关键态**(path/hash,非全量 locatedPaths+notes,控 context)。

## What Changes(Phase 1 最小版)

1. **workingMemory 状态 + 中间件**(`src/core/harness/workingMemory.ts`):`{ locatedPaths: string[](≤10 LRU), lastHashes: Record<path, string>(≤10 LRU) }`
2. **自动捕获**(`afterToolCall`):`read`/`query`/`search` 结果含 path → `locatedPaths`;`read` 含 hash → `lastHashes`(LRU 去重,≤10)
3. **压缩豁免**:`summarization.compressInput` 跳过 workingMemory 段(独立 pin,跨压缩保留)
4. **augmentPrompt 注入**「## 工作记忆(跨压缩保留)」(最近定位 path + hash,供 LLM 不重复检索 + 写时用对 hash)
5. **capabilities.workingMemory**(分层默认核心,**默认开**;`false` 关)
6. **inspect().workingMemory** 反映当前 pin

## Impact

- **改造**:`workingMemory.ts`(新)/ `summarization.ts`(豁免)/ `createChatSdk.ts`(装载 + inspect + capabilities)/ `types/index.d.ts`
- **捕获实现**:`afterToolCall` 从 `ToolExecResult.content` 提取 path/hash(工具结果文本已含 `path=`/`hash=` 标记),或 dataOps controller 暴露 lastPath/lastHash —— design §2 定
- **新增**:workingMemory 中间件 + 状态 + inspect().workingMemory + capabilities.workingMemory
- **影响规范**:ADD Requirement(跨压缩工作记忆)
- **向后兼容**:`capabilities.workingMemory:false` = 不装,行为同现状
- **测试**:selftest(捕获/pin/豁免/LRU≤10/去重)+ e2e(inspect().workingMemory + 压缩后 path/hash 仍在)

## Non-goals

- **不做** notes 自由文本(LLM 写,易膨胀抵消压缩经济性;Phase 后续,需体积控制机制再引入)
- **不做** 跨 session 持久化(会话级)
- **不依赖** draft/mission(解绑 C 组,独立中间件)
- **不替代** `preserveLastToolResults`(两者互补:preserve 保工具结果摘要,workingMemory 保 path/hash 结构化)
