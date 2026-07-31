# Change: fix-dataops-write-correctness

> 配套:本变更修 `dataOps.ts` 写路径的两个正确性/安全缺陷 —— ① 白名单绕过(`set_data` / `write` set 把 LLM 传入的未声明字段无校验写回 bind);② 数组子项删除产生稀疏数组(`delete_data` / `edit remove` / `write del` / `eval patches remove` 全部 `delete arr[i]` 而非 `splice`)。两处同属 dataOps 写语义,合并一个 change 实施。与 `refactor-module-extraction`(纯抽离,不动逻辑)正交:本变更改逻辑,那个搬位置;建议本变更先合,或同 PR 时合并冲突仅在同文件行段,可控。

## Why

1. **白名单绕过是安全口子**。schema 为 `ZodObject` 时,顶层声明的 key 自动作为读写白名单(2.4+ 特性,核心安全卖点)。但 `set_data`(:506-512)与 `write` set 分支(:924-930)在 `safeMerge`(只写声明字段)之后,额外把 `parsed`(LLM 原始输入)里**不在 allowKeys 的字段直接赋值回 bind,无 schema 校验、无 UNSAFE_KEYS 过滤**。后果:LLM 只要在 `value` 里塞任意未声明字段就能写进 bind,与"仅 schema 声明字段可写"的承诺直接矛盾;集成方若把 bind 直接存库/渲染,会被注入未预期字段。注释称本意是"写回 interceptors.write 补充的不可见字段",但:① `set_data` 根本不接 `interceptors.write`(全文仅 `write:837` 接);② `write` 即便接了,读的是 `parsed` 而非拦截器返回值的受信任补充。该"能力"与白名单语义冲突,且无测试覆盖。

2. **数组删除产生稀疏数组,静默损坏数据**。`deleteByPath`(:115-127)对数组元素与对象属性一视同仁,统一用 `delete cur[last]`。删 `components.0` 执行 `delete arr[0]` → `[empty,{b},{c}]`(length 不变、留 empty 槽),而非期望的 `splice` 后 `[{b},{c}]`。后果链:① `JSON.stringify` 把 empty 转 null → `[null,{b},{c}]`,序列化/持久化/`hashValue` 全带 null;② 后续整体 `safeParse` 若 schema 为 `z.array(z.object(...))`,null 元素类型不符报错(看似莫名),或 null 通过但语义错;③ Vue reactive 数组留空位,UI 渲染异常;④ LLM 删完 `read` 发现 length 没变、首项变 undefined,认知断裂、浪费轮次。**四条删除入口全汇聚到 `deleteByPath`,全踩**:`delete_data`(:591)/ `write del`(:864)/ `edit_data op:remove`(`applyPatchToLive:350`,先 clone `:327`)/ `eval_script patches remove`(`applyPatchToClone/Live`)。

3. **两处"白名单写回"代码重复**。`set_data`(:506-512)与 `write` set(:924-930)是逐字复制的同一段逻辑,同一个 bug 各犯一次。修一处漏另一处等于没修。

## What Changes

### 1. 严格白名单:移除未声明字段写回

- 删除 `set_data`(:506-512)与 `write` set 分支(:924-930)中"从 `parsed` 取不在 allowKeys 的字段写回 bind"的逻辑块。
- 白名单模式下,bind 严格只接受 schema 声明字段(`safeMerge` 已保证);未声明字段一律丢弃(与 `read` 投影 / `isPathAllowed` 的白名单语义一致)。
- `interceptors.write` 仍可在 write 入口拦截/转换/拒绝;但它不能绕过白名单向 bind 塞未声明字段(集成方需要的可写字段应在 schema 声明)。
- **不抽公共函数**(保持本变更"纯修复",不混入重构;两处分别删除即可,代码量极小)。

### 2. 数组子项删除改 splice

- `deleteByPath`(:115-127):当父为 `Array` 且 last 段为数字索引时,用 `cur.splice(Number(last), 1)`;否则保持 `delete cur[last]`(对象属性语义不变)。
- 判定:`Array.isArray(cur) && /^\d+$/.test(last)`。
- 一处改,四条删除入口(`delete_data` / `write del` / `edit remove` / `eval patches remove`)自动修正。

### 3. 测试同步(selftest 白盒 + e2e)

- selftest dataOps 模块补:
  - 白名单严格:`set_data` / `write(set)` 传含未声明字段的 value → bind 不含该字段(被挡);schema 声明字段正常写入。
  - 数组删除:`deleteByPath(arr,'0')` / 各工具删数组子项 → length 减 1、无 empty 槽、元素前移;对象属性删除语义不变。
  - 边界:schema `.min(n)` 时删过头被 `safeParse` 拦(期望行为)。
- e2e `data-slots.mjs`:补"数组主数据删除子项 length 递减"断言。

## Impact

- **改造**:`src/core/tools/dataOps.ts` —— `deleteByPath`(:115-127)加数组分支;`set_data`(:506-512)、`write` set(:924-930)各删一段写回逻辑。
- **行为变化(向后兼容性)**:
  - 白名单绕过关闭:依赖"传未声明字段能写进 bind"的集成方(不安全隐式行为,理论不应存在)需改为在 schema 中声明该字段。**安全默认收紧,属修复而非破坏**(类比:漏掉的校验补上)。
  - 数组删除语义修正:`delete arr[i]`(稀疏)→ `splice`(移除)。依赖稀疏数组的场景(不应存在)会变;正常"删一项"场景从静默损坏变为正确。序列化/hash 结果随之变化(原本带 null 的现在干净)。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 2 条 Requirement(白名单严格写 / 数组子项 splice 删除)。
- **测试**:selftest 补白盒断言(两处);e2e `data-slots.mjs` 加一条数组删除断言。断言计数同步。

## Non-goals

- **不抽** `set/write` 的公共写逻辑为共享函数 —— 属重构,留 `refactor-module-extraction` 做;本变更保持纯修复,两处各改各的。
- **不引入** `allowExtraFields` 开关来"保留绕过能力" —— 会让安全默认失效,违反白名单语义;真需要可写字段请在 schema 声明。
- **不改** `interceptors.write` 的契约 —— 它仍是 write 入口的拦截/转换/拒绝点,只是不再能作为"绕白名单塞字段"的通道。
- **不改** edit/append 等非删除数组操作 —— append 已正确用 push(:340-342);本变更只治 remove/delete 的稀疏问题。
- **不动** `eval_script` transform 整体替换路径 —— 它走 `safeMerge`/`restoreInPlace`,不受稀疏影响(只有它的 patches remove 分支受益于 `deleteByPath` 修复)。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `deleteByPath` 数组 splice(治 #2,影响面广但改动局部) | 低 | ✅ patch |
| 期二 | 白名单严格(治 #1,两处删写回) | 低(安全收紧) | ✅ patch(叠加期一) |

两期都属 patch(向后兼容的安全/正确性修复)。可合并一次发布,也可期一先行。建议同 commit(同文件、同测试模块)。
