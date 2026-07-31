# Change: harden-optimistic-lock

> 配套:本变更加固主数据乐观锁的两处薄弱点 —— ① `lastReadHash` 是 dataOps 闭包单例,`maxParallelTools>1` 并发工具下语义模糊(竞态写共享变量);② `hashValue` 用 32-bit djb2,生日悖论下 ~65536 个不同对象有 50% 碰撞,乐观锁存在极低但非零的"误判无冲突"风险。与 `fix-dataops-write-correctness` 同文件(都改 dataOps),建议同 PR 或紧随。

## Why

1. **`lastReadHash` 并发语义模糊**。`dataOps.ts:408` 的 `lastReadHash` 是闭包级单例,`read`/`get_data` 写入(:475/:802),`write`/`set`/`edit`/`delete` 在 `autoLock` 下读取比对。当 `maxParallelTools > 1`,同轮多个工具并发执行:多个 `read` 并发写 `lastReadHash`(完成顺序不定),后续 `write` 比对的是"最后完成的 read 的整体 hash"。JS 单线程让单次工具原子,但跨工具的"哪个 read 的 hash 被 autoLock 用"不可重现、难推理,与"每个 write 应基于它自己上次 read"的直觉相悖。

2. **`hashValue` 32-bit 碰撞风险**。`dataOps.ts:202-209` 用 djb2 → 32-bit → base36。生日悖论:2^16=65536 个不同对象约 50% 碰撞概率。碰撞后果是"误判无冲突 → 静默覆盖外部修改",概率低但非零,与乐观锁的安全承诺不符。高频写场景(同会话大量操作)理论累积。

## What Changes

### 1. 明确并发语义(文档 + 注释)

- 在 `dataOps.ts` `lastReadHash` 声明处加注释:**并发工具下 autoLock 退化为"整体快照语义"**(用最后完成的 read 的整体 bind hash 比对);文档建议并发场景下 LLM 显式传 `expectedHash`(write 已支持)以精确控制。
- `doc/usage-guide.md` 补"乐观锁在并发工具下的语义"说明。
- **不改代码逻辑**(语义本就如此,只是未文档化,易误解)。

### 2. `hashValue` 升级 cyrb53(53-bit)

- `dataOps.ts:202-209` djb2 替换为 cyrb53(53-bit hash,碰撞空间 2^53,生日碰撞升至 ~2^26.5 ≈ 9500 万个对象)。
- 返回值仍 `toString(36)` 字符串(LLM 透传,不关心具体值,只比对相等)。
- `cyrb53` 作为纯函数(零依赖),实现后随 `refactor-module-extraction` 进 jsonUtils。

## Impact

- **改造**:`src/core/tools/dataOps.ts` —— `hashValue` 实现换 cyrb53;`lastReadHash` 处加并发语义注释。
- **新增导出**(可选):`cyrb53` 纯函数从顶层导出(供集成方/测试)。
- **行为变化**:`hash` 值字符串变化(算法换),但语义不变(乐观锁只比对相等,LLM 不解析值)。`lastReadHash` 闭包变量不持久化、不跨会话 → **无兼容性问题**(同会话内 read/write 用同一算法即可)。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(乐观锁语义 + hash 强度)。
- **测试**:selftest 补 `hashValue`/`cyrb53` 白盒(相同值同 hash、不同值不同 hash、碰撞边界);断言计数同步。

## Non-goals

- **不改** autoLock 的默认行为(默认 true)—— 并发语义文档化即可,不弱化默认。
- **不改** `expectedHash` 的协议 —— 它仍是 LLM 显式传的比对值,只是底层算法升级。
- **不引入** per-path hash —— 当前整体 bind hash 已满足"检测外部修改"目标;per-path hash 复杂度高、收益低(乐观锁粒度=整体足够)。
- **不重写** 并发工具的 hash 隔离 —— 那需重构 lastReadHash 为 per-call 上下文,改动大、与当前轮次模型不匹配;文档化"整体快照语义"更务实。
- **不动** `fix-dataops-write-correctness` 的写路径修复 —— 本变更只动 hash 算法 + 注释,不碰写逻辑。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `hashValue` 换 cyrb53 + 注释 | 极低 | ✅ patch |
| 期二 | 并发语义文档化(usage-guide) | 无 | ✅ patch(叠加) |

两期 patch。期一核心(hash 强度),期二配套(文档)。建议合并发布。
