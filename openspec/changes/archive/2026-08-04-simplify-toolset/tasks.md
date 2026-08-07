# Tasks: simplify-toolset(工具面冗余精简 + 遗漏补充)

> 关联 `proposal.md`。**独立 change**,无前置依赖。系统性评估内置工具面:移除 3 个被覆盖工具 + 补 vfs_rm + usageHints 可达性增强。

## 1. history_data 列表模式 + 移除被覆盖工具
- [ ] `history_data` 加 `list?: boolean`(列表模式返回快照时间线元信息,等价 list_data_snapshots)
- [ ] dataOps 工具数组移除 `snapshot_data` / `list_data_snapshots`(SIMPLE_HIDDEN 同步删)
- [ ] advanced 移除 `get_data`(保留实现标 deprecated;`defineDataToolset` 导出剔除,`get_data` 导出兼容保留)
- [ ] selftest:history_data 列表模式(等价 list_data_snapshots)/ 移除后不可调 / get_data deprecated 不装配
- [ ] e2e:advanced `inspect().tools` 不含 snapshot_data/list_data_snapshots/get_data;simple 仍含 read/write
- [ ] toolMode 计数更新:simple=7 / advanced=16→13 / minimal=2;断言同步

## 2. 补 vfs_rm
- [ ] `vfs.ts` 加 `vfs_rm({ path })`(删除文件,不存在返回 NOT_FOUND);`VFS_TOOL_NAMES` 加 `vfs_rm`
- [ ] selftest:删除成功 / 不存在报错 / VFS_TOOL_NAMES 含 rm
- [ ] e2e:inspect().tools 含 vfs_rm + source builtin

## 3. usageHints 可达性增强
- [ ] read 投影提示(simple 段):`read()` 按 schema 投影隐藏未声明字段
- [ ] get_dom 回看提示(`rc.domInspect` 时):改完数据回看渲染
- [ ] `history_data` 描述补「对比差异用 diff_data」联动(advanced)
- [ ] 注意:diff_data 保持 advanced 段(不在 simple 提示不存在的工具)

## 4. 文档
- [ ] CLAUDE.md 工具面小节:移除 3 工具 + vfs_rm + get_data deprecated;toolMode 计数
- [ ] usage-guide 工具表:移除工具行 / 补 vfs_rm / history_data 列表模式
- [ ] README 中英工具清单同步
- [ ] `doc/问题.md` 记录「不移除的合理现状」(read/write 分层、eval/query 互补、checkpoint/restore 分层),避免将来误判

## 5. 全量回归
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] browser:mock LLM 用 vfs_rm 清理草稿端到端
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:simplify-toolset 能力记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
