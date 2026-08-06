# page-agent-sdk 复杂任务能力边界报告

> **用途**:系统梳理 SDK 当前「能做 / 做不到」的复杂任务边界,作为后期优化的参考。遇到新任务可对照判断「能不能做」「触哪条边界」「怎么解锁」。
> **定位**:框架无关的**轻量页面 JSON 操作 Agent**(规范化 JSON 操作通道:范围控制 + schema 校验 + 增量 patch + 快照回退)。非通用任务编排框架。
> **维护日期**:2026-08-01。与 [`openspec/deferred.md`](../../openspec/deferred.md)(change 视角的暂缓清单)、[`openspec/changes/2026-08-01-add-adaptive-planning/decision-record.md`](../../openspec/changes/2026-08-01-add-adaptive-planning/decision-record.md)(自适应规划选型)互补。

---

## 1. 能力栈(现状能做的复杂任务)

| 能力 | 解决什么 | 来源 | 典型场景 |
|---|---|---|---|
| 多步 JSON 操作 | 安全读写主数据(范围 + schema + 乐观锁 + 快照) | 核心 dataOps | 改字段 / 调样式 / 加组件 |
| 大 JSON 处理 | 分页读 / 批量改 / 预检 / 子树计算 | 2.17.0 | complex-demo 10 组件、百元素数组 |
| 自适应规划 | 按复杂度分流 + 动态增量修订 + 防死循环 | add-adaptive-planning | 多步配置任务、低代码搭建 |
| 子 agent 委派 | 只读调研隔离 / 并行 / 预声明路由 | 核心 subagent | 规划-反思-执行、并行检索 |
| 人工确认 + 冲突介入 | 高风险 / 方案选择 / 乐观锁冲突三选一 | approval + conflictManager | 不可逆操作、多方案拍板 |
| verify 自纠 + checkpoint | 写后读回 / 整体回滚 | verify + checkpoint | 操作出错回退 |
| 上下文管理 | 压缩 + 关键词召回 + 预设档 | summarization + contextPreset | 长会话、复杂任务(complex 预设) |
| RAG 知识库 | memory 异步注入 / skill 渐进披露 | memory + skills | 文档问答、领域知识 |
| MCP 远程工具 | 动态注入外部工具 | mcp client | 接外部能力 |
| 环境探查(排查调试) | 读 window 环境/URL/视口/集成方调试变量 | `inspect_env`(2.18+,默认开) | 排查「为何没生效」、看页面运行环境 |

**典型能扛的复杂场景**:低代码页面搭建(complex-demo)、多步配置、嵌套树编辑、RAG 问答、规划-反思-执行编排、大数组分页操作。

---

## 2. 能力边界(做不到 + 为什么 + 怎么解锁)

> 每条边界都是**主动评估后暂缓**的(见 deferred.md),非遗漏。边界存在的核心理由:SDK 定位是「轻量页面 JSON 操作 Agent」,以下能力会把它推向「重型任务编排框架」(LangGraph/CrewAI 方向),违背初衷。

### B1. 复杂依赖任务(显式「A 依赖 B」依赖图)

- **现状**:todos 是扁平列表(write_todos / update_todo),无 parentId / deps / 依赖阻塞状态。「检索→决策→写入」依赖链难表达。
- **为什么**:LLM 实测难可靠维护依赖图(漏填 id / 循环依赖 / 标 completed 但 deps 未完成);框架渲染阻塞状态增 prompt 体积。扁平列表 + 顺序 + prompt 引导对页面场景足够。
- **对应提案**:⏸ `add-structured-todos-and-subagent-writes`(整个暂缓)
- **重启触发**:出现「复杂依赖任务(显式 A 依赖 B)」真实反馈,扁平列表无法表达,**且 mission-anchor 已落地**
- **升级路径**:update_todo schema 增 `parentId?`/`deps?`;renderTodos 递归渲染 + 阻塞状态。**前置**:先做 mission-anchor
- **工作量**:~120 行 + 层级渲染 + 测试

### B2. 跨轮记忆中间态(path / hash / 中间结论)

