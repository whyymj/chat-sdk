# IO 易用性重构设计

> 目标:在**功能零缩水**前提下提升 JSON 操作的直观性。修正方案:不强行收敛工具,而是「分层呈现 + JSON 直传 + 自动锁 + 拦截器 + IO 契约 + 明文绑定」。
> 状态:**设计稿,待 review**。实施按 L1→L2→L3 分阶段。

---

## 1. 痛点与目标

### 1.1 现状痛点(6 条)

1. **value 是 JSON 字符串**:`set/edit_data_slot` 的 `value` 为 `z.string()`,LLM 要 stringify、工具内 `JSON.parse`,转义/引号易错
2. **13 工具认知负担**:list/describe/get/set/edit/delete/snapshot/query/search/eval,简单场景用不上 query/search/eval
3. **乐观锁 hash 手动**:LLM 要 get→拿 hash→set 传 expectedHash,漏传则无保护
4. **字段格式信息分散**:集成方声明 schema+description 后,LLM 仍要主动 describe 才知道格式
5. **无输入输出拦截**:集成方想脱敏/转换/审计/拒绝 LLM 读写,目前仅 `onAudit` 日志,不能改写或拒绝
6. **agent 无顶层 IO 契约**:createChatSdk 未声明「输入什么、输出什么」,靠 systemPrompt 自由描述不强制

### 1.2 设计目标

- **功能零缩水**:现有 13 工具、动态注册、字段白名单读、快照回退、乐观锁、大数组 query/search/eval 全保留
- **易用性提升**:JSON 直传、自动锁、直观工具入口、声明式 IO、响应式直连
- **向后兼容**:旧 API/工具签名保留为「高级模式」,新能力可选启用
- **分阶段**:L1 低风险先行,L2/L3 增量

### 1.3 非目标

- 不改 harness 核心(ReAct/中间件契约不变)
- 不删任何现有工具(只分层呈现,不隐藏高级能力,除非集成方显式选 minimal)
- 不改持久化/存储后端

---

## 2. 六维度设计

### 2.1 顶层 IO 契约(input/output schema)

createChatSdk 顶层声明 agent 的输入输出形状,自动注入 systemPrompt,集成方不用手写 description:

```ts
createChatSdk({
  io: {
    input:  PageSchema,    // zod schema,agent 能读的明文 JSON 形状
    output: PageSchema,    // zod schema,agent 能写的明文 JSON 形状
  },
  // 多 slot 场景仍用 dataSlots(并存,不互斥)
  dataSlots: [{ path: 'page', schema: PageSchema, description: '页面' }],
})
```

- `io.input`/`io.output` 是 zod schema,SDK 自动提取字段说明注入 systemPrompt(替代手写 description)
- 与 `dataSlots` 并存:`io` 是「单主对象声明式」快捷方式,底层等价注册 1 个 dataSlot;`dataSlots` 是「多 slot + 动态注册」复杂场景
- 不传 `io` 时,行为同现状(靠 dataSlots + systemPrompt)

### 2.2 JSON 直传(value 用 object 而非 string)

工具参数 `value` 改为接受 JSON 对象,zod 直接校验,不再要求 stringify:

```ts
// 现在(易错):set_data_slot({ path: 'page', value: '{"title":"x"}' })   ← 字符串
// 改后(直观):set_data_slot({ path: 'page', value: { title: 'x' } })      ← 直传对象
```

**兼容策略(关键)**:`value` 接受 `object | string` 联合,内部 normalize:
- 传 object → 直接用,zod 校验
- 传 string → `JSON.parse` 后用(向后兼容旧 LLM 调用)
- schema 描述写「JSON 对象(或 JSON 字符串)」,LLM 自然倾向传 object

这样**不 breaking**:旧调用传 string 仍工作,新调用传 object 更直观。下个大版本(3.0)可考虑删 string 支持。

