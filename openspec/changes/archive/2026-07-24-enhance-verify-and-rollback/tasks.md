# Tasks: enhance-verify-and-rollback

> 状态:**已完成(待归档)**。关联:本目录 `proposal.md` / `design.md`;`doc/待确认问题.md` #11#9。

## 期一 — 对抗子 agent 配只读工具(#11)

- [x] `verify.ts`:`VerifyMiddlewareOptions.adversarial` 加 `tools?`;`runAdversarial` 的 `createAgent` 传 tools(有则多轮实证)+ `maxToolRounds` 1→4;审查 prompt 聚焦 window 典型错误(路径/类型/语义)
- [x] `createPageAgent.ts`:`adversarial.tools` = `allTools` 按 `READONLY_FOR_ADVERSARIAL` 白名单筛选
- [x] `types/index.d.ts`:`adversarial.tools?`

## 期二 — verify 策略 + 回退文档(#11 #9)

- [x] `CLAUDE.md` Verify 小节 + `doc/usage-guide.md` 6.10:adversarial 配工具实证 + window 场景策略(createWriteBackCheck 必备 / adversarial 可选)
- [x] `doc/usage-guide.md` 6.1 快照回退:扩为完整用法(自动快照/手动检查点/查看/回退 + 示例)
- [x] 撤销 UI:降级为文档(design §4,需从 agent 步骤提取被改 path,复杂,留后续)

## 期三 — 收口

- [x] 门禁:`tsc` + `test`(157/157)+ `build`(UMD/IIFE/CSS)全过;`verify-probe` 手动验证(对抗子 agent 调工具实证,依 LLM/.env)
- [x] `/opsx:archive enhance-verify-and-rollback`(specs 修订「对抗式验证」条:无工具 → 配只读工具实证)

> 全程向后兼容:adversarial 默认关;配工具仅在开启时生效;无 tools 退化为单轮文本审查(现状)。
