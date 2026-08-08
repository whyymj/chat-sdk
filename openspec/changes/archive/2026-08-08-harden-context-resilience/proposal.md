# Change: harden-context-resilience(上下文健壮性:自动压缩收敛 + vfs 引用 GC)

> **合并吸收** `2026-08-08-fix-context-window-stale-on-setllm`(P0 地基,仅设计未实施)为本 change Phase 1 —— 同子系统、强耦合,合并避免碎片。详细设计见 plan + `design.md`;分项跟踪见 `tasks.md`。

## Why

用户诉求:① 换 LLM 恢复历史 → 自动压缩;② 触及上限 → 自动压缩;③ vfs 大数据引用消失 → 正常 GC;「保证其他流程正常」。经两个 Explore agent 全量盘点 + 一个红队 agent 审查,缺陷不止 setLlm 固化:

- **①② 根因**:三道闸(compressInput / trimContextIfNeeded / offload)阈值全源自 contextWindow,setLlm 固化(5 点)。
- **预防口径 bug**:H1 trimContextIfNeeded 字符口径(非 token)/ H2 compress 压完不复查 over-window。
- **反应性兜底无路径**:超限 400 不重试。
- **③ 边界**:vfs LRU 不查引用 → 被引用大结果被删 → vfs_read 404。
- **H3**:augmentPrompt 段(memory/skill/focus/dataHint)对压缩豁免,可独立撑爆。

## What Changes(5 Phase,每 Phase 独立 commit)

- **P1 地基**:`setModelCaps` + 中间件 `setContextWindow` controller + `isContextLengthError` + subagent contextWindow + 最小窗口校验
- **P2 预防口径**:H1/H2 修复 + 预算单向数据流
- **P3 自动收敛**:P2 反应性重试(迭代 catch)+ P1 setLlm 简化
- **P4 vfs**:`setProtectedRefs` + OOM 1.5x 兜底
- **P5 系统段**:截断(dataHint)+ 单条 user offload

## Decision

1. **窗口 ≥200K 硬约束**:启动/setLlm/subagent 解析后 `contextWindow < 200000` → throw。排除 128K 档主流(DeepSeek/GPT-4o/GLM-4.6),SDK 默认切 GLM-5.2/Claude/Kimi 等。200K 下全局预算宽松(非重型账本)、单条超窗口几乎不可能、M5 消解。
2. **红队修正 3 处方案错误**:P3 重试在迭代 catch(非启动阶段)/ M3 从实例提取 model 名查表 / P1 setLlm 不主动 splice(由下次 compressInput 自动适配)。
3. **5 优化**:P2 重试用激进 trim(非重跑 compressInput)/ 预算单向数据流(systemTokens→compress)/ offload 统一(user+工具结果)/ 子 agent 校验一致 / 分 Phase commit 可独立发布。
4. **最健壮组合**:预防 + 反应性兜底 + vfs 保护 + 系统段保护。

## Non-goals

cross-agent vfs 引用一致性 / memory→vfs 外存(增强,首期硬截断)/ M1 schema 计入估算(Phase 2 reserve 部分覆盖)/ M4 core.stream afterRound / M6 summaryLlm 窗口 / L1-L4 边角。
