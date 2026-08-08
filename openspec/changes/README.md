# 活跃 Changes 优先级索引

> **5 个活跃 change,均评估暂缓(等痛点驱动)**。2026-08-08 发布 **2.27.0**:`recall-and-trim-llm`(P1 召回 + trim LLM)+ `context-persist-resilience`(mission/workingMemory 持久化 + trim 收口 GC 归档)实施完成;`context-history-resilience` umbrella 归档(P1+A 收口;B 类决策 #2 维持「对话文本」模型;P2 其余 deferred)。已归档见 `archive/`。

## 全景盘点(均暂缓)

| change | 类型 | 工作量 | 完成度 | 暂缓理由 |
|---|---|---|---|---|
| harden-large-json-write | 大 JSON 写链加固 | M-L | A1/A5 已发布 | 剩 7 项性能/协同设计(A4↔placeholder) |
| placeholder-protected-read-write | 精确值保护(freeze/verbatim) | L | 0/39 | 诉求未现 |
| agent-driven-compression | 压缩自决策 + `archive_to_vfs` 演进 | M-L | 0/40 | 压缩未成痛点(演进:无损搬迁) |
| chatdialog-component-split | ChatDialog 原子化重构 | L | 0/46 | 无功能价值 |
| focus-context | 上下文聚焦·指定组件精修 | M | 0/29 | 越界痛点未现 |

> 详见 [`deferred.md`](../deferred.md) 2026-08-08 块(暂缓理由 + 重启触发)。

## 写链串行约束(若重启)

harden(A4 子路径 hash)→ placeholder(freeze/verbatim),都改 `commitSetToBind`/`applyPatchesToBind` 同段,需串行。`fix-write-safety-bypass` 已发布(2.23),写链地基已稳。

## 维护约定

- change 归档(移 `archive/`)→ 从本表删除。
- 重启某项 → 从 deferred 移回,加本表 + `project.md`「进行中」。
