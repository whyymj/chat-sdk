# Design: evolve-default-toolset

> 核心约束:**工具集构成优化,不破坏 advanced / minimal**。精简与补缺配套(移走 list_data_snapshots 的同时补 history_data,防 simple 丢"看历史"能力);read/write 增强只加 optional 参数(旧调用零影响);diff_data 放 advanced 不占 simple 工具位。所有工具逻辑层经 selftest 白盒,工具集构成经 e2e inspect 反映。

## 1. 现状定位:simple 工具集的三个问题

**当前 simple 工具集(8 个数据工具,`filterByToolMode` :390-397)**:

```ts
const SIMPLE_HIDDEN = new Set(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data'])
// simple = 13 个 - 5 hidden = 8:snapshot_data / list_data_snapshots / restore_data / query_data / search_data / eval_script / read / write
```

**问题① 低价值工具占位**:`snapshot_data`(:606-616,手动命名快照)+ `list_data_snapshots`(:618-629,列表元信息)。自动快照 + `restore_data` 已覆盖回退;手动命名快照在 simple 场景 LLM 几乎不用。

**问题② 快照能力断档**:

```
list_data_snapshots → 只给 #id [op] time size(看不到值)
                      ┊
                      ┊  ← 空档:想"看上版内容"做不到
                      ┊
restore_data        → 破坏性回退(改坏当前)
```

LLM 想"看上一版"只能 restore(破坏)再想办法撤销 —— 实际几乎不会做,导致历史快照对 LLM 不可见。

**问题③ 单路径读 + 无预检写**:read 一次一 jsonPath;write 无 dryRun。改前多路探查费轮次,复杂批量改动靠试错。

## 2. 解法

### 2.1 精简 + 补缺配套(期一,核心)

**精简**:`SIMPLE_HIDDEN`(`:390`)加 `snapshot_data` + `list_data_snapshots`:

```ts
const SIMPLE_HIDDEN = new Set([
  'describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data',
  'snapshot_data', 'list_data_snapshots',   // 新增:被自动快照 + restore_data + history_data 覆盖
])
// 同步:diff_data(见 2.3)也加入,使其只进 advanced
```

simple 数据工具:13 - 8 hidden + history_data(新增,见下)= **6 + 1 = 7**:`read` / `write` / `query_data` / `search_data` / `eval_script` / `restore_data` / `history_data`。

**补缺 `history_data`**(进 simple):