**token 影响**:工具 schema 描述略增(~5-15%,因嵌套 object schema),但 LLM 出错率显著下降,值得。

### 2.3 分层呈现(toolMode 三档,核心修正)

**不强行收敛工具**,而是分层呈现,默认零缩水:

| toolMode | LLM 看到的工具 | 适用场景 | 缩水? |
|---|---|---|---|
| `simple`(默认) | `read`/`write` + query/search/eval/snapshot 全在,systemPrompt 主推 read/write | 通用,主推直观但高级能力仍可用 | ❌ |
| `advanced` | 现状 13 工具平铺(完全等价) | 复杂场景,LLM 需精细控制 | ❌ |
| `minimal` | 真的只 read/write | 小 JSON/纯调研,集成方显式选,接受高级能力缺失 | ⚠️ 集成方自选 |

**`read`/`write` 是高层封装,底层映射到现有工具**:
- `read(path?)` → 合并 list + describe + get 视图(一次返回 path + schema 摘要 + 当前值)
- `write(path, value, { patch? })` → patch 有则映射 edit_data_slot(jsonPath),无则映射 set_data_slot;自动取 hash + 自动存快照
- query/search/eval/snapshot 仍独立暴露(simple/advanced 模式),minimal 模式才隐藏

**systemPrompt 主推**:simple 模式下,usageHints 注入「优先用 read/write,需筛选/批量/回退时用 query/search/eval/snapshot」,引导 LLM 用直观工具但不封死高级路径。

### 2.4 自动乐观锁

`write` 内部自动取当前 hash 比对,LLM 不手动传 expectedHash:

- write 前自动 `getByPath` 取当前值算 hash,与 LLM 调 read 时返回的 hash 比对
- 不一致 → 自动挂起(复用现有 `pendingConflict`/`resolveConflict` 机制)
- **保留 opt-out**:`autoLock: false` 关闭自动锁(单 agent 独占、无并发场景),回退「不校验直接写」
- 旧 `set/edit_data_slot` 的手动 `expectedHash` 参数保留(advanced 模式),不删

### 2.5 输入输出拦截器(interceptors)

集成方可脱敏/转换/审计/拒绝 LLM 的读写:

```ts
createChatSdk({
  interceptors: {
    // LLM 读时拦截(读路径 → 集成方改写后返回给 LLM)
    read:  (path: string, value: unknown) => unknown,
    // LLM 写时拦截(集成方可转换 patch、审计、或拒绝返回 { error })
    write: (path: string, patch: unknown, current: unknown) => unknown | { error: string },
    // agent 接收输入时拦截(send/stream 的 input 预处理)
    input: (json: unknown) => unknown,
    // agent 产出输出时拦截(返回前 postprocess)
    output: (json: unknown) => unknown,
  },
})
```

- `read`:如隐藏 token、脱敏用户数据、派生计算字段
- `write`:如校验业务规则、转换格式、审计日志、拒绝非法修改
- `input`/`output`:agent 级 IO 预处理/后处理(配合 `io` 契约)
- 拦截器抛错则工具/调用返回错误,不中断 agent 循环(经 toolError 结构化)

### 2.6 明文绑定(响应式直连)

集成方直接把响应式对象绑给 sdk,读写自动同步:

```ts
const page = reactive({ title: '', components: [] })
const sdk = createChatSdk({
  bind: { page },                  // 明文绑定,底层注册为 dataSlot(path='page')
  io: { output: PageSchema },
})
// LLM write page → page 响应式自动更新;集成方改 page → LLM read 可见
```

- `bind` 是 `dataSlots` 的语法糖:每个 key 自动注册为 1 个 dataSlot(path=key,schema 从 io 推断或 z.any)
- 与 `dataSlots` 并存:`bind` 适合「单/少对象直连」,`dataSlots` 适合「多 slot + 动态注册 + 字段白名单读」
- 底层仍走注册表 + schema 校验 + 乐观锁,不绕过安全边界

---

