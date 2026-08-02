# Change: followup-from-live-llm-audit

> 真 LLM 全覆盖审计（4 agent:complex / 人工确认+嵌套 / 子agent+多agent / RAG,真 DeepSeek）后的后续项汇总。
> 记录审计发现的**潜在问题 + 优化建议**,分级规划,防丢失。非阻塞发布（本次 4 change + 2 修正 + isPathAllowed bug 修已全绿:772→780 selftest / 228 e2e / 12 browser）。

## Why

真 LLM 跑通 6 demo × 多场景,验证本次修改在真模型下可用（expose-schema 约束一次写对 / evolve dryRun+patches 主动用 / unify-error recoverable 回灌自纠 / memory+skills RAG 生效 / 子agent 委派+隔离 / checkpoint 回滚）。同时挖出 1 个 pre-existing bug（isPathAllowed discriminatedUnion,**已修**,见 archive change）+ 若干潜在问题/优化点。这些非本次引入的 bug,但影响健壮性/可达性/demo 体验,记录立项。

## 发现 + 分级

### P0 — browser test 全跑 flaky（潜在 CI 不稳）

- **现象**:全 browser 跑（12 spec）偶发 2 failed,**重跑全绿**;单独跑各 spec 都过(12/12)。
- **可能根因**(待诊断):① `waitForAgentIdle` 时序(全跑 dev server 负载,偶发超时);② 跨 spec 状态(indexedDB 虽每 test 新 context,但 `reuseExistingServer` + 同 origin,某 spec storage 残留);③ mock 拦截竞态(多 spec 累积 page.route?)。
- **诊断**:跑全 + `--retries` 看重试是否过;查 `waitForAgentIdle` timeout 是否不够;检查 spec 间 storage 隔离(尤其 page-demo spec 与 error-recovery spec 同用 page-demo demo 同 id `page-demo`,storage 命名空间共享)。
- **修复方向**:spec beforeEach 清 indexedDB / 加 `waitForAgentIdle` timeout / 冲突 spec 用独立 id 或 demo 支持 id 注入。
- **影响**:CI 不稳(偶发红,重试过),不阻塞但损信心。

### P1 — diff_data / history_data 的 usageHint 缺失（A 真测场景4）

- LLM 拿到 `history_data` 快照后**绕过 `diff_data`**,用 todos 中间件手动对比。`diff_data`（evolve 新增 advanced）未被触发。
- `history_data`（evolve 新增 simple）虽被主动调,但 usageHints 没提示（靠 tool description）。
- **建议**:usageHints 补一条「对比快照差异优先用 `diff_data` 得结构化 path→from/to;查历史值用 `history_data`」。延续 refine-dataops 的"能力可达性"模式（usageHints 分支 push 一行,可扩展）。

### P1 — offset 翻页未压测（A 真测场景2）

- LLM 主动带 `limit`（refine 的 usageHint 分页提示生效 ✅）,但 demo 数组只 25 个 < 默认 limit 50,一次读完 `hasMore=false`,**offset+=limit 翻页路径未被真模型走到**。
- **建议**:补 browser CI 用例 —— 构造 60+ 元素数组 + mock LLM 多轮 `read(offset,limit)` 分页,验证翻页行为（offset 推进 + hasMore 翻页 + 末页）。固化分页可达性回归。

### P1 — rag-demo.spec.ts 缺（D 真测固化）

- D 真测验证 memory 异步注入（setMemory/refreshMemory 切换）+ load_skill 渐进披露,但 `tests/browser/rag-demo.spec.ts` **不存在**（同 nested-demo 之前缺,已由本批补）。
- **固化**:mock memory 异步注入（createChatSdk `memory` 求值后,断言 `inspect().systemPrompt` 含 memory 内容）+ mock LLM 调 `load_skill`（断言加载全文 + 重复加载提示）。memory 真实"引用"靠真 LLM,mock spec 测注入链路 + load_skill 加载。

### P2 — planner-demo systemPrompt 不够强制（C 真测 ⚠️,非 SDK bug）

- `use_planner` 路由对、子 agent 委派对,但主 agent 拿方案后**未 write 落地**（停在"委派完了"）。判定:**非 SDK bug**,是 planner-demo systemPrompt 不够强制 + DeepSeek 倾向"委派完等用户定"。
- **改进**:`examples/planner-demo/App.vue` systemPrompt 加「收到 planner 方案后**必须**调 write 落地其中一套,不要只描述」。demo 体验改进,低优先。

## Non-goals

- **retry 集成 e2e**:selftest sec-09/08 已兜底纯逻辑(429/5xx/4xx/abort/maxRetries/quota 全覆盖);集成(createChatSdk+LLM 抛错→retry→emit)需 BaseChatModel stub,成本高、脆弱、边际低。
- **mcp-demo / proxy-demo spec**:需额外起 server(mcp:mock/proxy:mock),browser spec 复杂;留运行时手动(CLAUDE.md §4)。
- **animation-demo spec**:UI 动画,非 LLM 行为,Playwright 动画断言脆弱。
- **subagent/multi-agent spec**:C 真测过,但 spawn/use_<id> mock 序列复杂(子 agent 嵌套),中价值,按需。

## 扩展性

- **flaky 诊断 + spec 隔离**:为未来加更多 browser spec 打基础(避免跨 spec 状态污染,CI 稳)。
- **usageHints 加 diff/history**:延续 refine-dataops 的"能力可达性"模式(push 一行,可扩展)。
- **rag-demo spec**:同 nested-demo 模式(B/D 真测固化 → 确定性 mock 回归)。

## Impact

- P0 修:CI 稳(消除偶发红)
- P1:能力可达性补全(diff/history/offset 翻页/rag 固化)
- P2:demo 体验(planner 落地)
- 测试:browser spec +4(diff/offset/rag/隔离强化),selftest usageHints 断言补
- 向后兼容:全部（usageHints 加提示 / demo prompt 改 / spec 补）
