# Change: fix-write-safety-bypass (P0 数据安全逃逸修复)

> 📦 **已归档(2026-08-07)**:P0-1(`applyPatchesToBind` 写回 `res.data`,与 `commitSetToBind` 共用真相源)+ P0-2(`parseGarbledToolCalls` DSML 强守卫标记必择 + 围栏剥离)已实施并随 **2.23.0** 发布;selftest sec-30/46 覆盖。tasks.md 未勾项为推后的 e2e 黑盒 / 已决策跳过的占比判定(proposal 决策 5)/ CHANGELOG 整理(已记入收尾任务)。

> 修复 2026-08-03 架构审查(3 agent 交叉)发现的 **P0 级数据安全逃逸**。
> **来源**:`dataOps` 写路径白名单绕过(编辑路径写回原始值)+ `createAgent` DSML 宽松解析把模型示例当真实工具调用执行。两处均可直接导致**未授权数据写入 / 原型污染**。
> **状态**:proposal(未实施)。P0 阻塞,建议优先 apply + 独立发布(patch 版本)。

## Why

审查确认(非理论,agent 已用真实源码端到端复现):

- **P0-1 编辑路径写回原始值绕过白名单**:`applyPatchesToBind`(`dataOps.ts:189-204`)对每个 patch 用**原始 `pVal`** 试跑、存进 `applied`、再 `applyPatchToLive(bindRef, ..., a.value)` 写回 **live 原始值**;而整体 set 路径 `commitSetToBind`(`:126-147`)用 `schema.safeParse` 后的 `res.data`(zod strip 掉未声明字段)。**同一次 schema 校验,set 干净、edit 脏**。
  - 实测(用真实 `applyPatchesToBind`):已声明路径 `set page`(值含未声明嵌套键 `secret`)→ 校验通过,`secret` **持久化到 live bind**;union 路径 `components.0.injected` → 持久化;值内嵌 `"__proto__":{"polluted":1}` own 键 → 绕过 `isUnsafePath`(它只查 path 不查 value),作为 own 键**注入 bind 元素**。
  - 读侧 `projectBySchemaDeep` 对 union 段返回原样 → 该字段还能被读回;对普通 ZodObject 段被投影隐藏 → 变成「LLM 看不见、UI 却可能渲染/遍历到」的**隐形垃圾**。后续整体 set 的 merge 语义「保留未声明字段防误删」→ **垃圾字段随会话累积**。
  - `__proto__` 子向量:`isUnsafePath` 只查 jsonPath 段,值内嵌 own `__proto__` 键落进 bind 后,宿主渲染代码的 `Object.assign`/`=` 会触发 setter → **原型污染风险移交宿主**。
- **P0-2 DSML 宽松解析把示例当真实工具调用执行**:`parseGarbledToolCalls`(`createAgent.ts:72-102`)的 `invokeRe`(`:74`)不要求 DeepSeek 守卫标记(`<｜tool_calls｜>`/`<｜｜?DSML`),纯文本 `<invoke name="set_data"><parameter name="jsonPath">title</parameter><parameter name="value">xxx</parameter></invoke>` 也命中;`(:82)` 不跳过代码围栏(模型贴 XML 示例 / 技能文档片段时同样命中)。命中后 `:560-570` **直接补 toolCalls 执行**,不走正常 tool_calls 通道的权限语义。
  - 失败场景:用户让模型「只示范 set_data 写法,不要执行」→ 模型正文贴示例 → 被当真执行**写入数据**。触发窗口恰是模型准备停下作答的收口轮,风险最高。

两者都是**默认路径**(approval 默认关、permissions 默认空),多数集成直接暴露。

## What Changes

### 1. 编辑路径写回 schema 解析值(P0-1)
- `applyPatchesToBind` 在 `schema.safeParse(clone)` 成功后,**对每个 applied path 从 `res.data` 提取解析后(已 strip)的值写 live**,而非 `a.value`(原始 `pVal`)。append/merge 需按路径从 `res.data` 取对应子树。
- 与 `commitSetToBind` 用 `res.data` 的语义对齐(代码注释声称的「单一真相源」目前并未真正统一)。
- **修复后验证**:已声明路径值内的未声明嵌套键不再持久化;`__proto__` own 键被过滤;union 路径注入任意键被拒。