## 3. 兼容性矩阵

| 现有 API/行为 | 重构后 | 兼容策略 |
|---|---|---|
| `set_data_slot({ value: 'JSON字符串' })` | 接受 object \| string | 内部 normalize,string 仍工作(向后兼容) |
| `set_data_slot({ expectedHash })` 手动锁 | `write` 自动锁 | 旧工具保留 expectedHash 参数(advanced 模式),不删 |
| 13 工具平铺 | simple 默认(主推 read/write + 高级工具仍暴露) | `toolMode: 'advanced'` 完全等价现状 |
| `dataSlots` 注册表 | 保留 | `io`/`bind` 是上层快捷方式,底层仍注册为 dataSlot |
| `addDataSlot`/`removeDataSlot` 动态注册 | 保留 | 不变 |
| 字段白名单读(`whitelist`) | 保留 | read 继承 whitelist 选项 |
| `onAudit` 日志 | 保留 | + interceptors.write 可做更细审计 |
| `pendingConflict`/`resolveConflict` | 保留 | 自动锁复用同一挂起机制 |
| `snapshot/restore` | 保留 | write 自动存快照 + 独立工具仍可用 |

**核心原则**:任何现有集成方代码,不改动应继续工作。新能力是 opt-in。

---

## 4. 实施计划(L1→L2→L3)

### L1:JSON 直传 + 自动乐观锁(零缩水,先行,~半天)

**改动**:
- `dataSlotOps.ts`:`set_data_slot`/`edit_data_slot` 的 `value` 参数从 `z.string()` 改 `z.unknown()`(接受 object|string),内部 normalize:
  ```ts
  const val = typeof value === 'string' ? JSON.parse(value) : value
  ```
- schema 描述更新:「JSON 对象(或 JSON 字符串)」
- 新增 `autoLock` 选项(默认 true):set/edit 内部自动取 hash 比对,冲突挂起复用现有 onConflict
- 旧 `expectedHash` 参数保留(显式传则用手动锁,不传且 autoLock=true 则自动锁)

**测试**:
- selftest 新增:object value 直传校验通过;string value 向后兼容;autoLock 自动冲突挂起;autoLock=false 直接写
- e2e 新增:object value 端到端;autoLock 行为
- 现有 384+125 全绿(不破坏)

**发版**:minor(2.1.0),不 breaking

### L2:分层呈现 + 拦截器(零缩水,主目标,~1-2 天)

**改动**:
- 新增 `read`/`write` 高层工具(在 dataSlotOps.ts 或新 `tools/simpleIo.ts`):
  - `read(path?)`:合并 list+describe+get,返回 `{ path, description, schema摘要, value, hash }`
  - `write(path, value, { patch? })`:patch 有则 edit(jsonPath),无则 set;自动 hash + 自动快照
- 新增 `toolMode` 选项(`simple`|`advanced`|`minimal`,默认 simple):
  - simple:read/write + query/search/eval/snapshot 暴露,systemPrompt 主推 read/write
  - advanced:13 工具平铺(等价现状)
  - minimal:只 read/write
- 新增 `interceptors` 选项(read/write/input/output),在工具执行 + send/stream 调用处织入
- usageHints 中间件:按 toolMode 注入不同提示

**测试**:
- selftest:read/write 行为;toolMode 三档工具集;interceptors 各钩子
- e2e:inspect().tools 反映 toolMode;interceptors 端到端;simple 模式 LLM 行为(用 FAKE_LLM 模拟)
- 现有全绿

**发版**:minor(2.2.0),不 breaking(新工具 + 新选项,旧调用不变)

### L3:顶层 IO 契约 + 明文绑定(纯新增,~2-3 天)

**改动**:
- 新增 `io` 选项(input/output zod schema),自动注入 systemPrompt + 推断 dataSlot schema
- 新增 `bind` 选项(响应式对象直连),底层注册为 dataSlot
- 文档/示例主推 `io` + `bind` 声明式用法

