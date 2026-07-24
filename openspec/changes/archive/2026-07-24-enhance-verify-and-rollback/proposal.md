# Change: enhance-verify-and-rollback

> 对应 `doc/待确认问题.md` #11 #9(分阶段落地计划**阶段 3**:验证增强 + 回退可见性)。

## Why

1. **对抗子 agent 无工具、纯文本臆测**(#11):`runAdversarial` 构造**无工具**子 agent(`verify.ts` L229-233),审查靠文本判断,无法实证读回 window 检查。对 window 修改(核心业务),实证能力缺失——找茬靠猜。
2. **对抗反馈泛泛**(#11):审查 prompt 未聚焦 window 修改的典型错误(路径错/类型错/语义不符 description)。
3. **回退缺可见性**(#9):snapshot/restore 功能完整,但无文档讲解用法;用户无 UI 撤销入口(只能对话让 agent 回退)。

## What Changes

1. **对抗子 agent 配只读工具**:复用 subagent 的只读白名单(`DEFAULT_READONLY_TOOLS`),给对抗子 agent 装只读 windowOps + fetchDoc,`maxToolRounds` 1→4 —— 实证读回检查而非臆测。
2. **对抗审查 prompt 聚焦**:引导聚焦 window 典型错误(路径/类型/语义)。
3. **verify 默认策略文档**:明确「开 verify 即用 `createWriteBackCheck`(写后读回,必备);adversarial 作可选增强(语义复杂场景)」。
4. **回退文档 + 可选 UI**:usage-guide 新增「数据回退」章节;ChatDialog 回复加「改了 N 处 [撤销]」(调 `restore_window_snapshot`)。

## Impact

- **改造**:`verify.ts`(`runAdversarial` 配工具 + prompt 聚焦)、`createPageAgent.ts`(adversarial 传 readonlyTools)、`VerifyMiddlewareOptions.adversarial`(加 tools)、`ChatDialog.vue`(可选撤销 UI)、文档。
- **向后兼容**:adversarial 默认关;配工具仅在开启时生效;createWriteBackCheck 行为不变。
- **spec delta**:1 条修订(对抗子 agent 配工具)+ 文档。

## Non-goals

- **不改** `createWriteBackCheck` 逻辑、不改 beforeReturn 钩子。
- 撤销 UI 若实现复杂则降级为仅文档(不阻塞)。
- **不做** 改名(阶段 0)。