- **现状**:`preserveLastToolResults` 默认 `['describe_data','read']` 跨压缩保留;`lastReadHash` 是闭包变量,跨压缩不持久。复杂任务触发压缩后,query/search 的 path、读回 hash 可能丢。
- **为什么**:`cross-round-working-memory` 绑定 C 组(依赖未实现的 draft + 暂缓的 mission);「永不压缩的工作记忆段」是另一种 context 占用,可能抵消压缩经济性。
- **对应提案**:⏸ `add-cross-round-working-memory`(先扩 preserve 默认替代)
- **重启触发**:扩 preserve 默认后,复杂任务下「压缩丢 path/hash」仍成瓶颈
- **当前缓解**:`contextPreset: 'complex'` 扩 preserve 含 query/search;read 结果带 hash 每轮重算
- **升级路径**:独立「工作记忆」中间件,跨压缩 pin 关键 path/hash;与 summarization 协同
- **工作量**:~150 行 + 压缩协议改造

### B3. 子 agent 不能写(只读隔离)

- **现状**:子 agent(spawn_agent / use_<id>)默认只读,所有 write 集中主 agent。
- **为什么**:动「只读隔离」安全边界;writablePaths 白名单 + path guard 增复杂度;子 agent 写越界风险。
- **对应提案**:⏸ `add-structured-todos-and-subagent-writes` 的「子 agent 写权限」部分
- **重启触发**:子 agent「只读 + 返回结论」成为明确功能瓶颈(主 agent token 压力大)
- **升级路径**:subagents 配置增 `allowedTools?`(含 write)+ `writablePaths?`(jsonPath 前缀白名单);write 工具 wrap path guard,越界 `PATH_OUT_OF_SCOPE`
- **工作量**:~100 行 + path guard + 测试

### B4. MB 级单次 JSON 生成(已解锁:draft 分块)

- **现状**:`draft_write`/`draft_commit`(2.19+)分块构建超大 JSON → 原子提交。几百 K~MB 级单次 write 装 max_tokens 装不下时,LLM 分块 `draft_write` 累积到 vfs drafts 池(2MB),`draft_commit` 合并 + schema 校验 + 写 bind(失败草稿保留可修后重试,成功清草稿)。`draft_commit` 复用 `commitSetToBind`(与 write(set)/set_data 共用校验+快照+乐观锁链)。
- **为什么 opt-in**:`capabilities.draftWrite` 默认关(有 token/复杂度成本);`toolMode: 'advanced'` 暴露(simple/minimal 隐藏)。小改仍用 write/patch。
- **当前缓解**(未开 draft 时):分页 read + write patches 批量 + eval_script transform 分块计算。

### B5. 长任务目标锚定(防跑偏 / 压缩丢主线)

- **现状**:无任务级目标模型;原始 user 指令只在 messages[0],压缩后随 older 轮次被摘要/截断;长任务 LLM 可能偏离主线。
- **为什么**:proposal 自承「任务主线是 LLM 自律问题,非框架 invariant」;自动 capture 启发式误判风险高;4-Phase 重型演进路线。
- **对应提案**:⏸ `add-mission-anchor`(整个暂缓)
- **重启触发**:出现「LLM 频繁跑偏 / 压缩后丢主线」真实反馈,且 prompt 调整无法缓解
- **当前缓解**:summarization 压缩注入主数据 description;自适应规划(本次)引导 LLM 拆解;checkpoint 回滚
- **升级路径**:Mission 一等公民(capture + 压缩豁免 + spawn prepend);重启先做 Phase 1 最小版
- **工作量**:Phase 1 ~180 行;4-Phase 全做 ~600+ 行

### B6. 单主对象模型(非多对象关联)

- **现状**:`data: { schema, bind }` 单主对象;不支持多对象关联(如同时操作 user + order + product 关系)。
- **为什么**:页面操作场景典型单对象(页面配置 / 组件树);多对象关联是后端 ORM/编排框架需求。
- **对应提案**:无(定位决定,非暂缓)
- **升级路径**:如真需,集成方可挂多个 agent 实例(shareContext 或独立 id),各自管一对象;框架不内置多对象关联
- **工作量**:框架零改(集成方组合)

### B7. 结构化追踪 ✅ 已实现(2.19,Phase 3)

