# Design: add-schema-tiered-disclosure

> `extractSchemaHint` 分层渲染:小 schema 全量(现状不变),大 schema 顶层概览 + 深层按需(`schema_data`)。核心:**阈值触发 + 不破坏小 schema**。

## 1. 分层触发阈值

```ts
const DEFAULT_SCHEMA_HINT_MAX_KEYS = 15   // 顶层 key 数超此 → 分层
const DEFAULT_SCHEMA_HINT_MAX_CHARS = 4000 // 渲染字符超此 → 分层
```
集成方可配:`createChatSdk({ schemaHint: { maxKeys?, maxChars? } })`。

触发判断:先按全量渲染,若顶层 key 数 > maxKeys **或** 渲染字符串长度 > maxChars → 转分层模式。

## 2. 分层渲染(extractSchemaHint)

**全量模式**(小 schema,现状):`key (Type)[约束]: desc`,带 min/max/enum 约束 + 嵌套(若有)。

**分层模式**(大 schema,新):**顶层概览** —— 每个 key 一行 `key (Type): 一句描述(.describe() 首句)`,**不带**约束细节(min/max/enum)、**不递归**嵌套 shape。

```ts
// 分层模式示例(50+ 组件)
// ## 可操作数据(顶层概览;深层约束查 schema_data)
// theme (enum): 界面主题
// components (array): 组件列表(50+;单个组件约束查 schema_data({jsonPath:'components.0'}))
// layout (object): 布局配置
// ...
// 提示:改某组件深层字段前,先 schema_data({jsonPath}) 查完整约束(advanced);或 read 子路径见实际值。
```

→ 50+ 组件场景:顶层概览 ~1-2KB(只 key + type + 一句),vs 全量几十 K。**体积降一个数量级**。

## 3. 与 schema_data 工具协同

`schema_data({jsonPath?})`(advanced,已有,2.17)查任意路径**完整约束**(含嵌套 shape 递归)。分层后 LLM 按需查:
- 本轮改 `components.5.props.style.color` → 先 `schema_data({jsonPath:'components.5.props.style'})` 查约束(enum/min/max)
- 再 `write` 改

`usageHints` 在大 schema 场景注入提示:「顶层概览在 systemPrompt;改深层字段前先 schema_data 查约束」。

## 4. simple 模式处理

simple 模式**无** `schema_data`(advanced 工具)。大 schema simple 模式:
- 顶层概览(分层注入)+ `read` 子路径见**实际值**
- 深层约束靠 `read` 见值 + write 时 schema 校验反馈(写错看校验错误重试,reliableWriteRules 已引导)
- 集成方需精细深层约束 → 切 `toolMode:'advanced'`(有 schema_data)

→ simple 大 schema 可用(靠 read + 校验),advanced 更精细(有 schema_data)。不强制 simple 装 schema_data(保持 simple 精简)。

## 5. 实现位置

- `src/core/presets.ts`:`extractSchemaHint(schema, opts?)` 增分层逻辑(全量渲染 → 判断阈值 → 超则转分层概览);`renderSchemaOverview` 复用(分层概览是其子集)
- `src/core/sdk/createChatSdk.ts`:接收 `schemaHint` 配置,透传 dataHint 中间件的 extractSchemaHint 调用
- `src/core/harness/usageHints.ts`:检测大 schema(dataHint 渲染分层)→ 注入「深层查 schema_data」提示

## 6. 兼容性

| 场景 | 行为 | 兼容 |
|---|---|---|
| 小 schema(≤阈值) | 全量(现状) | ✅ 不变 |
| 大 schema(>阈值) | 自动分层(顶层概览) | ✅ 体积降,行为改善 |
| `schema_data` 工具 | 不变(advanced) | ✅ |
| `read` 概览 | 不带约束(现状) | ✅ |

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 分层后 LLM 不知深层约束 → 写错 | usageHints 引导「改深层前 schema_data 查」;read 子路径见实际值;write 校验反馈(reliableWriteRules) |
| 阈值不当(误分层小 schema / 漏分层大 schema) | 默认保守(15 key / 4000 字);可配;小 schema 全量不受影响 |
| simple 模式无 schema_data | simple 靠 read + 校验;集成方切 advanced 获精细约束;不强制 simple 装 schema_data |
| 集成方依赖全量注入(已有集成) | 阈值可调到极大(如 maxKeys:9999)→ 退化为全量;向后兼容 |
