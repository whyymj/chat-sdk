# 活跃 Changes 优先级索引

> 7 个活跃 change 的**优先级 / 依赖 / 批次组织**。change 归档或新增时同步更新本表。
> 评估日期:2026-08-08(评审后更新,此前 12 个中 7 个已陆续归档/发布:fix-write-safety-bypass / tool-name-collision / context-inspector / simplify-toolset / skill-external-scripts / session-history-management / arch-review-p1-fixes)。已归档 change 见 `archive/`。
> `project.md`「进行中的 change」给一句话概览,本文件给**可执行的推进顺序与依赖约束**——两者不重复。

## 全景盘点

| change | 类型 | 工作量 | 完成度 | 状态 |
|---|---|---|---|---|
| **context-persist-resilience** | mission/workingMemory 跨刷新持久化 + trim 收口(`context_trimmed` 归档带 vfs + vfs 孤儿 GC) | M | 立项 | 🟢 待实施 |
| recall-and-trim-llm | 跨轮召回纳入 `steps.result` + trim 异步 LLM 增强(P1) | S | 完成 | ✅ 已实施(待发布) |
| **harden-large-json-write** | 大 JSON 写链加固(A1 安全/A5 提示已发;剩 7 项性能/协同) | M-L | A1/A5 已发布 | 🟡 主体完成 |
| **placeholder-protected-read-write** | 精确值保护(freeze/verbatim + vfs 第四池 + 4 新工具) | L | 0/39 | ⏸ 暂缓(诉求未现) |
| **agent-driven-compression** | 压缩自决策(inspect_context + CompressDecision) | M-L | 0/40 | ⏸ 暂缓(未成痛点) |
| **chatdialog-component-split** | ChatDialog 原子化重构(785 行拆 8 区块 + 6 子件) | L | 0/46 | ⏸ 暂缓(无功能价值) |
| **focus-context** | 上下文聚焦·指定组件精修(strict 拦写 + 三触发) | M | 0/29 | ⏸ 暂缓(越界痛点未现) |
| context-history-resilience | 长对话上下文韧性(umbrella) | — | proposal | ⏸ P1+A 收口后归档(B 类决策#2 维持模型;P2 其余 deferred) |

> 工作量:S ≈ 1-2 天 / M ≈ 3-5 天 / L ≈ 1 周+。

## 推进批次

**当前批次 · 在做**:`recall-and-trim-llm`(从 context-history-resilience 拆 P1,低成本高收益真实痛点:跨轮工具结果可召回 + 落盘摘要不再恒模板)。

**暂缓项(等痛点驱动,详见 [`deferred.md`](../deferred.md) 2026-08-08 块)**:
- `placeholder-protected-read-write`(精确值保护诉求真实出现时重启;与 harden A4 协同)
- `agent-driven-compression`(压缩质量成痛点时;前置 context-inspector 已就绪)
- `chatdialog-component-split`(集成方要求自建 ChatDialog 子组件 / 多套皮肤时)
- `focus-context`(大 schema 下 LLM 越界改无关字段成痛点时)
- `context-history-resilience` umbrella(P2-P3 + 6 待决策点,尤其 #2 持久化模型:对话文本 vs 工具结果根因)
- `harden-large-json-write` 剩余 7 项(A4 子路径 hash 随 placeholder 协同;A2/A3 性能优化;B2 vfs 无淘汰记录有实现障碍)

## 写链串行约束(若重启)

若 placeholder / harden A4 重启,仍需串行(都改 `commitSetToBind` / `applyPatchesToBind` 同段):

```
harden(A4 子路径 hash) → placeholder(freeze/verbatim 强制层)
```

> `fix-write-safety-bypass` 已发布(2.23),写链地基(applyPatchesToBind 写回取值源)已稳。

## 风险点

1. **写链剩余项耦合最密** —— harden A4 与 placeholder 乐观锁强绑定,先做可能被重设计推翻 → 绑定协同评估。
2. **chatdialog-split 风险最高** —— 785 行单文件拆分 + scoped CSS 跨边界归属(`.message-row.assistant:hover .msg-actions` 祖先选择器拆分后失效),重启须单独 milestone,每步迁移用既有 browser spec 锁契约。

## 维护约定

- change **归档**(移入 `archive/`)→ 从本表删除,在 `archive/` 留底。
- change **新增** → 加本表一行 + 归入对应批次;若碰写链核心,检查与 harden/placeholder 的串行关系。
- 评估结论变化(优先级 / 依赖)→ 更新本文件 + 同步 `project.md`「进行中的 change」段的一句指向。
