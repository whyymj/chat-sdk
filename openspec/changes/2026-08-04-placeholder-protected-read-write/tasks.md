# Tasks: placeholder-protected-read-write(占位符替换读写:精确值保护)

> 关联 `proposal.md`。**独立 change**,无前置依赖。4 缺口:R1 读无占位符替换(正确性)+ R2 写无精确性强制(安全)+ R3 无跨压缩句柄 pin(鲁棒)+ R4 无资源生命周期(能力)。

## P0 · freeze 冻结字段(防幻觉错误修改,优先)
- [ ] **强制层独立函数**(§7c F1):`enforceProtected`(freeze 拒绝 / verbatim 展开 / C1 回显识别 / **D1 池值一致性自愈**)抽独立纯函数,在 **commitSetToBind / applyPatchesToBind / eval transform 整体替换** 三处调用 —— eval 整体替换(`dataOps.ts:578-596`)是内联独立路径不走 commitSetToBind,不单独加会漏
- [ ] `data.resources: [{path, mode:'freeze'}]` 配置解析 → `resourcesByPath` map(jsonPath 归一化,精确/前缀匹配)
- [ ] `read`/`read({jsonPath})`(**仅结构化读**;query/search/eval 返真值由写侧兜底,§7c A1):冻结路径值 → `⟦frozen:<path>⟧`(精确值不入 LLM 消息流)
- [ ] `commitSetToBind`:整体 set 前**沿受保护路径 normalize 回显识别**(§7c C1:freeze 回显 `⟦frozen:path⟧` → 跳过保留当前值,safeMerge 不天然跳过;verbatim 回显句柄 → 展开原值视为未改)再走校验链;真改冻结路径 → `FROZEN_FIELD` 拒绝
- [ ] `applyPatchesToBind`:patch 目标命中冻结路径(前缀匹配)→ `FROZEN_FIELD`;**remove/delete 受保护路径 → `FROZEN_FIELD`(§7c C3)**
- [ ] selftest:读替换 / 整体 set 改冻结拒绝 / patch 改冻结拒绝 / merge 保留冻结值 / 未配置不启用(零影响)

## P1 · verbatim 原样保留(防压缩丢失 + 防重打丢字)
- [ ] `read`:verbatim 路径值 → `⟦res:<handle>⟧`,懒注册(首次 read 当前 bind 值入库)
- [ ] `commitSetToBind`:expandHandles(**沿 verbatim 路径定点展开**,非全局深遍历,§7c A2)后再 schema 校验 + merge;verbatim 新值 ≠ 原值 → `VERBATIM_MISMATCH`;未知句柄 → `RESOURCE_NOT_FOUND`
- [ ] `applyPatchesToBind`:patch verbatim 路径(句柄 no-op / 新值不匹配拒绝);**remove/delete verbatim 路径 → 默认拒**(§7c C3,先 resource_delete 再删)
- [ ] selftest:句柄展开 / 新值不匹配拒绝 / 句柄写回原值通过 / 懒注册 / 未知句柄

## P1 · 资源存储与生命周期(资源管理/释放)
- [ ] vfs 第四池 `resources`(`DEFAULT_POOL_BYTES` + `VfsPoolKey` 扩)
- [ ] 资源工具 `resource_get/update/list/delete`(advanced;update 仅 verbatim,freeze 拒绝;**get 仅受保护路径**,§7c E2)**resource_update 标 dataOps 脏**(§7c D2,防 checkpoint 快照内池≠bind)
- [ ] SDK API `createResource/getResource/updateResource/deleteResource/listResources/releaseResources`
- [ ] 淘汰检测(§7c A3 分侧):**读侧自愈**(懒注册重建新句柄);**写侧**展开句柄资源缺失才 `RESOURCE_EVICTED`(提示重注册)
- [ ] `setData` 替换清空资源;checkpoint 随 vfs 保存/恢复;dataOps 快照/restore 不受影响(bind 恒原始值)
- [ ] selftest:工具全路径 / 淘汰检测 / setData 清空 / update 仅 verbatim / 显式释放后 read 重注册

## P1 · 跨压缩 pin(防压缩丢句柄)
- [ ] augmentPrompt 追加「受保护资源」段(path→mode→handle,读资源清单,不调 LLM)
- [ ] selftest:压缩后 pin 段仍在(system 含受保护资源段)

