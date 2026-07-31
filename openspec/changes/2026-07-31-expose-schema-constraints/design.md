# Design: expose-schema-constraints

> 核心约束:**约束提取为结构化纯函数,三处消费(read 概览 / systemPrompt / schema_data 工具)**。`describeSchemaNode` 是唯一提取逻辑,从 zod `_def` 结构化摘要类型 + 关键约束;`extractSchemaHint` / read 概览段 / `schema_data` 都调它,避免三处各写。read 子路径读不附标注(保值返回干净)。

## 1. 现状定位

**`extractSchemaHint`(`presets.ts:67-81`)**:生成 `- key: description`(或 `(typeName)`)。注入 systemPrompt"可操作数据"段 + read 概览。**不带 min/max/enum 等约束**。

**`describe_data`(`dataOps.ts:457-463`)**:只给"说明 + 格式提示"。simple 隐藏。

**痛点**:集成方写 `z.string().min(1).max(100)` / `z.array(...).min(1)` / `z.enum(['a','b'])`,这些约束对 LLM 不可见,LLM 写错被拒才知。

## 2. 解法

### 2.1 `describeSchemaNode` 纯函数

```ts
// schemaUtils.ts(或 dataOps.ts)
export interface SchemaNodeDesc {
  type: string                          // 'string'|'number'|'boolean'|'enum'|'array'|'object'|'literal'|...
  constraints?: Record<string, unknown> // {min,max,length,regex,values,item,shape,...}
  optional?: boolean
  default?: unknown
  description?: string
}

export function describeSchemaNode(schema: ZodType): SchemaNodeDesc {
  let s = unwrapSchema(schema)              // 解包 lazy/optional/default
  // 注:unwrap 同时收集 optional/default 标记
  const d: SchemaNodeDesc = { type: typeNameOf(s) }
  switch (d.type) {
    case 'string': { const def = s._def; if (def.minLength) d.constraints = { min: def.minLength.value }; if (def.maxLength) d.constraints = { ...(d.constraints||{}), max: def.maxLength.value }; /* email/url/regex */ break }
    case 'number': { /* min/max/int/positive */ break }
    case 'enum':   { d.constraints = { values: s.options }; break }
    case 'literal':{ d.constraints = { value: s.value }; break }
    case 'array':  { d.constraints = { item: describeSchemaNode(s.element), ...(def.exactLength/min/max) }; break }
    case 'object': { d.constraints = { shape: Object.fromEntries(Object.entries(s.shape).map(([k,v]) => [k, describeSchemaNode(v)])) }; break }
  }
  if (s.description) d.description = s.description
  return d
}

/** 渲染为单行标注(供 read 概览 / systemPrompt):`key (Type)[约束]: desc` */
export function renderSchemaHint(key: string, desc: SchemaNodeDesc): string {
  const c = desc.constraints ? `[${formatConstraints(desc.constraints)}]` : ''
  return `- ${key} (${desc.type})${c}${desc.description ? `: ${desc.description}` : ''}`
}
```

### 2.2 三处消费

**`extractSchemaHint`(`presets.ts:67-81`)升级**:

```ts
export function extractSchemaHint(schema: any): string {
  // 原:Object.entries(shape).map → '- key: desc'
  // 改:每字段调 describeSchemaNode + renderSchemaHint,带类型 + 约束
}
```

→ systemPrompt"可操作数据"段 + read 概览段(读不传 jsonPath 时)自动带约束(都经 extractSchemaHint / buildDataPrompt)。

**read 概览段(`dataOps.ts:806`)**:当前 `"格式: 写入值需为 JSON..."`;增强为"字段说明:\n" + 各字段 `renderSchemaHint`(复用 extractSchemaHint 输出)。子路径读(传 jsonPath)**不附约束**(返回值保持干净)。

**`schema_data` 工具(advanced 新增)**:

