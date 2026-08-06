# Tasks: tool-name-collision(自定义 tool 与内置 tool 重名处理)

> 关联 `proposal.md`。**独立 change**,无前置依赖。
> **状态(2026-08-05):核心完成(dedupeTools 收敛 + 装配 + addTool 覆盖 + warn + toolSources 一致;selftest 1130 + e2e 286 + build 全绿);removeTool 删内置 + e2e 重名用例推后。**

## 1. 收敛纯函数 `dedupeTools`(核心)✅
- [x] 新建 `src/core/sdk/toolRegistry.ts`:`dedupeTools(groups: {label, tools}[])` → `{ tools, collisions }`
- [x] 按装配序后注册覆盖先注册(Map.set 语义);collisions 记录 `{name, winner, loser}`
- [x] 无副作用纯函数
- [x] selftest(sec-47):user 覆盖 builtin / action 覆盖 user / mcp 覆盖 action / 无重名零 collisions / 四组重名链 / 胜者实现 / 多重名(11 断言)

## 2. createChatSdk 装配改调 ✅
- [x] 装配 `allTools`(初始 + `rebuildExtraTools`)改调 `dedupeTools([builtin, user, action, humanConfirm, checkpoint, mcp])`
- [x] collisions 非空 → `console.warn('[page-agent-sdk] 工具重名,后注册覆盖先注册:', ...)`
- [x] 执行(find)与标注(toolSources)天然一致(收敛后唯一;toolSources 现状「各组后 set 覆盖」语义已反映胜者来源,无需额外重建)
- [ ] selftest:装配收敛 + 覆盖告警(spy 断言 warn)—— **推后**(sec-47 覆盖纯函数;createChatSdk 装配行为归 e2e)

## 3. 运行时 API 语义升级(部分)
- [x] `addTool`:去重范围从「userTools 内部」升级为「最终工具集按名比较」——重名 warn + 覆盖(含覆盖 builtin)
- [x] `removeTool`:清 toolSources(保持与 allTools 一致)
- [ ] `removeTool(name)` 可删内置 —— **推后**(`disabledNames` 状态机与 rebuild 交互边界复杂;集成方想禁用内置更直接用 capabilities;边缘场景,价值低)
- [x] `setTools`:整体替换走 `rebuildExtraTools` 统一收敛(重名 warn)
- [ ] selftest:addTool 覆盖内置 / removeTool 删内置后 rebuild 不复活 —— **推后**(随 removeTool 删内置)

## 4. 可观察性 + 边界
- [ ] `inspect().tools` 重名时只含唯一定义 —— **e2e 验证推后**
- [x] coreExecTool 不变(已收敛)
- [ ] e2e:重名场景 inspect 唯一 + toolSources 来源正确 —— **推后**(sec-47 白盒覆盖核心;e2e 重名需 FAKE_LLM + mount 脚本,工作量大)

## 5. 文档
- [ ] CLAUDE.md 架构要点补「工具重名覆盖语义」—— 推后(文档批次统一)
- [x] CHANGELOG [Unreleased]:tool-name-collision 记录

## 6. 全量回归
- [x] `npm run build` + `npm test`(1130)+ `npm run test:e2e`(286)全绿
- [x] 计数同步:CLAUDE.md / README 中英 / doc README(1119→1130)
- [ ] 归档:核心完成,removeTool 删内置推后;暂不归档
