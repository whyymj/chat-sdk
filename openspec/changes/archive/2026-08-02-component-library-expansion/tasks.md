# Tasks: component-library-expansion (P2 持续/验证层)

> 关联 `proposal.md`。
>
> 📦 **2026-08-03 范围调整 + 归档**:用户决策「不需要 80,加几个意思意思就可以」。实际完成批 A **3 个简单展示类**(badge/progress/skeleton):def + Vue + pageSchema(schema + union + PageComponent)+ defs/index + CompRenderer + initialPage 实例。`tsc` 类型检查通过 + complex-demo browser spec **9 passed** 回归(新组件不破渲染/交互)。批 B-E(到 80)取消。
>
> **意外发现(澄清 proposal 核心担忧)**:`extractSchemaHint(pageSchema)` 对 `components[discriminatedUnion]` 数组字段**不展开每个 type**(只简短描述 +「用 read 查看实际形状」)→ proposal 担忧的「80 type 撑爆 systemPrompt」**实际不成立**(union 在数组字段内,不全量注入;深入靠 `schema_data` 工具按需查)。

## 1. 脚手架
- [x] ~~写组件生成脚本~~ —— 范围缩减(3 个手写,无需脚本)
- [x] 类型清单:批 A badge / progress / skeleton(简单展示类,用户「意思意思」足够)

## 2. 批量生成
- [x] 批 A:badge / progress / skeleton —— def(`defs/*.ts`)+ Vue(`components/*Comp.vue`)+ schema(`pageSchema.ts`)+ `defs/index.ts`(import + push 基础内容)+ `CompRenderer.vue`(import + COMP_MAP)+ initialPage 实例(footer 前 3 个)
- [~] 批 B-E(营销 / 交互 / 反馈 / 复合,到 ~80):**取消**(用户「不需要 80」)

## 3. schema + 实例
- [x] `pageSchema.ts`:union 扩 3 类型(33 → 36)+ PageComponent 类型
- [x] `initialPage`:加 3 实例(progress 年中进度 / badge HOT / skeleton card 占位,footer 前)

## 4. 文档 + 测试
- [~] skill 文档同步:范围缩减,3 个新组件 def 已含 description(系统经 `.describe()` 自动注入 systemPrompt),无需额外 skill 文档
- [x] browser spec 回归:complex-demo **9 passed**(normal 8 + huge 1;新组件不破渲染/交互/huge 800 计数)
- [~] 真 LLM 实测(80 类型):取消(范围缩减)
- [~] CLAUDE.md 计数同步:无新增 selftest/e2e(纯 demo 改动),计数不变

## 收口
- [x] 验证 schema hint 行为:`extractSchemaHint(pageSchema)` 对 components[union] 不全量展开 → 「80 type 撑爆」担忧不成立(union 在数组字段内)
- [x] 归档(范围调整,批 A 3 个完成)+ project.md 更新
