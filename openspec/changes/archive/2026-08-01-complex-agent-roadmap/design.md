# Design: complex-agent-roadmap(umbrella 规划框架)

> 规划框架 design:架构决策落地 + 分期依赖 + 体积策略 + 风险。各能力的具体实现 design 在其 Phase change。

## 1. 架构决策落地(决策 1 / 2)

### 决策 1:浏览器内自动化(零 Node 改动)

| 维度 | 落地 |
|---|---|
| 运行 | 无头浏览器(puppeteer/playwright)/ 页面后台常驻;SDK 现状 `ui:false` headless 即支持 |
| 持久化 | 浏览器 Idb/WebStorage(已有);跨设备/服务端由集成方走服务器 API |
| MCP transport | 浏览器侧 http/sse/websocket(不含 stdio) |
| 后台触发 | 集成方调度(定时/队列);SDK 提供 headless 单次/批量执行 |
| 放弃 | Node fs/数据库 backend、Node MCP stdio(未来真需再立跨环境提案) |

### 决策 2:分层默认(核心开 vs 高级 opt-in)

| 层级 | 能力 | 理由 |
|---|---|---|
| **核心默认开** | adaptive-planning(已做)/ **mission** / **working-memory** / **schema 分层披露** / summarization / dataOps / skills / subagent(只读)/ memory | 胜任复杂基线;大多数复杂任务开箱即用 |
| **高级 opt-in** | verify(烧 token,已有)/ **draft** / **subagent 可写** / **TraceSpan** / **structured-todos 层级** / **自动化层** | 有开销(token/性能)或安全权衡;显式开 |

`contextPreset: 'complex'` 从压缩预设升级为「complex 能力包聚合开关」(开核心 + 按需高级)。

## 2. 分期依赖图

```
Phase 1(独立,三大瓶颈)
  ├─ revive-mission-anchor          (无依赖)
  ├─ revive-cross-round-working-memory (独立中间件,解绑 C 组)
  └─ add-schema-tiered-disclosure   (无依赖)
       ↓
Phase 2(批量+联动)
  ├─ add-draft-write-commit         (依赖 vfs drafts 池,2.16 就绪)
  ├─ add-structured-todos-tier      (复用 update_todo;弱依赖 mission)
  └─ add-subagent-writable          (无依赖)
       ↓
Phase 3(可观测,独立)
  └─ revive-observability-tracing   (无依赖)
       ↓
Phase 4(自动化)
  └─ add-automation-layer           (依赖 Phase 3 可观测支撑错误恢复)
```

Phase 1 三者独立,可并行立项实施。Phase 2 的 draft 依赖 drafts 池(已就绪)。Phase 4 依赖 Phase 3。

## 3. 体积策略

每 Phase 实测 dist 增量(IIFE 现 1699KB / 阈值 1740KB,余 41KB):

- **核心开能力**(Phase 1)进主包 —— Phase 1 估 ~30KB,若 <40KB 接受主包(调 size 阈值),超则子路径隔离
- **高级 opt-in 能力**(Phase 2-4)体积大者走子路径 export `./complex`(主包不含,集成方按需 import)
- 数据驱动:每 Phase 原型先测体积,再定主包/子路径

## 4. 风险 + 缓解(摘自设计报告 §9)

| 风险 | 缓解 |
|---|---|
| mission capture 启发式误判 | 分层默认核心开但保留 `setMission` 显式 + 单关;复杂场景接受 capture |
| working-memory 段占 context | 只 pin 关键(path/hash/中间结论),非全量;体积阈值 |
| subagent 写越界 | writablePaths 前缀白名单 + path guard;越界 PATH_OUT_OF_SCOPE |
| TraceSpan 采集性能 | opt-in;采样可控 |
| 体积膨胀(核心开) | 子路径隔离高级;每 Phase 测体积 |
| 测试矩阵翻倍(分层默认) | light/complex + 核心开/高级开 多组合 selftest/e2e/browser |
| LLM 维护依赖图不可靠 | opt-in;扁平 fallback;evidence 可选 |
| 后台无人值守错误恢复 | 三档错误 + checkpoint + 任务级重试/跳过/人工介入;TraceSpan 可追溯 |

## 5. 验证(每 Phase 后)

- **50+ skill 量级压测**:索引注入体积 + load_skill 性能(确认知识层扛得住组件库规模)
- **几百 K 真实 JSON 实测**:用码良页面(或 complex-demo 扩到 50+ 组件),生成/改/问答各跑,定下期优先级
- **体积实测**:每 Phase dist 增量

## 6. 与现有文档的关系

| 文档 | 关系 |
|---|---|
| `doc/complex-agent-roadmap.md` | 详细设计报告(11 节),本 change 的 proposal 引用它 |
| `doc/capability-boundaries.md` | 当前能力边界;各 Phase 落地后边界从「做不到」移「能做」 |
| `openspec/deferred.md` | 5 提案重启(T1 已更新);本 change 是重启的 umbrella |
| 各 Phase change | 具体能力 design/tasks/specs;本 change 不重复 |