## 局部读写校验矩阵(每次读写校验点锁死)
- [ ] selftest:局部读 ①-④(read 子路径占位符替换 + subHash;query/search 返真值);局部写 patch ①-⑥(强制层③先于 schema ④ —— 句柄展开后类型才通过);整体写同;eval 子树过强制层;draft commit 走整体写行(详见 design §7b)
- [ ] 强制层顺序断言:verbatim 句柄未展开时 schema 校验前拦截(不把句柄当真实值);freeze 在 merge 后比对当前值
- [ ] selftest(§7c B 组):段边界匹配(components 命中 components.0.key,不误伤 componentsA);handle 路径派生稳定性(update/淘汰后句柄不漂移);verbatim 无值 skip;setData 清空 + checkpoint restore 后旧句柄撞 RESOURCE_NOT_FOUND 走自愈
- [ ] selftest(§7c C 组):**C1 回显识别** 整体读→整体写:freeze 回显 `⟦frozen:path⟧` 跳过保留当前值(占位符字符串不落 bind)/ verbatim 回显句柄展开=未改放行 / verbatim 写经 resource_get 拿到的原值视为未改 / verbatim 写新值≠原值 VERBATIM_MISMATCH / freeze 写新值≠当前 FROZEN_FIELD;**C2 批量失败定位** patches 中一个 verbatim 违规 → 整批拒绝 + 错误含 `patches[i]` 定位(不整批盲目重试);**C3 remove/delete** remove freeze 路径 → FROZEN_FIELD / delete verbatim 路径 → 拒(resource_delete 后才可删);容器 op(merge/append)命中受保护路径同按 mode 处理
- [ ] selftest(§7c D 组):**D1 展开自愈** ① 读(池='B')→ 外部/restore_data 把 bind 改成 'A' → 重新 read → write 回显句柄 → 以 bind 当前值 'A' 为准重注册放行(不展开旧 'B' 覆盖)② importData 替换 bind 后写回显句柄 → 自愈 ③ 句柄值未漂移时正常展开;**D2** resource_update 只改池后 checkpoint save→restore → 池与 bind 同版本(restore 后写回显句柄不漂移);**F1** eval transform 整体替换改冻结字段 → FROZEN_FIELD(验证 eval 也过强制层)

## 配套 skill / tools / usageHints / 集成(LLM 可达性)
- [ ] **新内置 skill `precise-value-protection`**(`skills/precise-value-protection/SKILL.md`,入 npm `skills/`):识别「需精确保存的字段」(id/hash/长 verbatim/关键配置);读到 `⟦frozen⟧`/`⟦res:⟧` 用 resource_get 取真值;冻结字段不可写;verbatim 要改先 resource_update 再写回句柄;撞 FROZEN_FIELD/VERBATIM_MISMATCH/RESOURCE_EVICTED/RESOURCE_NOT_FOUND 的应对
- [ ] skill 加载:定义后经 skills 中间件索引(load_skill 可取全文);`page-agent-sdk-integrate` references/api.md 补 `data.resources` 配置说明
- [ ] **资源工具装配(opt-in)**:`createDataOps` 解析 `data.resources` 非空 → 追加 resource_get/update/list/delete(同 controller 闭包);`selectBuiltinTools`/toolsets **不动**(未配置零影响)
- [ ] **统一提交链强制层**:commitSetToBind/applyPatchesToBind 内加 freeze/verbatim 前置层(非独立写路径)→ write/edit_data/delete_data/draft_commit/eval transform 全覆盖 + write dryRun 也走
- [ ] **usageHints 补丁**(按 rc 分段):data 段补占位符语义 / FROZEN_FIELD / VERBATIM_MISMATCH / RESOURCE_EVICTED / resource_get 取真值;draft 段补「draft_commit 后仍过强制」;eval 段补「transform 结果含受保护路径 → 走强制」;write 段补「dryRun 也走强制」
- [ ] presets.ts:pageBuilder 等 presets 说明文档补 resources 一句(可选)
- [ ] `skills/adaptive-planning`(如涉及):拆解任务时避开受保护字段,不写
- [ ] selftest:load_skill(precise-value-protection) 后索引含 + 全文含错误码处理指引;资源工具仅配 data.resources 时暴露(未配置不暴露)

## 文档
- [ ] CLAUDE.md 数据槽小节补受保护资源(freeze/verbatim/资源工具/生命周期/跨压缩 pin)
- [ ] usage-guide data 小节补 `resources` 配置 + 资源工具 + 跨压缩 pin;read 小节补占位符语义
- [ ] `doc/问题.md` 记录(如发现边界)

## 全量回归
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] browser:mock LLM 跑「受保护资源」demo(read 占位 → 冻结拒绝 → verbatim 句柄 → 跨压缩)
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:placeholder-protected-read-write 能力记录
- [ ] 归档:`specs/` 增量合入 + change 移入 `openspec/changes/archive/`(经用户确认发布后)
