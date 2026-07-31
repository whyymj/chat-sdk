# Design: fix-dataops-write-correctness

> 核心约束:**最小逻辑改动,纯修复**。两处缺陷都改 `dataOps.ts`,不抽函数、不动签名、不改契约。数组删除一处改四入口受益(汇聚点单一);白名单绕过两处重复代码各删一段。配套 selftest 白盒断言锁死回归。

## 1. 现状定位:两个缺陷的根因

### 1.1 白名单绕过(set_data / write set 重复代码)

**`set_data`(:487-530,泄漏点 :506-512)**:

```ts
pushSnapshot('set')
if (res.data !== null && typeof res.data === 'object') {
  if (allowKeys) {
    safeMerge(bindRef, res.data)          // ✅ 只写 schema 声明字段(res.data 经 safeParse strip 过)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const setKeys = new Set(allowKeys)
      for (const [k, v] of Object.entries(parsed)) {
        if (!setKeys.has(k)) (bindRef)[k] = v   // ❌ 把 LLM 原始 parsed 的未声明字段直接写回
      }
    }
  } else { restoreInPlace(bindRef, res.data) }
}
```

**`write` set 分支(:907-937,泄漏点 :924-930)**:与上**逐字相同**。

**为何是口子**:
- `res.data` 是 `schema.safeParse(parsed)` 的输出,zod 默认 strip 未声明字段 → `safeMerge(bindRef, res.data)` 这一步是安全的(只写声明字段)。
- 但紧接着那段绕过 `res.data`,回到**原始 `parsed`**(LLM 传入、未校验),把所有未声明 key 直接赋值给 bind。
- 注释(:506/:924)称本意是"写回 interceptors.write 补充的不可见字段",但:
  - `set_data` 工具**根本没接 interceptors.write**(全文 grep:`interceptors.write` 仅在 write:837 出现),所以 set_data 这段写回没有任何正当来源,纯口子。
  - `write` 接了 interceptors.write,但读的是 `parsed`(:925)而非"拦截器显式标记的受信任补充"。LLM 原始 value 里的未声明字段会原样进 bind。

**为何此前没炸**:白名单是 2.4+ 才加的,这段"写回"是同期作为"兼容 interceptors 补充字段"加的(注释语气是"修复"),但把信任源错放在 LLM 的 `parsed` 上。无测试覆盖 → 长期潜伏。

### 1.2 数组删除稀疏(汇聚点:deleteByPath)

**`deleteByPath`(:115-127)**:

```ts
function deleteByPath(obj, path) {
  if (!path || isUnsafePath(path)) return false
  const keys = path.split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null) return false
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (cur == null || !(last in cur)) return false
  delete cur[last]   // ❌ 数组元素也走这里 → delete arr[0] → 稀疏数组
  return true
}
```

**四条入口汇聚**:

```
delete_data({jsonPath}) ─────────────┐
write({patch:{jsonPath},del:true}) ──┤
edit_data({op:'remove',jsonPath}) ───┼─▶ deleteByPath(bind, jsonPath)
  (先 applyPatchToClone 验证,再 applyPatchToLive) │
eval_script patches {op:'remove'} ───┘
```

`applyPatchToLive` remove 分支(:349-350)调 `deleteByPath`;`applyPatchToClone` remove 分支(:326-327)同样调 `deleteByPath`(在深拷贝 clone 上做 schema 验证用)。**改 `deleteByPath` 一处,clone 验证与 live 落地、四条入口全修正**。

## 2. 解法

### 2.1 deleteByPath 区分数组(splice)

```ts
function deleteByPath(obj: unknown, path: string): boolean {
  if (!path || isUnsafePath(path)) return false
  const keys = path.split('.')
  let cur: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null) return false
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (cur == null || !(last in cur)) return false
  // 数组元素 → splice 移除(避免 delete 产生稀疏数组);对象属性 → delete(原语义)
  if (Array.isArray(cur) && /^\d+$/.test(last)) {
    cur.splice(Number(last), 1)
  } else {
    delete cur[last]
  }
  return true
}
```

**边界核对**:
- `Array.isArray(cur)`:只有父是数组才 splice;对象属性走 delete,零行为变化。
- `/^\d+$/.test(last)`:`components.0` 的 last='0' 命中;`components.foo`(对象属性)不命中,走 delete。负索引/非数字段不会误 splice。
- `0 in arr` 判定(:124 `!(last in cur)`):splice 前已确认 last 存在;splice 后元素前移、length 减 1,无 empty 槽。
- **schema min 约束**:`z.array(...).min(n)` 下,splice 后元素数 < n 会在 `edit_data`/`write` 的整体 `safeParse`(:898/:914)报错 → 拒绝写入。这是**期望行为**(集成方用 min 防删空),不变。原来 `delete`不减 length,min 约束形同虚设 —— 本修复让 min 约束终于生效。
- **isPathAllowed**:对 `ZodArray` 本就跳过索引段(:243-245),白名单校验不阻塞删除,无需改。
- **safeStringify/hashValue**:splice 后数组干净(无 empty),序列化与 hash 反映真实结构(原本带 null 的错误 hash 消失)。

