# Specification Delta: page-agent-core

> 本文件为 change `placeholder-protected-read-write` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 占位符替换读写(精确值保护)

系统对「需要精确保存的内容」提供占位符替换读写:read 侧把精确值换成稳定句柄(值不入 LLM 消息流),写侧强制精确性(freeze 拒绝 / verbatim 展开校验),配套资源存储与生命周期管理。全增量,默认零行为变化(未配 `data.resources` 不启用)。

- **冻结字段(freeze)**:`data.resources: [{ path, mode: 'freeze' }]` 声明只读字段;`read` 时该路径值替换为 `⟦frozen:<path>⟧`,精确值不入 LLM 消息流;任何写(整体 set / 增量 patch,前缀匹配)改冻结路径 → `FROZEN_FIELD` 拒绝,整体 set 的 merge 语义天然保留冻结值。LLM 需真值用 `resource_get` 显式取。
- **原样保留(verbatim)**:`mode:'verbatim'` 的路径,`read` 时值替换为 `⟦res:<handle>⟧`(懒注册:首次 read 当前 bind 值入库);写侧句柄展开回原值后再走 schema 校验 + merge,LLM 写非句柄新值且 ≠ 原值 → `VERBATIM_MISMATCH`(要改先 `resource_update` 再写回句柄),未知句柄 → `RESOURCE_NOT_FOUND`。
- **资源存储**:vfs 第四池 `resources`(`maxResourceBytes` 默认 4MB,池内 LRU + 字节水位);资源被池淘汰 → `RESOURCE_EVICTED` 显式报错(提示重注册)。LLM 工具 `resource_get/update/list/delete`(advanced 暴露,`update` 仅 verbatim、freeze 拒绝);SDK API `createResource/getResource/updateResource/deleteResource/listResources/releaseResources`。
- **生命周期**:懒注册(首次 read 受保护路径自动入库);`setData` 替换清空资源(路径可能失效,与快照/hash 重置一致);checkpoint save/restore 随 vfs 天然保存/恢复;dataOps 快照/restore 不受影响(bind 恒持原始值,占位符只在读写边界替换);显式释放经 `resource_delete` / `releaseResources`。
- **跨压缩 pin**:augmentPrompt 每轮注入「受保护资源」段(path→mode→handle,从资源清单生成,不调 LLM),与 workingMemory/mission 同机制(state 中天然跨压缩,无需改 summarization);压缩后 LLM 仍知哪些字段被保护及句柄。
- **作用域与匹配**:占位符替换仅作用于**结构化读**(read/describe/get_data);query_data/search_data 显式查询、eval_script 沙箱返真值,由写侧强制兜底。freeze 匹配按 jsonPath **段边界**;verbatim handle 为**路径派生短哈希**(值变句柄不变);受保护路径当前无值 → 懒注册 skip。
- **整体写回显识别**:整体写(write set / set_data / draft_commit / eval transform)前置沿受保护路径 normalize —— LLM 原样带回的占位符视为**未修改**:freeze 回显 `⟦frozen:<path>⟧` 跳过保留当前值(占位符字符串不落 bind);verbatim 回显 `⟦res:<handle>⟧` / 经 resource_get 拿到的原值视为未改放行;verbatim 写新值 ≠ 原值 → `VERBATIM_MISMATCH`。
- **受保护路径不可删除**:`remove`/`delete` 命中冻结路径 → `FROZEN_FIELD`;命中 verbatim 路径 → 默认拒绝(先 `resource_delete` 释放再删)。
- **批量错误定位**:批量 patches 任一受保护路径违规 → 整批拒绝(原子),错误信息带 `patches[i]` 定位与原因,便于 LLM 精准自纠。
- **写侧展开一致性(自愈)**:展开 verbatim 句柄时比对「资源池值 vs bind 当前值」,不一致(bind 被 restore_data / importData / setData / 外部代码改过)→ 以 **bind 当前值为准自动重注册**(句柄不变),按未修改放行,防展开旧值覆盖回退/导入的新值。`resource_update` 须标 dataOps 脏,保证 checkpoint 快照内池与 bind 同版本。
- **强制层覆盖全部写路径**:freeze/verbatim 强制为独立函数,在整体写(commitSetToBind)、增量 patch(applyPatchesToBind)、**eval transform 整体替换**(独立落地路径)三处调用;`write({dryRun})` 与 `draft_commit` 同样覆盖。
- **行为约束**:全增量,API 零破坏;`data.resources`/`maxResourceBytes` 新配置有默认;现有数据/写路径用户零影响(bind 恒持原始值,hash/A4 子路径 hash/快照/乐观锁不受影响)。