- **已能做**:结构化追踪 **TraceSpan 树**(`round`/`model`/`tool`/`compression` 4 埋点 + `timing`/`status`/`usage`)+ `getTraceMetrics(spans)` 纯函数(轮次/延迟/工具成功率/重试/压缩频次/token)+ `inspect().trace` + `onEvent('trace')` + DebugDrawer 🌳 Trace tab。`capabilities.tracing` opt-in(默认关,采集有性能开销)。详见 `usage-guide.md` §6.13。
- **仍不做**:APM 后端上报 / 分布式追踪(后端框架需求;集成方经 `onEvent('trace')` 自接 Datadog/Sentry 等)。
- **历史**:原 `observability-structured-tracing` 缩水版,`complex-agent-roadmap` 定位升级后重启为完整 TraceSpan 树(`revive-observability-tracing`,已归档)。

> **automation(2.20,Phase 4)也已实现**:无人值守自动化 —— 资源预算(`tokenBudget`/`timeBudgetMs`)+ 错误恢复(`maxAutoRetries`)+ 批处理(`sdk.batch`)+ 断点续跑(checkpoint 栈/usage 持久化恢复)。`capabilities.automation` opt-in(最远)。详见 `usage-guide.md` §6.14。
>
> ⚠ **本文档整体过时**:Phase 1-4 全部完成后,B1-B5/B7 多数已实现(todos 依赖 B1 / 跨轮记忆 B2 / 子 agent 写 B3 / draft B4 / Mission B5 / 追踪 B7)。下表「升级路径」为历史记录,多数已完成;待后续整体更新「能做/做不到」口径。

---

## 3. 升级路径矩阵

| 边界 | 解锁方案 | 前置依赖 | 工作量 | 真需求信号 |
|---|---|---|---|---|
| B1 依赖图 | todos parentId/deps | mission-anchor(B5) | ~120 行 | 显式依赖任务反馈 |
| B2 跨轮记忆 | 工作记忆中间件 | — | ~150 行 | 压缩丢 path/hash 瓶颈 |
| B3 子 agent 写 | writablePaths + path guard | — | ~100 行 | 主 agent token 瓶颈 |
| B4 MB 级 JSON | draft_write/commit | — | ~200 行 | 单次写不完场景 |
| B5 目标锚定 | Mission 一等公民 | — | ~180 行(Phase1) | 跑偏/丢主线反馈 |
| B6 多对象 | 多 agent 组合 | — | 0(集成方) | — |
| B7 追踪 | ✅ 已实现(TraceSpan 树 + getTraceMetrics,2.19) | — | 已完成 | — |

---

## 4. 判断框架(遇到任务能不能做)

```
新任务来了:
1. 是「读写集成方声明的主数据对象」范畴吗?
   · 是 → 大概率能做(看步骤 2)
   · 否(如:调度外部系统 / 长时后台任务 / 多租户隔离)→ 超出定位,建议集成方自建编排层

2. 触能力边界吗?对照 §2:
   · B1 显式依赖图?→ 当前用扁平 todos + 顺序 + prompt 凑;复杂依赖待 B1 解锁
   · B2 任务超长触发压缩丢中间态?→ 用 complex 预设 + preserve;仍不够待 B2
   · B3 要子 agent 写?→ 当前不行,write 集中主 agent
   · B4 单次生成 MB 级 JSON?→ 分块 patches / eval transform;不够待 B4
   · B5 长任务防跑偏?→ 自适应规划 + checkpoint;不够待 B5
   · B6 多对象关联?→ 多 agent 实例组合
   · 都不触 → 能做

3. 边界是否「真需求」触发?
   · 真实用户场景 vs 能力矩阵补全 —— deferred.md 标尺①
   · 满足重启触发条件 → 按 §3 升级路径解锁
   · 不满足 → 维持现状(prompt 软约束 / 集成方组合兜底)
```

---

## 5. 维护约定

- 本报告随能力演进更新:新增能力 → §1 加;新发现边界 → §2 加;边界解锁 → 移到 §1 + 标注版本。
- 边界对应的 deferred 提案状态变更(重启/合入)时,同步本报告 §2/§3 + deferred.md。
- 与 decision-record.md 的关系:decision-record 记录「某个 change 的方案选型」,本报告记录「整体能力边界全景」。
