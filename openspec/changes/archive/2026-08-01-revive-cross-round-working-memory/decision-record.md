# 决策记录:revive-cross-round-working-memory(Phase 1)

> 本 change 是 `add-cross-round-working-memory` 在定位升级后的复活。记录解绑 C 组 + 范围取舍。

## 1. 重启授权(为什么现在做)

定位升级(2026-08-01)推翻 deferred 标尺②。用户场景(码良几百 K JSON、多轮长任务)满足重启触发条件:「扩 preserve 默认后,复杂任务下压缩丢 path/hash 仍瓶颈」。complex 预设已扩 preserve 含 query/search(软改进),但 preserve 保的是**工具结果摘要片段**,不保**结构化 path/hash** —— 长任务多轮压缩后,定位 path 和乐观锁 hash 仍丢。故 workingMemory(结构化 pin)仍需要。

## 2. 关键调整:解绑 C 组

旧 proposal「绑 C 组」(依赖未实现的 `draft_write` + 暂缓的 mission dual-query)—— 单独做是半成品(旧暂缓理由)。本 change **解绑**:

| 旧依赖 | 本 change 处理 |
|---|---|
| `draft_write`(未实现) | **不依赖**。workingMemory 只 pin path/hash,与 draft 分块写无关 |
| mission dual-query(暂缓) | **不依赖**。workingMemory 是压缩豁免(独立 pin),不涉 recall(那是 mission 的 Phase 后续) |

→ workingMemory 做成**独立中间件**(捕获 + pin + 压缩豁免),零外部依赖,可单独落地。

## 3. 范围选型:只 pin path/hash,不做 notes

| 候范围 | 内容 | 决策 | 理由 |
|---|---|---|---|
| **只 path/hash** | locatedPaths + lastHashes,自动捕获 | ✅ 选 | 直击「压缩丢定位 + hash 不匹配」两痛点;自动捕获(零 LLM);体积 <1KB |
| + notes 自由文本 | + LLM 写中间结论 notes | ❌ 后续 | 自由文本易膨胀,抵消压缩经济性(旧暂缓理由之一);需体积控制机制(LLM 主动写 + LRU + 字数限)再引入 |
| + 跨工具链路 | + 记录「read→write」工具链中间态 | ❌ 后续 | 增量增强;Phase 1 不含 |

**结论**:Phase 1 只 pin path/hash(自动捕获)。notes/工具链是后续 Phase(需体积控制设计)。

## 4. 与 preserveLastToolResults 的关系(互补非替代)

| 机制 | 保什么 | 防什么 |
|---|---|---|
| `preserveLastToolResults`(已有) | 工具结果**摘要片段**(默认 describe/read;complex 扩 query/search) | 字段描述/工具返回内容被摘要掉 |
| `workingMemory`(本 change) | **结构化 path/hash** | 定位 path 丢 + 乐观锁 hash 不匹配 |

两者互补:preserve 保「内容摘要」,workingMemory 保「定位结构」。complex 预设已扩 preserve,本 change 在其上补结构化 pin,不冲突。

## 5. 捕获实现选项

| 选项 | 做法 | 取舍 |
|---|---|---|
| **a. content 提取**(推荐) | afterToolCall 从 ToolExecResult.content 正则提 path=/hash= | 零工具改动;依赖结果文本格式稳定(read 返回已含 hash=xxx) |
| b. controller getter | dataOps controller 暴露 lastPath/lastHash | 更可靠;耦合 dataOps(controller 增接口) |

apply 时定(倾向 a,零改动;若 content 格式不稳,降级 b)。

## 6. 与其他 Phase 1 能力的关系

- `revive-mission-anchor`:正交(mission 目标 / workingMemory 中间态);都豁免压缩,并存
- `add-schema-tiered-disclosure`:正交(schema 注入体积);三者独立,Phase 1 可并行

## 7. 升级路径(Phase 1 之后)

- **+ notes**:LLM 用 `note` 工具写中间结论,workingMemory pin(LRU + 字数限,控体积);触发:Phase 1 后实测「中间结论跨压缩丢」成瓶颈
- **+ 工具链路**:记录 read→query→write 链路中间态;触发:复杂联动任务需要