**测试**:
- selftest:io schema 注入 systemPrompt;bind 响应式同步;io + bind 组合
- e2e:inspect() 反映 io/bind;端到端声明式用法
- 现有全绿

**发版**:minor(2.3.0),不 breaking

---

## 5. 测试策略

| 层 | 测试 | 覆盖 |
|---|---|---|
| 单元(selftest) | L1:value normalize(string\|object)、autoLock、opt-out | 新增 ~8 断言 |
| 单元(selftest) | L2:read/write 合并视图、toolMode 三档工具集、interceptors 四钩子 | 新增 ~15 断言 |
| 单元(selftest) | L3:io schema 注入、bind 响应式同步 | 新增 ~10 断言 |
| 集成(e2e) | L1:object value 端到端、autoLock 冲突挂起 | 新增 ~4 断言 |
| 集成(e2e) | L2:inspect().tools 反映 toolMode、interceptors 端到端 | 新增 ~6 断言 |
| 集成(e2e) | L3:声明式 io+bind 端到端 | 新增 ~4 断言 |
| 回归 | 现有 384+125 全绿 | 每 L 阶段必跑 |

**测试同步约定**:每 L 阶段的测试与代码同 commit,无测试不予发布。

---

## 6. 风险与未决问题

| 风险 | 缓解 |
|---|---|
| ② JSON 直传让工具 schema 描述变长(token 增 5-15%) | 嵌套 schema 用 `z.object` 精简描述;可配 `schemaDetail: 'brief'\|'full'` |
| ② value 联合类型(string\|object)让 zod 校验复杂 | 内部 normalize 后用原 schema 校验;联合只在入参层 |
| ④ 自动锁增加冲突挂起频率(误报) | `autoLock: false` opt-out;冲突判定可配 `lockTolerance` |
| ③ simple 模式 LLM 仍可能混用新旧工具(行为不一致) | systemPrompt 明确主推;read/write 是封装不是替代,底层一致 |
| ⑤ 拦截器抛错影响 agent 循环 | 捕获后转 toolError 结构化返回,不中断循环 |
| ⑥ bind 与 dataSlots 重叠致集成方困惑 | 文档界定:bind=单/少对象直连,dataSlots=多 slot+动态注册+白名单读 |
| L2 read/write 是新工具名,旧 systemPrompt 硬编码旧工具名需同步 | 文档迁移说明;usageHints 自动注入新工具推荐 |

**未决**:
- `read`/`write` 工具名是否复用 `read_data_slot`/`write_data_slot`?还是 `read`/`write`?倾向后者(简短直观)
- `interceptors.input/output` 与 `io` 契约的关系:input/output 拦截器是否只在声明 io 时生效?倾向独立可用
- `bind` 的 schema 推断:从 `io.output` 推断,还是 `z.any()`?倾向有 io 用 io,无则 z.any + 集成方自检
- 是否支持 `bind` 多对象(`bind: { page, user, config }`)?倾向支持,每个 key 一个 slot

---

## 7. 决策点(review 请确认)

1. **value 兼容策略**:object \| string 联合 normalize(推荐,不 breaking) vs 直接 breaking(3.0 删 string)?
2. **toolMode 默认**:`simple`(推荐,主推直观但不隐藏高级) vs `advanced`(等价现状)?
3. **autoLock 默认**:`true`(推荐,默认安全) vs `false`(默认不锁,需显式开)?
4. **read/write 工具名**:`read`/`write`(简短) vs `read_data_slot`/`write_data_slot`(与现有命名一致)?
5. **bind schema 推断**:从 io 推断 vs z.any?是否支持多对象 bind?
6. **L1 是否独立发版**:L1 不 breaking,可作 2.1.0 先发,让用户早受益?

---

> review 通过后,按 L1→L2→L3 顺序实施,每阶段代码 + 测试同 commit,测试全绿后发版。
