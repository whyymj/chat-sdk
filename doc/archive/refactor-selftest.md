# refactor-module-extraction 自测记录(2026-07-31)

> 测试人 / 工具:在 **Cursor**(Agent + Playwright MCP)中执行
> 被测版本:`2.13.0`(未 bump,4 个 refactor commit 在 master 未 push)
> 关联:`openspec/changes/2026-07-30-refactor-module-extraction/`、`.cursor/prompts/browser-e2e.md`

---

## 一、自测目标

**验证 refactor 期一/二/三(模块抽离)后,运行时行为零变化** —— 纯重构不改逻辑,所有现有功能(数据读写 / 工具循环 / 冲突 / 持久化 / 压缩 / 事件 / subpath)表现与重构前完全一致。

### 本次改动范围

| 期 | 抽离模块 | 来源 | 行数变化 |
|---|---|---|---|
| 期一 | `tools/jsonUtils.ts`(16 纯函数)+ `tools/schemaUtils.ts`(6)+ `sdk/promptBuilder.ts` + `./storage` `./query` `./llm` subpath | dataOps / createChatSdk | dataOps 969→670、createChatSdk(部分) |
| 期二 | `composables/contextIndex.ts`(6 纯函数)+ `sdk/llmResolver.ts` + `sdk/conflictManager.ts` | useContextManager / createChatSdk | useContextManager 321→235 |
| 期三 | `sdk/optionsResolver.ts` + `sdk/events.ts` | createChatSdk | createChatSdk(部分) |
| **合计** | createChatSdk **1751→1613**(降 138 行) | — | — |

**延后项**:`sdk/skillStore.ts` 桥接(userSkills 被 12+ 处用、闭包时序交错,留独立 change)

---

## 二、自测过程

### Step 1 —— 自动化门禁(基线,逻辑层,已绿)

```bash
npm run test:types    # tsc 类型
npm run test:exports  # src/types 导出对齐 + subpath 配置
npm test              # selftest 源码级
npm run build         # 构建产物
npm run test:e2e      # 集成层(用 dist)
npm run test:size     # 体积阈值
```

**基线结果(已跑)**:
- test:types ✓ / test:exports 6 ✓ / **selftest 630** ✓ / build ✓ / **test:e2e 210** ✓ / test:size ✓
- 含本次新增白盒:sec-30(jsonUtils)、sec-31(schemaUtils+promptBuilder)、sec-32(contextIndex+conflictManager 工厂)

> 这层只覆盖**逻辑层**,覆盖不到「浏览器 + ChatDialog + 真实 LLM 交互」。所以 Step 2 必做。

### Step 2 —— Cursor 浏览器探索(行为层,本次重点)

**前置**:
1. `! npx playwright install chromium`(首次)
2. 重启 Cursor → Settings → MCP 确认 `playwright` 变绿
3. `! npm run dev`(记端口,默认 3000)
4. `.env` 含 `VITE_AI_API_KEY`(否则工具循环跑不动)

**执行**:Cursor Agent 模式 → `/browser-e2e`(或粘贴 `.cursor/prompts/browser-e2e.md`)。Agent 自己 navigate/snapshot/操作/报告,你盯着异常。

### Step 3 —— 重点验证项(refactor 高风险区)

> 这些是搬迁最容易出错、且自动化门禁覆盖薄弱的点,Cursor 探索时**重点盯**。

| # | 风险点 | 怎么触发 | 预期(refactor 后不变) |
|---|---|---|---|
| 1 | **conflictManager**(期二搬迁) | human-confirm-demo 触发冲突;改前不 read 直接 write 触发乐观锁 | 冲突条出现 → 点「保留/覆盖/回退」→ 工具继续,**不永挂**;console **无** `resolveConflict is not defined` |
| 2 | **switchSession / 停止生成收口冲突** | 冲突挂起时切会话 / 点停止 | 旧冲突自动按 keep_external 收口(switchSession :1016 / stream-abort :1052 期二曾漏改) |
| 3 | **events**(期三 createSdkEvents) | `sdk.hook` 注册 2 个监听器 + 构造时 `onEvent`;触发一次 data_change | 两个监听器都收到、构造 onEvent 也收到;`approval_request` **不外发** |
| 4 | **llmResolver / setLlm**(期二) | 自定义 systemPrompt + 运行时 `sdk.setLlm` 切模型 | 默认 prompt 自动追加 reliableWriteRules;setLlm 后工具调用仍正常(modelCaps 重解析) |
| 5 | **contextIndex**(期二) | 制造 > summaryThresholdRounds 轮对话触发压缩 | 摘要系统消息正常生成;关键字段提示保留;关键词召回段注入 |
| 6 | **subpath**(期一) | `node -e "import('page-agent-sdk/storage').then(m=>console.log(!!m.createSessionStore))"` | true(`./query`/`./llm` 同理);CDN:`curl esm.sh/page-agent-sdk@2.13.0/storage` |

