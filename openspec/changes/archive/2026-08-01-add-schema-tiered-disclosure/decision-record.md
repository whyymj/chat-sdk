# 决策记录:add-schema-tiered-disclosure(Phase 1)

> 🆕 新 change(`complex-agent-roadmap` Phase 1)。记录分层方案选型。

## 1. 为什么需要(真需求)

用户场景:码良 50+ 组件深嵌套 schema。`extractSchemaHint`(2.17 expose-schema)全量渲染「可操作数据」段,50+ 组件 × 每组件多字段 × 带 min/max/enum 约束 + 嵌套 shape → systemPrompt 可达**几十 K**,挤压 LLM 可用上下文窗口 + 注意力分散。

这是 expose-schema(2.17)在新场景(大 schema)下暴露的**新问题**(2.17 设计时按常规 schema,没压测 50+ 组件量级)。

## 2. 方案选型

| 候方案 | 内容 | 决策 | 理由 |
|---|---|---|---|
| **阈值触发分层** | 小 schema 全量(现状);大 schema 自动转顶层概览 + 深层按需 | ✅ 选 | 不破坏小 schema(兼容);大 schema 自动改善;复用已有 schema_data 工具 |
| 全部分层(不分大小) | 所有 schema 都只顶层概览 + 深层按需 | ❌ | 破坏小 schema 现状(全量约束对简单场景有用,LLM 写前即知规则);过度 |
| 手动 opt-in 分层 | 集成方显式 `tiered: true` | ❌ | 增配置心智;大 schema 是明显痛点,应自动 |
| 裁剪约束(去 min/max) | 全量但去约束细节 | ❌ | 约束对写入校验重要(2.17 expose-schema 价值);分层比裁剪更优(顶层概览 + 按需查全约束) |

**结论**:阈值触发分层(小全量 + 大分层),复用 schema_data。

## 3. 与 expose-schema(2.17)的关系

expose-schema(2.17)建立了「约束提取(describeSchemaNode)+ 两处消费(extractSchemaHint 注入 + schema_data 查)」。本 change 在其上**加分层**:
- `extractSchemaHint` 渲染逻辑:全量 → 阈值判断 → 分层(顶层概览)
- `schema_data` 工具:**不变**(2.17 已就绪,本 change 强化 usageHints 引导 LLM 用它查深层)
- `describeSchemaNode` 纯函数:**不变**(分层是渲染层,提取层不动)

→ 本 change 是 expose-schema 的「大 schema 优化」,非推翻。

## 4. simple vs advanced 模式处理

| 模式 | 大 schema 深层约束获取 |
|---|---|
| advanced | `schema_data({jsonPath})` 查完整约束(精细) |
| simple | 无 schema_data → 顶层概览 + read 子路径见**实际值** + write 校验反馈(够用,靠 reliableWriteRules) |

不强制 simple 装 schema_data(保持 simple 精简,7 工具不变)。集成方需精细深层约束 → 切 advanced。这是合理的模式分工(simple 靠 read+校验,advanced 靠 schema_data)。

## 5. 阈值默认(15 / 4000)

- **maxKeys=15**:典型页面 schema 顶层 5-10 个 key(theme/components/layout/...)。15 覆盖常规 + 余量;>15(如码良 50+ 组件顶层)触发分层。
- **maxChars=4000**:全量渲染 4000 字符约等于 1000-1500 token,占 128K 窗口 <1.5%(可接受);超则分层。
- 双条件 OR(任一超则分层),保守(宁分层不爆)。
- 可配:集成方按场景调(极大值退化为全量)。

## 6. 与其他 Phase 1 能力的关系

- `revive-mission-anchor` / `revive-cross-round-working-memory`:正交(mission/workingMemory 管上下文其他维度,schema 披露管注入体积)。三者独立,Phase 1 可并行;**合力解决大 JSON 长任务的上下文经济性**(mission 防跑偏 + workingMemory 防丢定位 + schema 分层防注入过大)。

## 7. 升级路径

- **+ 动态 schema 披露**:按 LLM 当前操作区域动态展开该组件 schema(而非全顶层概览)→ 触发:Phase 1 后实测「LLM 频繁 schema_data 查同一组件」(可预加载该组件约束)
- **+ schema 摘要 LLM 生成**:用 LLM 生成 schema 摘要(而非 .describe() 首句)→ 触发:.describe() 质量不够
