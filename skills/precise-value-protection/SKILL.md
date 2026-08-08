---
name: precise-value-protection
description: 识别需精确保存的字段(id/hash/token/长 verbatim/关键配置),正确处理 ⟦frozen⟧/⟦res⟧ 占位符读写,避免幻觉改错或压缩丢字
---

# 精确值保护(precise-value-protection)

## 何时用

当主数据含需精确保存的字段(集成方在 `data.resources` 声明 freeze/verbatim)时,read 会返回**占位符**而非真值。本 skill 指导你正确读写受保护字段,避免幻觉改错精确值(如猜一个"差不多"的 id/hash 写回)或长串被压缩丢字后重打错字。

## 占位符

read 受保护路径返回占位符(精确值不入你的消息流,从源头防幻觉/防丢字):
- `⟦frozen:<path>⟧` — freeze 字段(只读,精确值完全不可见)。
- `⟦res:<handle>⟧` — verbatim 字段(原值存资源池,handle 是路径派生短哈希,值变句柄不变)。

system prompt 的「受保护资源」段每轮列出受保护字段 + 模式 + 句柄(跨压缩保留)。

## 读

- read 受保护路径 → 占位符(非真值)。
- 确需真值(如展示/比对):`resource_get({path})` 或 `resource_get({handle})`(仅受保护路径)。

## 写

- **freeze 字段完全不可改**(集成方/系统维护,如 id/createdAt/状态码)。撞 `FROZEN_FIELD` 即**放弃该字段改动**,不要重试不同值。
- **verbatim 字段**(精确长串,如 token/hash/签名/原始配置):
  - 不改 → write 时**原样写回句柄** `⟦res:<handle>⟧`(整体 set 时把占位符带回,框架识别为"未改")。
  - 改新值 → 先 `resource_update({path, value})` 更新资源池(自动同步 bind),再 write 写回句柄。**直接 write 新值会 `VERBATIM_MISMATCH`**。

## 错误码应对

| 错误码 | 含义 | 应对 |
|---|---|---|
| `FROZEN_FIELD` | 改 freeze 字段 | 放弃该字段改动 |
| `VERBATIM_MISMATCH` | verbatim 写新值未先 update | 先 `resource_update({path,value})` 再写句柄 |
| `VERBATIM_PROTECTED` | 删 verbatim 字段被拒 | 先 `resource_delete({path})` 释放再删 |
| `RESOURCE_EVICTED` | 资源被池淘汰(LRU) | 重新 `read` 该字段懒注册重建句柄 |
| `RESOURCE_NOT_FOUND` | 句柄失效/字段未注册 | 重新 `read` 触发懒注册 |

## 识别需保护字段

集成方在 `data.resources` 声明,你无需自行判断。常见保护对象:唯一标识(id/uid/slug)、时间戳(createdAt/updatedAt)、签名/hash/token、长 verbatim 内容(原始文本/密钥/配置版本)。按 read 返回的占位符识别受保护字段。

## 关键不变式

- 占位符背后的精确值**永不在你的消息流里**(freeze 完全隐藏;verbatim 经 `resource_get` 按需取)。不要凭记忆猜测精确值写回 —— 要么写句柄,要么经 `resource_get` 取真值。
- 整体 set 时,受保护字段若不改动,**带回占位符**(框架识别为未改保留当前值);若改动走对应通道(freeze 不可改;verbatim 先 update)。