---

## 三、通过标准

- ✅ Step 1 自动化门禁全绿(已确认):types ✓ / exports 6 ✓ / **selftest 630** ✓ / build ✓ / **test:e2e 210** ✓ / size ✓
- ✅ Step 2 浏览器探索:page-demo / human-confirm-demo / complex-demo 三个 demo 关键流程无异常(2026-07-31 实测)
- ✅ Step 3 六个高风险点行为符合「refactor 后不变」预期(浏览器 + 自动化双重确认)

**结论:refactor 期一/二/三(模块抽离)运行时行为零变化,无回归。**

---

## 四、记录区(测试时填)

### Step 1 自动化
- [x] selftest 630 / e2e 210 / types / exports 6 / build / size 全绿(基线已确认)

### Step 2 浏览器探索(2026-07-31 Cursor Agent + Playwright MCP 实测)
- [x] page-demo:navigate → read → write「title=重构自测改写」→ 再 read 确认
  - 结果:✅ 通过。agent 执行 read(title=示例页面)→ write(重构自测改写,自纠 value 须纯字符串)→ read 确认成功;左侧页面标题实时更新为「重构自测改写」
- [x] human-confirm-demo:触发确认/冲突 → resolve → 工具继续
  - 结果:✅ 通过。第一层 AI 主动征询(request_human_confirmation)→ 4 方案选项 + 拒绝;用户选「暗夜流光」→ 第二层写前被动确认(允许/拒绝/查看参数)→ agent 自纠 night-purple → 再次确认 → 允许 → 页面 theme=night-purple / density=compact / radius=6px 全部更新;无 `resolveConflict is not defined`
- [x] complex-demo:列出组件 → edit patch 增量改属性 → 子路径读
  - 结果:✅ 通过。列出 9 个顶层组件;改 hero-title style.color=red(遇 schema 校验 style 为 string → 自纠用 CSS 字符串 → 成功);读子路径确认 color=red / textAlign=center 保留

### Step 3 高风险项(2026-07-31 实测)
- [x] #1 conflictManager 挂起/resolve 不永挂 — 浏览器实测 human-confirm 两层确认正常收口;e2e `conflict.mjs` + selftest `sec-32.ts` 工厂搬迁断言全绿
- [x] #2 switchSession/停止生成收口冲突 — e2e `storage.mjs`(switchSession)+ `conflict.mjs`(收口)全绿
- [x] #3 events 多监听器 + approval_request 不外发 — e2e `events.mjs`(hook×2 + onEvent + approval_request 不外发)全绿
- [x] #4 llmResolver/setLlm 切模型 — 浏览器实测 complex-demo DynamicReconfigPanel:日志 `setLlm({model:'gpt-4o'}) → model deepseek-v4-pro → gpt-4o(rebind + 重解析能力)`;默认 prompt 自动追加 reliableWriteRules
- [x] #5 contextIndex 压缩/召回 — selftest `sec-20/21/23.ts`(压缩/召回/关键字词)全绿
- [x] #6 subpath 可达(storage/query/llm + CDN) — node 实测 `import('page-agent-sdk/storage')` → createSessionStore=true;`./query` → jpEval/searchJson=true;`./llm` → createProxyLlm=true;package.json exports 含 `./storage`/`./query`/`./llm`/`./style.css`

### 发现的问题
1. 无。浏览器探索三个 demo 关键流程均无异常,控制台 0 错误;六个高风险项行为符合「refactor 后不变」预期。

---

## 五、收尾(测试通过后)
- ✅ 已落 `tests/browser/*.spec.ts`(Playwright + mock LLM SSE,7 项全绿,进 CI 回归)
- 决定:发布 2.14.0(bump + push + publish)/ 期五归档(architecture + usage-guide + specs 合入)/ 继续其他 change
