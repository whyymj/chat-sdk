# Design: harden-optimistic-lock

> 核心约束:**hash 算法升级 + 语义文档化,不动协议**。乐观锁的 `expectedHash` 协议不变,LLM 透传;底层 djb2 → cyrb53 降碰撞。并发语义本就是"整体快照"(JS 单线程 + 闭包单例决定),只补文档防误解,不重构隔离。

## 1. 现状定位

### 1.1 lastReadHash 并发语义

**`dataOps.ts:408`**:`let lastReadHash: string | undefined`(闭包单例)。

- `read`/`get_data` 写入(:475 `lastReadHash = h` / :802)。
- `write`/`set`/`edit`/`delete` 在 `autoLock` 下读:`const effHash = expectedHash || (autoLock ? lastReadHash : undefined)`(:489 等)。

**并发场景**(`maxParallelTools > 1`,`runPool` 并发执行同轮工具):同轮 `[read(A), read(B), write(C)]` 并发。多个 read 并发写 `lastReadHash`(JS 事件循环串行化单次工具,但跨工具完成顺序不定)→ `write(C)` 的 autoLock 比对的是"最后完成的 read 的整体 hash"。语义上勉强成立(都是整体 bind hash),但**不可重现、难推理**,与"每个 write 基于自己上次 read"的直觉相悖。

### 1.2 hashValue 碰撞

**`dataOps.ts:202-209`** djb2:

```ts
function hashValue(value: unknown): string {
  const s = safeStringify(value)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0  // 32-bit
  return h.toString(36)
}
```

32-bit 空间,生日碰撞 ~2^16=65536 个对象 50%。后果:hash 恰好相等 → 乐观锁误判无冲突 → 静默覆盖外部修改。概率低但非零。

## 2. 解法

### 2.1 hashValue 换 cyrb53

```ts
/** cyrb53:53-bit 非加密 hash(碰撞空间 2^53,生日碰撞 ~2^26.5 ≈ 9500 万对象 50%)。零依赖纯函数 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

function hashValue(value: unknown): string {
  return cyrb53(safeStringify(value)).toString(36)
}
```

**为何 cyrb53**:53-bit、雪崩好、零依赖、已知实现(JS 社区广泛用)。碰撞空间 2^53 vs djb2 的 2^32,生日碰撞阈值提升 2^10.5 ≈ 1448 倍。非加密(不抗恶意碰撞,但乐观锁场景 LLM/集成方非对抗者,够用)。

**兼容性**:`lastReadHash` 闭包变量不持久化、不跨会话;`expectedHash` 由 LLM 同会话内 read→write 透传(算法一致即可)。换算法**同会话内自洽**,无跨版本/跨会话兼容问题。hash 值字符串格式变,但 LLM 不解析(只比对相等),集成方不依赖具体值。

### 2.2 并发语义文档化

`dataOps.ts:408` 加注释:

```ts
// 并发工具(maxParallelTools>1)下 autoLock 退化为"整体快照语义":
// 多个 read 并发写本变量(完成顺序不定),后续 write 比对"最后完成的 read 的整体 bind hash"。
// 单线程下单工具原子,但跨工具的"哪个 read 的 hash 被 autoLock 用"不可重现。
// 并发场景下若需精确乐观锁,LLM 应显式传 expectedHash(取自它自己那次 read 的返回值)。
let lastReadHash: string | undefined
```

`doc/usage-guide.md` 补一节"乐观锁与并发工具"。

## 3. 测试策略

### 3.1 selftest 白盒

```ts
// cyrb53 纯函数
assert(cyrb53('') !== cyrb53('a'))
assert(cyrb53('x') === cyrb53('x'))           // 确定性
assert(cyrb53('a') !== cyrb53('b'))
// hashValue
assert(hashValue({a:1}) === hashValue({a:1}))  // 同值同 hash
assert(hashValue({a:1}) !== hashValue({a:2}))  // 不同值不同 hash
assert(typeof hashValue({a:1}) === 'string')   // 返回 base36 字符串
// 碰撞边界(已知无碰撞样本,非穷尽,抽样断言)
assert(hashValue({a:1}) !== hashValue({a:2,b:1}) && hashValue([1,2,3]) !== hashValue([1,2,4]))
```

### 3.2 e2e

无需新增(算法替换,乐观锁行为经现有 e2e 覆盖)。

### 3.3 门禁

`npm test` + `npm run build && npm run test:e2e`(现有乐观锁 e2e 全过)+ 断言计数同步。

## 权衡

- **为何不重写 lastReadHash 为 per-call 隔离**:需把 hash 作为 read 返回值的一部分由 LLM 显式回传(即鼓励 `expectedHash`),弱化 autoLock。但 autoLock 的便利性(默认开、LLM 无需手动传 hash)是核心体验;并发场景文档化"整体快照语义"+ 建议"并发下用显式 expectedHash"更平衡。
- **为何 cyrb53 而非 SHA/加密 hash**:浏览器原生 `crypto.subtle` 异步 + 体积,乐观锁无需抗恶意碰撞(非对抗场景);cyrb53 同步、零依赖、雪崩够。
- **为何不引入版本化 hash(算法标识)**:hash 不持久化、不跨会话,无版本兼容负担;加标识徒增复杂度。
- **为何 hash 强度优先于并发隔离**:碰撞是"偶发误判无冲突"(低概率数据风险),并发语义是"可观测性差"(文档可解);先消概率风险(cyrb53),再补文档(并发),务实。

## 风险

- **hash 值变化影响外部观测**:若有集成方日志/断言依赖 hash 具体值,换算法后值变。属内部实现细节,发布说明提醒;乐观锁语义不变。
- **cyrb53 实现正确性**:用社区已知实现 + 白盒断言锁死(确定性 + 雪崩抽样)。
- **并发语义文档化不彻底**:文档无法强制 LLM 在并发下传 expectedHash;仅"建议",真正隔离仍需集成方理解。本期接受(彻底隔离需大改,另立 change)。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/tools/dataOps.ts:202-209` | `hashValue` 实现换 cyrb53 |
| `src/core/tools/dataOps.ts:408` | `lastReadHash` 并发语义注释 |
| `src/core/tools/dataOps.ts`(或 jsonUtils) | 新增 `cyrb53` 纯函数 |
| `src/core/index.ts` + `types/index.d.ts` | 导出 `cyrb53`(可选) |
| `src/core/__tests__/modules/`(dataOps) | `cyrb53` / `hashValue` 白盒断言 |
| `doc/usage-guide.md` / `doc/usage-guide.en.md` | "乐观锁与并发工具"章节 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数同步 |
