# Tasks: arch-review-p1-fixes (P1)

> 关联 `proposal.md`。P1,按项独立 commit,可分批推进。

## 1. wrap-up 走中间件 model-call 栈(P1-1)
- [ ] 改 `createAgent.ts:667`:wrap-up 单独 `composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal, llm))`,不再直接调 `coreModelCall`
- [ ] 验证 usage 累计:wrap-up 收口 token 计入 `sdk.usage` + 发 `usage` 事件(afterModel 参与)
- [ ] 验证 budget:automation 预算闸在 wrap-up 生效;确认「工具用尽必须综合」兜底不被预算超限阻塞(只计费不中断)
- [ ] e2e:wrap-up 后 usage 正确;budget 收口生效

## 2. 并发 send 串行化(P1-2)✅
- [x] 提取纯函数 `createSerialRunner`(`utils/serialRunner.ts`,可单测防 flaky);createChatSdk 实例化一个 runSerial
- [x] `send`/`batch`/`switchSession` 经 runSerial 包装(并发排队:一个完整跑完下一个才开始);「一个会话操作 data 时,其他会话等」—— 单实例同一时刻只服务一个会话
- [x] 测试:selftest sec-48 createSerialRunner 白盒(串行顺序/前一个 reject 不卡后续/并发 3 个按调用序/reject 透传);e2e 296 全绿(串行化透明,无回归)
- [x] stream 暂不串行(流式生命周期复杂;UI 走 useChat 已排队;headless stream 是高级用法,后续评估)

## 3. beforeReturn 门禁解耦(P1-3)
- [ ] `createAgent.ts:594`:无条件调用 `runBeforeReturn`,超限强制 return 移入循环预算检查
- [ ] verify 自纠次数独立管理(verify 中间件自己管 `verifyAttempts`,不再与用户 beforeReturn 共用)
- [ ] 测试:自定义中间件 beforeReturn 在不开 verify 时触发(返回 feedback → 回灌自纠)
- [ ] 回归:verify 开启时行为不变(原 verify 自纠链路)

## 4. subagent/verify 工具池 getter 化(P1-4)
- [ ] `createChatSdk.ts:815`/`843`:subagentMw/readonlyTools 的 `allTools` 改 getter `() => allTools`
- [ ] `subagent.ts:144-147`:从 getter 取最新工具集
- [ ] 测试:setTools 加新工具 → spawn_agent 的 `allowedTools` 能见新工具;MCP 工具对子 agent 可见

## 5. switchSession/onClear 重置 mission/workingMemory(P1-5)
- [x] `missionMw` 补 `reset()`(清 mission + 撤销 explicitlyCleared)
- [x] `workingMemoryMw` 补 `reset()`(清 locatedPaths+lastHashes)
- [x] `createChatSdk.ts`(switchSession + onClear)调用两 reset;两中间件实例挂 `core` 对象(onClear 经 `core.` 访问)
- [x] 测试:selftest sec-35/sec-38 reset 白盒;e2e storage switchSession 后 mission 重置(workingMemory reset 纯逻辑由 sec-38 覆盖,同 reset 调用链)

## 6. setMission({}) 防重捕(P1-6)
- [x] `mission.ts`:setMission({}) 置 `explicitlyCleared` 标记;beforeAgent 仅在「未 capture 且未清空」时自动 capture;setMission(新目标)/reset() 撤销标记
- [x] 测试:selftest sec-35:setMission({}) 后同会话不重捕历史任务消息(getMission 仍 undefined);reset() 切会话归零后可正常 capture
- [x] 回归:正常 capture(首条任务型 user)行为不变;setMission 显式覆盖行为不变(sec-35 原有用例 + 新增覆盖)

## 收尾
- [ ] 全测绿:`npm test` + `npm run build` + `npm run test:e2e`
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:各 P1 修复记录
- [ ] 发布(经用户确认):P1 修复可随下个版本(如 2.23.0 minor)发布,或与 P0 修复同批 patch
