# 码良级真 LLM 实测发现(2026-08-02)

模型: deepseek-v4-pro | 初始组件: 21 | 组件类型: 34(含 icon/tag/price)
systemPrompt 体积: 3548 chars | 总轮次: 8 | 总工具调用: 7(trace.metrics,成功率 100%) | 压缩: 1 次 | 耗时: 41s
mission capture: ✓ 搭建并运营电商 618 专题页(explicit setMission)
planning 触发: ✗(4 任务 LLM 直接做,未用 write_todos;批量改 20 patch 被判定简单直接 patch)
workingMemory: ✓ locatedPaths 跨任务保留(components.7 / components.6.props.children.0.props.children.0 / components.21 / components.length)

## 任务级(LLM 实际表现,据 reply + trace.metrics)
- **① 生成「限时秒杀」section**: ✓ write patch 追加到 components[21](heading + countdown + productGrid 3 商品带 price 现价/原价 + tag「秒杀」)。中等规模 write patch 装下,未触发 draft(合理 —— draft 留给几百 K 从零生成)。
- **② 批量 8 折**: ✓ write patches 原子写 **20 patch 覆盖 5 个 productGrid**(comp[7/8/9...]),current 打折 original 保留。**未误用整体重传**(关键正确行为)。
- **③ 深嵌套定位改 coupon 面额**: ✓ read 定位路径 `components[6].props.children[0].props.children[0]`(section → grid → coupon)+ write patch amount 50→80。**深嵌套 5 层定位准确**。
- **④ 问答统计**: ✓ read 统计 5 个 productGrid / 20 商品,列出现价最高。只读不改。

## 审计结论(SDK 胜任码良级任务)
- ✓ **mission 防跑偏**: capture 工作,4 任务改动均围绕"搭建运营专题页"目标,无跑偏。
- ✓ **大 JSON 处理**: LLM 正确用 write patch/patches 增量(批量改 20 patch 原子)+ 深嵌套定位,未误用 write 整体重传(关键短板已避)。生成任务中等规模用 write patch(未触发 draft —— draft 留给几百 K 从零生成,符合设计)。
- ✓ **schema 注入体积可控**: 34 组件 union + 分层披露(maxKeys/maxChars 阈值),systemPrompt 仅 3548 chars,未撑爆上下文。
- ✓ **workingMemory 跨任务**: locatedPaths 保留,任务间定位 path 不丢(避免重复 read + 凭记忆写致乐观锁误冲突)。
- ✓ **trace 可观测**: rounds / 工具成功率 / 压缩频次 / model 调用数可查。
- ⚠ **planning 未触发**: 4 任务 LLM 直接做(没用 write_todos 规划)。"批量改 20 patch"/"生成 section" 被判定简单直接执行 —— 符合 usageHints「简单直接做 / 复杂先规划」的软引导(LLM 自判简单)。若要强制复杂任务规划,需 prompt 层引导或调复杂度启发式(当前框架不做启发式检测,争议留给 LLM)。
- ⚠ **脚本审计精度**: onEvent tool_call 在 send(invoke)模式不外发(仅 stream 模式发),任务级工具链收集为空;实际工具调用以 `inspect().trace.metrics.toolCalls`(=7)为准。后续审计脚本改用 trace 增量或 stream 模式收 tool_call。

## 新增组件(icon/tag/price)实测验证
3 个新组件在任务①(秒杀 section 用 tag「秒杀」+ price 现价/原价 + 图标)中正确生成 + schema 校验通过,补充电商专题页高频缺口,LLM 自然选用(无需 prompt 引导)。

## 结论
SDK 在 complex-agent-roadmap 全部能力(mission/workingMemory/planning/draft/observability/todos-tier/subagent-writable/automation)落地后,**胜任码良级真实运营任务**(生成/批量改/深嵌套定位/问答四类闭环),LLM 工具链选择合理(增量 patch + 深嵌套定位 + 未误用整体重传)。