### 2.2 严格白名单(删两处写回)

`set_data`(:505-512)收为:

```ts
if (allowKeys) {
  safeMerge(bindRef, res.data)   // 只写 schema 声明字段;未声明字段丢弃(白名单语义)
} else {
  restoreInPlace(bindRef, res.data)
}
```

`write` set(:921-930)删为同样的(去掉 :924-930 写回块)。

**为何直接删而非"限定信任源"**:
- `set_data` 无 interceptors,没有任何正当补充来源 → 必删。
- `write` 的 `interceptors.write` 返回值经 `payload = intercepted`(:847)→ `maybeParseValue`(:909)→ `parsed` → `safeParse` → `res.data`。集成方若用拦截器补充字段,正确做法是**在 schema 里声明该字段**(拦截器改值,不是增字段)。让拦截器绕白名单塞字段 = 破坏白名单契约。
- 引入 `allowExtraFields` 开关会让安全默认失效,违反"安全边界在 tool 层"原则(项目设计原则)。故不引入。
- 保留 `interceptors.write` 的"转换声明字段值 / 审计 / 拒绝"能力(它操作的是已声明字段,不触白名单)。

## 3. 测试策略

### 3.1 selftest 白盒(dataOps 模块)

在 dataOps 对应测试模块(`sec-02.ts` 或相邻)补:

```ts
// 白名单严格
// set_data 传未声明字段被挡
invoke('set_data', { value: { title: 'x', evil: 'leak' } })  // schema 只声明 title
assert(byName(bind).evil === undefined)                      // ❌ 修复前会 = 'leak'
assert(byName(bind).title === 'x')
// write(set) 同样
invoke('write', { value: { title: 'y', evil: 'leak2' } })
assert(byName(bind).evil === undefined)

// 数组删除 splice
bind.components = [{a:1},{a:2},{a:3}]
invoke('delete_data', { jsonPath: 'components.0' })
assert(bind.components.length === 2)            // 修复前 === 3(稀疏)
assert(0 in bind.components && bind.components[0].a === 2)  // 前移,无空位
// write del / edit remove / eval patches remove 同样 length 递减
// 对象属性删除语义不变
bind.meta = {x:1}; invoke('delete_data', { jsonPath: 'meta.x' })
assert(bind.meta.x === undefined && !('x' in bind.meta))
```

### 3.2 e2e

`tests/e2e/data-slots.mjs`:补一条"数组主数据删除子项 length 递减、无空位"断言(data-slots 已有 8 种 schema 覆盖,加一条数组删除用例)。

### 3.3 门禁

`npm test`(selftest 全过)+ `npm run build && npm run test:e2e`(e2e 全过)+ 断言计数同步。

## 权衡

- **为何不抽公共写函数**:`set/write` 的 set 逻辑重复是既存技术债,但抽函数属重构,混入修复会让 diff 难审、与 `refactor-module-extraction` 冲突面叠加。本变更保持"纯修复":两处各删 7 行,改动肉眼可见。抽离留给 refactor change。
- **为何删而非开关**:白名单是安全契约,提供 `allowExtraFields` 等于把"是否启用安全"交给集成方默认值博弈,违反"安全边界在 tool 层"。真要可写字段,schema 声明即可(白名单本就由 schema 派生)。
- **为何 splice 而不保留 delete+标记**:稀疏数组在浏览器/JSON/Vue 里几乎无人依赖,splice 是"删除数组元素"的唯一合理语义;保留 delete 语义需要集成方显式 opt-in,徒增概念。
- **schema min 拦截是 feature 不是 bug**:splice 让 min 约束终于能正确生效(原来 delete 不减 length,min 约束形同虚设)。

## 风险

- **依赖稀疏数组的集成方**(理论不应存在):序列化结果从 `[null,...]` 变干净 → 下游若硬编码 null 期望会 break。靠 e2e + 发布说明覆盖;概率极低。
- **依赖未声明字段写回的集成方**:bind 不再接收未声明字段 → 需改 schema 声明。发布说明明确;这是安全收紧,方向正确。
- **clone 与 live 一致性**:`applyPatchToClone`(验证用)与 `applyPatchToLive`(落地用)都调 `deleteByPath`,改一处两者同步,不会出现"验证通过但落地不一致"。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/tools/dataOps.ts:115-127` | `deleteByPath` 加数组 splice 分支 |
| `src/core/tools/dataOps.ts:506-512` | `set_data` 删未声明字段写回块 |
| `src/core/tools/dataOps.ts:924-930` | `write` set 分支删未声明字段写回块 |
| `src/core/__tests__/modules/sec-02.ts`(或对应 dataOps 模块) | 补白名单严格 + 数组 splice 白盒断言 |
| `tests/e2e/data-slots.mjs` | 补数组删除 length 递减断言 |
| `openspec/specs/page-agent-core.md` | 合入 2 条 Requirement(归档时) |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数同步 + 行为变化说明 |
