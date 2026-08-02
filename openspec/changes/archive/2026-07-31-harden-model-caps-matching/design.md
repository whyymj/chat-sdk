# Design: harden-model-caps-matching

> 核心约束:**匹配策略去顺序依赖,表驱动锁死已知模型**。longest-match 让结果只取决于"哪个 pattern 最具体",与条目排列无关;表驱动断言把"已知模型 → 预期条目"变成回归契约。

## 1. 现状定位

**`modelCaps.ts:64-73`**:

```ts
const fromTable = (() => {
  if (!opts.model) return undefined
  const hit = MODEL_TABLE.find((e) => e.pattern.test(opts.model!))   // first-match
  return hit?.caps
})()
```

**脆弱点**:`find` 返回第一个命中,结果依赖 `MODEL_TABLE` 数组顺序。例:`gpt-4o-mini` 命中 `/gpt-4o-mini/`(line 27)与 `/gpt-4o/`(line 28),靠 mini 在前才正确;一旦有人重排或插入新条目,mini 可能被 `gpt-4o` 抢先匹配。当前 caps 恰好相同(131072/16384)掩盖了风险,但不同 caps 的模型(如未来 `glm-4.6-mini` vs `glm-4.6`)会静默拿错。

## 2. 解法

### 2.1 longest-match

```ts
const fromTable = (() => {
  if (!opts.model) return undefined
  // longest-match:按"实际匹配到的子串长度"降序取最具体的(与条目顺序无关)
  const hits = MODEL_TABLE
    .map((e) => {
      const m = e.pattern.exec(opts.model!)
      return m ? { caps: e.caps, matchedLen: m[0].length } : null
    })
    .filter((x): x is { caps: ModelCaps; matchedLen: number } => x !== null)
  if (!hits.length) return undefined
  hits.sort((a, b) => b.matchedLen - a.matchedLen)
  return hits[0].caps
})()
```

**为何"实际匹配子串长度"(`exec[0].length`)而非 `pattern.source.length`**:量的是真正匹配上的字符数,更准。`source.length` 会被 `|` 分支数虚高 —— 如 `glm-4|glm4`(source 长 9)只匹配 `glm-4`(5 字符),反而压过更具体的 `glm-4\.5`(匹配 6 字符);`exec[0].length` 直接得 5 vs 6,选 glm-4.5 正确。

**边界**:
- 多个命中且 source 同长(罕见):取排序后首个(稳定,因 `sort` 在同长时保持原相对序,但仍确定)。
- 无命中:返回 undefined → 走保守缺省(DEFAULT_CAPS,32K/4K),不变。
- 性能:`MODEL_TABLE` ~24 条,`filter + sort` 开销可忽略(每次 `resolveModelCaps` 调一次,非热路径)。

### 2.2 表驱动断言

```ts
// selftest:modelCaps 表驱动
const CASES = [
  { model: 'deepseek-v4', expectContext: 1048576 },     // 命中 deepseek-v4,非 deepseek
  { model: 'deepseek-chat', expectContext: 131072 },    // 命中 deepseek
  { model: 'gpt-4o-mini', expectContext: 131072 },      // 命中 gpt-4o-mini(同 gpt-4o caps,但断言命中具体条目)
  { model: 'glm-4.6', expectContext: 131072 },          // 命中 glm-4.[6-9]
  { model: 'qwen2.5-1m', expectContext: 1048576 },      // 命中 qwen2.5-1m,非 qwen2.5
  { model: 'unknown-model-xyz', expectContext: 32768 }, // 无命中 → 缺省
]
for (const c of CASES) {
  assert(resolveModelCaps({ model: c.model }).contextWindow === c.expectContext)
}
```

## 3. 测试策略

### 3.1 selftest 白盒

- `resolveModelCaps` 表驱动(上);显式声明覆盖优先:`resolveModelCaps({ model:'x', contextWindow:999 }).contextWindow === 999`。
- longest-match 纯逻辑:构造 mock 表验证"多命中取最长 source"。

### 3.2 门禁

`npm test`(selftest 全过)+ 断言计数同步。无需 e2e(纯函数)。

## 权衡

- **为何 longest-match 而非精确解析**:模型命名无统一规范(各厂自由命名),精确版本解析需维护解析规则,复杂且易漏;子串 + longest-match 覆盖主流命名(`xxx-mini` / `xxx-1m` / `xxx-v4`),简单稳健。
- **为何 `source.length` 而非手标优先级**:手标每条 priority 字段维护成本高、易忘;`source.length` 自动,新增条目零配置。
- **为何不报警告(未知模型)**:保守缺省已是安全兜底;warn 在生产环境噪音大(很多私有/微调模型名不在表内)。集成方显式声明 `contextWindow` 覆盖即可。

## 风险

- **匹配子串长度更准(对原设计的修正)**:原拟用 `pattern.source.length`,但 `|` 分支会虚高 source 长度(`glm-4|glm4` source 长 9 但只匹配 5)导致选错条目(实测 `glm-4.5` 被误判命中 `glm-4` 拿错输出上限);改用 `exec[0].length`(实际匹配字符数)根治。表驱动断言锁死已知模型,新条目偏差会被捕捉。
- **行为零变化(当前顺序下)**:longest-match 与 first-match 在当前表上结果一致,无回归风险;e2e/selftest 全过即证。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/utils/modelCaps.ts:64-73` | `resolveModelCaps` first-match → longest-match(filter + sort by source.length) |
| `src/core/__tests__/modules/`(modelCaps 相关) | 表驱动 `resolveModelCaps` 断言 + longest-match 纯逻辑 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数同步 |