```ts
const historyData = tool(
  async ({ id, jsonPath }) => {
    if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无快照可查看', hint: 'set/edit/delete 会自动存快照' })
    const entry = id !== undefined ? snapshots.find((s) => s.id === id) : snapshots[snapshots.length - 1]
    if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${id}`, hint: '用 list_data_snapshots(advanced) 查看可用快照序号' })
    let val = entry.value
    const jp = jsonPath || ''
    if (jp) {
      if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', ... })
      val = getByPath(val, jp)
      if (allowKeys) { const sub = getSchemaAtPath(schema, jp); if (sub) val = projectBySchemaDeep(val, sub) }
    } else {
      val = projectBySchema(val, allowKeys)  // 整体按白名单投影
    }
    return `快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}${jp ? ` @ ${jp}` : ''} = ${safeStringify(val)}`
  },
  { name: 'history_data', description: '只读查看某次快照(检查点)的内容,默认最近一次;可选 jsonPath 看子路径。不修改当前主数据(回退用 restore_data)。', schema: z.object({ id: z.number().int().optional(), jsonPath: z.string().optional() }) },
)
```

只读、复用现有 `snapshots` 栈 + 白名单投影;与 `restore_data`(写回 bind)的区别:**不调 `restoreLive`**,纯读。

### 2.2 read / write 增强(期二)

**read 多路径**(`:780` schema 加 `jsonPaths`):

```ts
schema: z.object({
  jsonPath: z.string().optional(),
  jsonPaths: z.array(z.string()).optional().describe('一次读多个子路径,返回 [{path,value}](各自投影);与 jsonPath 互斥'),
  fields: ..., depth: ...,
})
// 实现:if (jsonPaths?.length) return jsonPaths.map(p => ({ path: p, value: project...(getByPath(bindRef, p)) })) + 整体 hash
```

单 jsonPath 行为不变;多路径一次返回,省轮次。

**write dryRun**(`:822` schema 加 `dryRun`):

```ts
schema: z.object({ value, patch, patches, del, dryRun: z.boolean().optional().describe('预检:走完校验+patch 应用但不落盘不入快照,返回 {ok,preview,errors?}') })
// 实现:在 "pushSnapshot + applyPatchToLive/setByPath" 之前判 if (dryRun) return { ok:true, preview: cloneAfterPatch }
// 乐观锁冲突照常检测(handleConflict),dryRun 下返回冲突信息不挂起(用 expectedHash 比对但不调 onConflict)
```

四意图均支持;dryRun 走完校验链(schema safeParse + 白名单 + patch 应用到 clone)后返回"将要变成的样子",不落盘。

### 2.3 diff_data(期三,advanced 新增)

```ts
function diffObjects(a: unknown, b: unknown, prefix = ''): { path: string; from: unknown; to: unknown }[] {
  // 两者都是对象:递归比较 keys 并集
  // 两者都是数组:按下标递归(不按值匹配,保持简单 + 可预测)
  // 叶子或类型不同:记录 {path, from:a, to:b}
}
const diffData = tool(
  async ({ snapshotId, against }) => {
    const base = snapshotId !== undefined ? snapshots.find(s=>s.id===snapshotId)?.value : undefined
    const target = against ?? base
    if (target === undefined) return toolError({ code: 'MISSING_VALUE', message: '需指定 snapshotId 或 against', hint: 'diff 对比当前主数据与某快照/某 JSON' })
    const cur = allowKeys ? projectBySchema(bindRef, allowKeys) : bindRef
    return safeStringify({ diff: diffObjects(target, cur) })  // from=快照/against, to=当前
  },
  { name: 'diff_data', description: '对比当前主数据与某快照/一段 JSON 的差异,返回 {path,from,to}[]。用于核对改动、冲突诊断、自纠。', schema: z.object({ snapshotId: z.number().int().optional(), against: z.unknown().optional() }) },
)
```

`diffObjects` 纯函数(可单独导出 + 白盒测);`diff_data` 工具放 advanced(加入 `SIMPLE_HIDDEN`)。

## 3. 依赖方向(确保不循环)

```
dataOps.ts
  ├─> jsonUtils.ts(getByPath/projectBySchema 复用,若 refactor-module-extraction 已合)
  └─> 自身新增 diffObjects(零依赖纯函数,可后续随 refactor 抽到 jsonUtils)
```

`diffObjects` 是零依赖纯函数,本变更先放 dataOps.ts 内;`refactor-module-extraction` 若已合则直接进 jsonUtils,二者不冲突。

## 4. 测试策略

### 4.1 selftest 白盒

```ts
// filterByToolMode 新规则
assert(filterByToolMode(allTools, 'simple').map(t=>t.name) 不含 'snapshot_data'/'list_data_snapshots'/'diff_data')
assert(filterByToolMode(allTools, 'simple').map(t=>t.name) 含 'history_data'/'read'/'write'/'restore_data'/'query_data'/'search_data'/'eval_script')
assert(filterByToolMode(allTools, 'advanced') 含全部含 'diff_data'/'snapshot_data'/'list_data_snapshots')
assert(filterByToolMode(allTools, 'minimal') 深度等于 ['read','write'])

// history_data(只读)
bind.x = 1; invoke('set_data'...); // 自动存快照
const h = invoke('history_data', {})  // 默认最近
assert(h 含快照值); assert(bind 未变)  // 关键:不破坏当前
invoke('history_data', { id: 999 }) → SNAPSHOT_NOT_FOUND

// read 多路径
invoke('read', { jsonPaths: ['title','components.0.text'] }) → [{path:'title',...},{path:'components.0.text',...}]

// write dryRun
bind.x = 1
const r = invoke('write', { value: { x: 2 }, dryRun: true })
assert(r.ok === true && bind.x === 1)  // 关键:未落盘
invoke('write', { value: { x: 'bad' }, dryRun: true }) → 校验错误且 bind 未变

