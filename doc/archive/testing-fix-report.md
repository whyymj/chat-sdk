# 实测与修复复盘(2026-08)

> 真 LLM(DeepSeek-v4-pro)压力实测 complex-demo,暴露并修复的一系列 SDK 短板。本文档记录每个问题的现象/根因/修复/验证,供后续参考。

## 背景

本轮实测两个压力场景,验证 agent 在**大 JSON / 深嵌套 / 长工具链**下的胜任性:

1. **huge write 1M**(`complex-demo?huge=1`):扁平 800 组件 ~1M JSON,测 read 分页 / write patch 改单实例 / schema 分层披露
2. **深嵌套复杂专题页**(`complex-demo?deep=1`):真实专题页结构 + 递归 5 层 section>grid 嵌套(最深 12 段 jsonPath),测深路径 patch / workingMemory 跨压缩 / agent 长工具链稳定性

测试方式:browser-tester subagent 驱动真 LLM(拦截 DeepSeek SSE + DOM 探针),非确定性,多次运行。

---

## 问题与修复

### 问题 1:hugePage 实例字段不一致(1M 场景 SCHEMA_INVALID)

- **现象**:`?huge=1` 测试,agent read 实例字段后 write 同字段会 `SCHEMA_INVALID`
- **根因**:`hugePage.ts` 手写 `switch genComponent` 生成实例,字段名与 `pageSchema` 不一致:
  - `button` 用 `text`(schema 是 `label`)
  - `card` 用 `content`(schema 是 `text`)
  - `spacer` 用 `size`(schema 是 `height`)