### 2. DSML/伪 XML 解析收紧(P0-2)
- `parseGarbledToolCalls` 命中后先**剥离/跳过代码围栏**内容。
- **仅当 content 匹配到强守卫标记**(`<｜tool_calls｜>`/`<｜｜?DSML`/`<｜tool[_a-z]*｜>`)时才自动执行;纯 `<invoke name=` 而无 DeepSeek 内部标记 → 降级走下方 garbled-retry(回灌让模型用标准通道重发,**不执行**)。
- 至少要求 invoke 段占据非空白内容的绝大部分(去掉首尾自由文本再判定),防「一句说明 + 一个示例」被误执行。

## Impact

- **测试**:补 selftest(`applyPatchesToBind` 写回解析值 / `detectGarbledToolCall`+`parseGarbledToolCalls` 围栏与守卫标记边界)+ e2e(write(patch) 未声明字段不落 bind)。两个修复各自至少 1 条正向 + 1 条边界断言。
- **行为变化**:编辑路径写入结果与 set 路径对齐(未声明字段不再进入 bind)—— 这是**安全收紧**,符合 schema 白名单的既有契约,但集成方若依赖「edit 时未声明字段透传」则会发现行为变化(该行为本身就是 bug,无合规依赖)。
- **向后兼容**:DSML 收紧只影响「无守卫标记的 `<invoke>` 文本」场景(原本是误执行),正常 DSML 序列(带守卫标记)不受影响。
- **发布**:P0 修复建议独立 bump patch(如 2.22.2),不与其他功能混发。

## 决策

1. **edit 与 set 语义对齐为准**:schema 校验的单一真相源 = 解析后 `res.data`,两条写路径都从中取值。不保留「edit 透传未声明字段」的旧行为。
2. **DSML 收紧不删功能**:宽松匹配换「免重试」的设计权衡保留,但匹配条件收紧(守卫标记 + 围栏跳过),`detectGarbledToolCall`/`parseGarbledToolCalls` 纯函数签名不变,导出保持。
3. **补测试驱动**:两处修复都先写失败用例(复现:未声明字段落 bind / 围栏内 `<invoke>` 被解析),再改实现。
4. **(实施优化)P0-1 用方案 B2 整体写回,非原方案 A 逐 path 提取**:方案 A「append/merge 按路径从 res.data 取子树」对 **append 不成立**(append value 是单元素,无法从最终态定位该 patch 贡献的元素);方案 B2 直接把 `res.data`(所有 patch 应用 + zod strip 后最终态)整体写回 bindRef(allowKeys → safeMerge / 否则 restoreInPlace),与 `commitSetToBind` 完全一致,覆盖 set/merge/append/remove 全 op(remove 先 deleteByPath 因 safeMerge 浅合并不删 key)。实施完成,selftest sec-30 白盒覆盖。
5. **(实施优化)P0-2 跳过「invoke 段占非空白绝大部分」判定**:有「强守卫标记必择」(DeepSeek 内部 token,模型正文不会随意产生)后,占比判定边际价值低且有误伤真 DSML 风险(模型前后带思考文字);守卫标记 + 围栏剥离已足够挡「示例被当真执行」。占比判定留未来若发现新误执行模式再补。

## Non-goals

- 不做 P1 架构债(wrap-up 绕过中间件栈 / 并发 state 竞态 / beforeReturn 门禁 / subagent 工具快照 / switchSession 重置 / setMission 重捕)—— 独立 change:`2026-08-03-arch-review-p1-fixes`。
- 不做 P2 性能优化(单次 patch 7×O(N) / lazy 快照 / hash 记忆化 / 循环内渐进压缩)—— 同独立 change 附注或后续评估。
- 不做 `restoreInPlace` 补 `UNSAFE_KEYS` 防护(P1 防御性缺口,虽与 P0-1 同文件,先聚焦数据逃逸本体;可作为后续防御补强)。