```ts
const schemaData = tool(
  async ({ jsonPath }) => {
    const sub = jsonPath ? getSchemaAtPath(schema, jsonPath) : schema
    if (!sub) return toolError({ code: 'PATH_DENIED', message: `schema @ "${jsonPath}" 不存在`, hint: 'jsonPath 需在 schema 声明字段内' })
    return safeStringify(describeSchemaNode(sub))   // 完整结构化约束(含嵌套 shape 递归)
  },
  { name: 'schema_data', description: '查看主数据(或子路径)的字段约束:类型/min/max/enum/必填/默认/嵌套 shape。写前查约束,避免写错重试。', schema: z.object({ jsonPath: z.string().optional() }) },
)
// 加入 SIMPLE_HIDDEN(simple 不暴露,advanced 全暴露)
```

## 3. 测试策略

### 3.1 selftest 白盒

```ts
// describeSchemaNode 各类型
assert(describeSchemaNode(z.string().min(1).max(100)) 深度等于 { type:'string', constraints:{min:1,max:100} })
assert(describeSchemaNode(z.enum(['a','b'])) .constraints.values 深度等于 ['a','b'])
assert(describeSchemaNode(z.array(z.string()).min(1)).type === 'array' && constraints.min === 1)
assert(describeSchemaNode(z.number().int().min(0)).constraints.min === 0)
assert(describeSchemaNode(z.string().optional()).optional === true)
// extractSchemaHint 带约束
assert(extractSchemaHint(z.object({ name: z.string().min(1).describe('用户名') })) 含 '(string)' 且 含 'min')
// schema_data 工具
invoke('schema_data', { jsonPath: 'name' }) → 含 type/constraints
```

### 3.2 e2e

- `inspect().systemPrompt` 的"可操作数据"段含类型 + 约束标注(非裸 description)。

### 3.3 门禁

`npm test` + `npm run build && npm run test:e2e` + 断言计数同步。

## 权衡

- **为何 read 子路径读不附约束**:值 + 约束混排 verbose,且 read 子路径是"看当前值"语义;约束查询交给 read 概览(顶层)+ `schema_data`(任意路径)专职工具,职责清晰。
- **为何 `schema_data` 进 advanced**:simple 下 read 概览 + systemPrompt 段已给顶层约束(覆盖大多数);深入嵌套约束(如数组元素的字段约束)是高级需求,advanced 提供,避免 simple 工具膨胀。
- **为何 `extractSchemaHint` 升级而非新函数**:它是 systemPrompt + read 概览的既有入口,升级即让两处同时带约束,一处改两处受益;`describeSchemaNode` 是其底层。
- **为何不透传 zod `_def`**:内部结构跨 zod 版本不稳(v3/v4 差异)、verbose、含无关字段;`describeSchemaNode` 结构化摘要稳定且足够。

## 风险

- **zod v3/v4 `_def` 差异**:`minLength`/`maxLength` 等字段名跨版本可能不同。靠 `unwrapSchema` + 防御读取(`def.minLength?.value`)+ selftest 各类型断言;zod 4(项目已用)为主,v3 兼容尽力。
- **systemPrompt 体积**:约束标注让"可操作数据"段变长。大 schema 下注意 token;`extractSchemaHint` 必要时只渲染顶层 + 一级嵌套(深层靠 `schema_data` 按需查)。
- **约束信息过载 LLM**:适度渲染(关键约束 min/max/enum/optional,非全部 regex 细节);`renderSchemaHint` 控制格式。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/tools/schemaUtils.ts`(或 `dataOps.ts`) | 新增 `describeSchemaNode` / `renderSchemaHint` / `formatConstraints` |
| `src/core/presets.ts:67-81` | `extractSchemaHint` 升级调 `describeSchemaNode` |
| `src/core/tools/dataOps.ts:806`(read 概览) | 概览段带约束(经 extractSchemaHint);新增 `schema_data` 工具 + 加入 `SIMPLE_HIDDEN` |
| `src/core/index.ts` + `types/index.d.ts` | 导出 `describeSchemaNode` / `SchemaNodeDesc` |
| `src/core/__tests__/modules/`(schemaUtils / dataOps) | `describeSchemaNode` 各类型白盒 + `schema_data` 工具 + extractSchemaHint 带约束 |
| `tests/e2e/`(inspect) | systemPrompt 含约束标注 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | schema 约束可见性文档 + 断言计数 |