- **修复**(`96ec55c`,#72):建 `defs/` registry——每组件一个 def 文件 `export { type, displayName, description, category, defaultProps }`(30 个,全经 `componentSchema.safeParse` 校验合规);`hugePage` 改读 `COMPONENT_DEFS` 的 `defaultProps` 循环生成(字段必然合规)
- **验证**:30 def safeParse 全过;`?huge=1` 真 LLM write 单实例 `components.2.props.alt` 成功(无 SCHEMA_INVALID)
- **收益**:同时覆盖全 30 类型(原手写仅 13)+ 删 ~30 行 switch

### 问题 2:DSML 静默截断(零错误冒泡)⚠️ 最危险

- **现象**:深嵌套实测 Run1,agent 长 tool-call 链(10+ 轮连续工具调用)后,DeepSeek-v4 的 function-calling **退化成正文里的 `<｜｜DSML｜｜>invoke` 标记**,harness 识别不到 tool_call → **静默当 final answer 结束**。UI 看不到任何异常(用户以为 agent "答完了"但其实没干活),`errorBar` 为 null,**零错误冒泡**
- **根因**:
  1. `detectGarbledToolCall` 正则漏 `<｜｜DSML｜｜>`——DeepSeek-v4 DSML 标记不含 "tool_call" 字样,而旧正则要求 `<｜｜[^>]*tool_call`
  2. 漏匹配/重试耗尽时直接 `onEvent('done') + return content` 静默收口
- **修复**(`abacdf9`,#73):
  1. 正则扩 `<｜｜?DSML｜｜?>` + DeepSeek tool 段标记(`<｜tool｜>`/`<｜tool_begin｜>`)
  2. 重试耗尽(`maxFormatRetries=2`)仍 garbled → `emit observable error(GARBLED_TOOL_CALL_EXHAUSTED)` 不静默
  3. garbled 时不跑 beforeReturn verify(garbled content 跑 verify 无意义)
- **验证**:sec-25 +5 断言(DSML invoke/alone/tool/tool_begin/中文正常回复);selftest 872 / e2e 247

### 问题 3:write value 形状混淆

- **现象**:深嵌套 Run1,agent 改单字段 title 时传 `write({value:{title:"..."}, patch:{op:"set", jsonPath:"...title"}})`——value 包成对象,patch set 后 title 字段变对象 → schema 报错(应是 string)
- **根因**:`usageHints` 示例 `write({value, patch:{op,jsonPath}})` 没说清 value 语义。实际 write 单 patch edit 的 value 来自**顶层 value 参数**(`createAgent.ts` dataOps 循环 `{op, jsonPath, value: payload}`,payload=value);agent 误以为 value 要带字段名对象
- **修复**(`e2f7063`,#74):`usageHints` 明确两姿势——
  - ① 改单字段:`write({patch:{op:"set", jsonPath:"路径.字段"}, value:新值})`,value 是该字段新值(string/number 直传,**勿包 {字段:值} 对象**)
  - ② 替换整个对象:`write({value:{整个新对象}})`
- **验证**:重跑 Run3 agent 直传 `value:"深路径已贯通-2026"`(string),write 成功无 schema 错

### 问题 4:DSML 被 rounds 预算挡(#73 残留缺口)

- **现象**:#73 修复后重跑,Run1 型(DSML 在 rounds 耗尽后出现)**仍静默死亡**:
  1. agent 串行单 read 用完 10 轮(`maxToolRounds=10`),rounds=10
  2. 第 11 轮 LLM 返回 DSML → 进 garbled 分支 → `format_retry` 触发(`formatRetries` 0→1,push feedback)→ `continue`
  3. `continue` 跳回 `while (rounds < maxToolRounds && ...)` → `rounds(10) < 10` = **false → 循环退出,重试没发生**
  4. `GARBLED_TOOL_CALL_EXHAUSTED` 要求 `formatRetries >= maxFormatRetries(2)` 才触发,但这里只到 1 → 走 `createAgent.ts:543` 模糊兜底文案静默死亡
- **根因**:`format_retry` 是**格式修正**,不消耗工具轮次(没执行工具),却被 `while` 的 `rounds` 预算挡——重试根本没机会发生
- **修复**(`d0cdf6f`,#75):加 `pendingFormatRetry` flag
  1. `while ((rounds < maxToolRounds || pendingFormatRetry) && iterations < maxIterations)`——让格式重试绕过 rounds 预算
  2. retry 分支设 `pendingFormatRetry = true`
  3. 收口(正常 final / garbled 耗尽 emit error / 有标准 tool_call)清 `pendingFormatRetry = false`
  4. `maxIterations(maxToolRounds*3)` 仍作死循环硬上限兜底
- **验证**:selftest 872 / e2e 247 / build;broker 代码追踪确认 4 个点位就位(while/retry 设 true/emit error/清 false);真 LLM 重跑 PASS(agent 走聪明策略未触发 DSML 退化路径)

---

## 观察但未修

- **read.jsonPaths 多路径未用**:深嵌套下 agent 逐层单 read(11 跳 = 11 轮 LLM,低效),没主动用 `read({jsonPaths:[...]})`。但探索场景 agent 不知深路径,逐层下探是合理行为;jsonPaths 适合**已知多路径**一次读。未修(prompt 引导收益不确定)
- **workingMemory 跨压缩深路径保留**:实测未触发上下文压缩(任务 6-8 轮收口,远未到窗口阈值),该能力未验到。需更长任务或人造压缩场景

---

## 过程问题(非 SDK,记录备查)

- **`doc/` 在 `.gitignore`**:commit doc 文件需 `git add -f <显式路径>`(普通 `git add doc/x.md` 报 ignored)。已入 memory([[doc-gitignore-requires-add-f]])
- **browser-tester 的 Playwright MCP 未注入**:退化用 node + playwright-core + 拦截 DeepSeek SSE 流 + DOM 探针采集。等效达成验证,但 `/browser-e2e` 命令的 MCP 配置值得查
- **README.zh-CN.md 计数落后**(782 vs 英文 867):顺带更到 872
- **DeepSeek 长 tool-call 链退化是概率性事件**:Run1(串行笨路径)触发 DSML,Run2/3(并行/query_data 聪明策略)不触发。单次实测未必复现,需多次或 mock 钉死

---

## 修复策略总结

**模式**:真 LLM 实测(broker 驱动浏览器 + 拦截 SSE)→ 定位(broker 代码追踪给行号 + 代码路径 + 日志)→ 修复(最小 diff,聚焦根因)→ 多维验证(selftest 单元 + e2e 集成 + build + 真 LLM 端到端重跑)

**优先级排序**:`DSML 静默截断` > `write value 混淆` > `read.jsonPaths 效率`。**静默失败最危险**(零错误冒泡,用户无感知),最高优先级。

**broker(subagent)的关键价值**:不只是跑测试,还做**代码追踪**——精准定位到 `createAgent.ts` 的 while 条件 / format_retry 分支 / 兜底返回的行号 + 代码路径,直接给出可执行修复建议(`(a) 绕过 rounds 预算` / `(b) 循环退出时触发 error`)。这是定位根因的关键。

---

## 教训

1. **静默失败是最大隐患**:DSML 退化→静默 final,UI 完全无感知,比显式报错危险得多。`emit observable error` 让失败可见是底线
2. **prompt 示例要无歧义**:`write({value, patch})` 的模糊示例直接致 agent 混淆。示例必须明确每个参数的**语义 + 反例**(「不要包成 {字段:值} 对象」)
3. **模型格式退化要兜底**:DeepSeek 长 tool-call 链下 function-calling 不稳定(退化成 DSML/伪 XML)。SDK 必须**探测(正则)+ 自纠(回灌 feedback)+ 兜底报错(emit error)** 三层防御
4. **重试预算要独立于工具预算**:`format_retry` 是格式修正,不消耗工具轮次(没执行工具),不该被 `maxToolRounds` 挡——否则工具用完就没法重试格式,陷入静默
5. **概率性 bug 需确定性测试**:DSML 退化是概率事件,真 LLM 多次跑未必触发(实测 3 次仅 Run1 触发)。回归保障要靠 mock 钉死退化路径(本轮未做,遗留)

---

## 遗留与后续

| 项 | 说明 | 状态 |
|---|---|---|
| #75 deterministic mock 测试 | mock BaseChatModel 的 stream/bindTools,「前 N 轮正常 + 第 N+1 轮强制 DSML + rounds 耗尽」钉死退化路径,验证 pendingFormatRetry 重试发生/emit error | 未做(成本中等,逻辑验证充分) |
| #57 码良级真 LLM 验证 | 更大端到端场景(低代码页面搭建全流程) | 待做(需 .env 真 key) |
| #66 扩组件到 ~80 | defs 机制已就位,加 def 文件 + index import 即可扩 | 用户暂缓 |

---

## 相关 commit(本轮)

| commit | 内容 |
|---|---|
| `96ec55c` | defs/ registry 30 组件 + hugePage 改用 registry(修字段不一致) |
| `d2d76b9` | 深嵌套复杂专题页生成器(`?deep=1`,递归 5 层) |
| `abacdf9` | DSML 静默截断修复(正则扩 DSML + emit error) |
| `e2f7063` | write value 引导明确化(usageHints 两姿势) |
| `d0cdf6f` | DSML rounds 预算挡残留缺口修复(pendingFormatRetry) |

## 关键文件

- `src/core/harness/createAgent.ts`:`detectGarbledToolCall`(49-58 行)+ 循环 garbled 自纠/重试/emit error(437-481 行)+ while 条件(412)+ 兜底(543)
- `src/core/harness/usageHints.ts`:read/write 引导(46 行 simple 模式)
- `src/core/tools/dataOps.ts`:write 工具四意图处理(601-709,单 patch edit value 来自顶层 value)
- `src/core/__tests__/modules/sec-25.ts`:`detectGarbledToolCall` 单测(含 DSML 标记)
- `examples/complex-demo/defs/`:组件定义 registry
- `examples/complex-demo/{hugePage,deepNestedPage}.ts`:1M 扁平 + 深嵌套测试数据生成器