// diffObjects 纯函数
assert(diffObjects({a:1,b:2}, {a:1,b:3}) 深度等于 [{path:'b',from:2,to:3}])
assert(diffObjects({a:1},{a:1}) 为空)
```

### 4.2 e2e(inspect 工具集构成)

`tests/e2e/inspect.mjs` / `data-slots.mjs` 补:

```js
// simple 模式
const info = createSdk({ ..., toolMode:'simple' }).inspect()
assert(info.tools.map(t=>t.name) 不含 'snapshot_data'/'list_data_snapshots'/'diff_data')
assert(info.tools.map(t=>t.name) 含 'history_data')
// advanced 模式含 diff_data / snapshot_data / list_data_snapshots
```

### 4.3 门禁

`npm test` + `npm run build && npm run test:e2e` + 断言计数同步。

## 权衡

- **为何精简与补缺配套**:若只移走 `list_data_snapshots` 不补 `history_data`,simple 下 LLM 完全失去"看历史"能力(list 移走、restore 破坏)。`history_data` 是精简的**必要配套**,期一必须一起做。
- **为何 history_data 进 simple、diff_data 进 advanced**:history 是高频只读(填 list 移走后的缺口,必须 simple 可用);diff 是诊断/verify 用(低频、偏高级),放 advanced 不占 simple 工具位,控制 simple 数量。
- **为何 read 多路径而非新工具**:read 已是主读入口,加 optional `jsonPaths` 比新工具 `read_multi` 更自然(少一个工具位),且复用 read 的投影/hash 逻辑。
- **为何 write dryRun 而非独立 validate_data**:dryRun 合并进 write(写入口预检)比独立工具语义更连贯(同一参数即"这次只预演"),少一个工具位。validate_data 与 write dryRun 二选一,选后者。
- **为何数组 diff 按下标递归(不按值匹配)**:按值匹配(如"找到同 id 的元素对比")需要业务语义(id 字段名不固定),复杂且易错;下标递归简单可预测,LLM 易理解。需要"按 id 对比"的场景交给 eval_script。
- **工具数 trade-off**:simple 从 8 → 7(去 2 低价值 + 补 1 高价值),净 -1 但质量升;advanced 从 13 → 15(+ history + diff)。符合"simple 精简、advanced 全暴露"的 toolMode 设计。

## 风险

- **集成方依赖 LLM 在 simple 下调 `snapshot_data`/`list_data_snapshots`**:精简后调不到。靠 advanced 兜底(切 toolMode 即恢复)+ 发布说明。概率低(这俩本就低频)。
- **dryRun 与实际写的一致性**:dryRun 必须走与真实写**完全相同**的校验链(schema + 白名单 + patch 应用),否则预检结果不反映真实。靠 selftest"dryRun ok 的改动,去掉 dryRun 必成功"断言锁死。
- **diffObjects 对大对象的性能**:深递归大数组可能慢。加结果大小上限(offload 已有机制兜底,diff 结果超阈值转 vfs);实测后必要时加深度/数量限制。
- **read jsonPaths 的某个路径非法**:逐路径校验 isPathAllowed,非法路径在结果里标 `{path, error:'PATH_DENIED'}`(不整批失败),其余路径正常返回。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/tools/dataOps.ts:390` | `SIMPLE_HIDDEN` 加 `snapshot_data` / `list_data_snapshots` / `diff_data` |
| `src/core/tools/dataOps.ts` 新增 | `history_data` 工具(进 simple)+ `diff_data` 工具(进 advanced)+ `diffObjects` 纯函数 |
| `src/core/tools/dataOps.ts:780`(`read`) | schema 加 `jsonPaths`;实现多路径分支 |
| `src/core/tools/dataOps.ts:822`(`write`) | schema 加 `dryRun`;四意图实现 dryRun 预检分支 |
| `src/core/index.ts` | 导出 `diffObjects` 纯函数(供集成方/测试复用) |
| `types/index.d.ts` | 同步 `diffObjects` 类型(若导出) |
| `src/core/__tests__/modules/`(dataOps 模块) | 补 filterByToolMode 新规则 + history_data/diffObjects/read 多路径/write dryRun 白盒 |
| `tests/e2e/inspect.mjs` / `data-slots.mjs` | 补 simple/advanced 工具集构成断言 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement(simple 工具集构成 + history_data 只读 + read/write 增强) |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数 + 工具集变化说明(中英同步) |
