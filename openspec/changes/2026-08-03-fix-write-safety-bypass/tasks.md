# Tasks: fix-write-safety-bypass (P0)

> 关联 `proposal.md`。P0 阻塞,建议优先 apply + 独立发布(patch 版本)。
> **状态(2026-08-05):代码 + selftest 完成,全测绿(selftest 1112 + e2e 286 + build)**;e2e 黑盒用例 + 版本发布待用户确认。

## 1. 编辑路径写回 schema 解析值(P0-1)✅
- [x] **先写失败用例(sec-30)** 复现:patch 值含未声明嵌套键(`set page` value 带 `secret`)→ 现行为持久化;修复后不落 bind
- [x] **先写失败用例(sec-30)** 复现:`__proto__` own 键注入(值内嵌 `{"__proto__":{"polluted":1}}`)→ 现行为注入;修复后被过滤
- [x] 改 `dataOps.ts:applyPatchesToBind` —— **方案优化为 B2(整体写回)**:写 live 从 `res.data`(schema 解析值,已 strip)整体写回(allowKeys → safeMerge / 否则 restoreInPlace),非逐 path 提取。proposal 原方案 A「append/merge 按路径从 res.data 取子树」对 **append 不成立**(append value 是单元素非子树,无法从最终态定位该 patch 贡献的元素);方案 B2 与 `commitSetToBind` 单一真相源,覆盖 set/merge/append 全 op,`remove` 先 deleteByPath(safeMerge 浅合并不删 key)
- [x] 与 `commitSetToBind` 的 `res.data` 语义对齐(单一真相源)
- [x] sec 正向断言(sec-30):未声明嵌套键不落 bind + 声明字段正常写入
- [x] sec 边界断言(sec-30):`__proto__` 不注入 + remove 正确删除(B2 safeMerge 不复活)+ append 多次最终态写回
- [ ] e2e:`write(patch)` 未声明字段不落 bind —— **推后**(selftest sec-30 白盒已覆盖纯函数核心;e2e 黑盒边际价值低、FAKE_LLM 脚本工作量大,归入后续回归批次)

## 2. DSML/伪 XML 解析收紧(P0-2)✅
- [x] **先写失败用例(sec-46)** 复现:代码围栏内 `<invoke name=...>` 被解析为工具调用;修复后跳过围栏
- [x] **先写失败用例(sec-46)** 复现:纯文本 `<invoke name="set_data">`(无守卫标记)被解析执行;修复后不自动执行(降级 garbled-retry)
- [x] 改 `parseGarbledToolCalls`:命中后剥离代码围栏(```...``` 区块)
- [x] 仅当 content 匹配强守卫标记(`<｜tool_calls｜>`/`<｜｜?DSML`/`<｜tool[_a-z]*｜>`)才自动执行;纯 `<invoke name=` 无守卫 → 返回 null(走 garbled-retry 回灌,不执行)
- [ ] invoke 段占非空白内容绝大部分判定 —— **跳过(实施优化建议)**:有「强守卫标记必择」后,③ 边际价值低且会误伤「真 DSML 前后带思考文字」场景;守卫标记(DeepSeek 内部 token,模型正文不产生)已是强信号。理由记入 proposal 决策
- [x] sec 正向(sec-46 + sec-25):带守卫标记的 DSML 序列仍正常解析执行(免重试能力保留)
- [x] sec 边界(sec-46):围栏内示例不解析 / 无守卫 `<invoke>` 不执行 / 截断不完整仍跳过
- [x] 保持 `detectGarbledToolCall`/`parseGarbledToolCalls` 导出签名不变 + sec-25 用例适配收紧(无守卫 invoke 期望 null)

## 收尾
- [x] 全测绿:`npm test`(1112)+ `npm run build` + `npm run test:e2e`(286,FAKE_LLM 不触发 garbled,无回归)
- [x] 计数同步:CLAUDE.md / README 中英 / doc README(1097→1112)
- [x] CHANGELOG [Unreleased] 段:P0 修复记录
- [ ] 版本 bump patch(如 2.22.2)独立发布 —— **待用户确认**(CLAUDE.md 发布触发约定:commit 后问用户)
