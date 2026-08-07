# Tasks: arch-review-p1-fixes (P1)

> 关联 `proposal.md`。P1,按项独立 commit,可分批推进。

## 1. wrap-up 走中间件 model-call 栈(P1-1)✅
- [x] 改 `createAgent.ts` wrap-up 段(~:683):新建 `wrapUpHandler = composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal, llm))`(裸 llm 不绑工具防收口再触发工具)+ `runAfterModel`(usage 累加),不再直接调 coreModelCall
- [x] 验证 usage 累计:wrap-up 收口 token 经 sdk-events afterModel 计入 `sdk.usage`(此前漏计)
- [x] 验证 budget:wrap-up 经 wrapModelCall 洋葱 → budget 预算闸参与(opt-in automation);budget 超限时 wrap-up 照常 aborted 中断(automation 语义,checkpoint 回退兜底;默认无 budget 无影响),不特殊处理
- [x] 不跑 beforeModel:收口轮不需 todos 推进等 state 变更,且避免重渲染 system 覆盖收口提示
- [x] selftest(sec-23):计数中间件断言 wrap-up 轮也走 wrapModelCall/afterModel(3 次 model call 含收口);1163 全过
- [ ] e2e:wrap-up usage 累计 —— **推后**(selftest sec-23 白盒覆盖中间件参与核心;e2e 需 FAKE_LLM 构造工具耗尽+收口场景,工作量大)

## 2. 并发 send 串行化(P1-2)✅
- [x] 提取纯函数 `createSerialRunner`(`utils/serialRunner.ts`,可单测防 flaky);createChatSdk 实例化一个 runSerial
- [x] `send`/`batch`/`switchSession` 经 runSerial 包装(并发排队:一个完整跑完下一个才开始);「一个会话操作 data 时,其他会话等」—— 单实例同一时刻只服务一个会话
- [x] 测试:selftest sec-48 createSerialRunner 白盒(串行顺序/前一个 reject 不卡后续/并发 3 个按调用序/reject 透传);e2e 296 全绿(串行化透明,无回归)
- [x] stream 暂不串行(流式生命周期复杂;UI 走 useChat 已排队;headless stream 是高级用法,后续评估)

## 3. beforeReturn 门禁解耦(P1-3)⏸ 评估后推迟(2026-08-07)
评估结论:不建议当前做。理由:
- **收益边缘**:beforeReturn 默认不跑(`maxVerifyAttempts>0` 门禁,默认 0)只影响"用户自定义 beforeReturn 中间件 + 不开 verify"窄场景;verify+check 已覆盖主流"返回前校验自纠"
- **无低风险修复**:去门禁后自纠回灌防死循环需新机制 —— ① 新计数/预算(改 state+类型)② 改默认(影响子 agent+现有行为)③ verify 预算移入 verify.ts(改动面大,verify 链路敏感);proposal 决策 3 只给方向未定方案
- **现状是设计取舍非 bug**:`createAgent.ts:607` 注释"预算检查前置...框架级防御不靠中间件自觉"(防 adversarial 烧 token 有意设计)
- **重启触发**:真有用户自定义 beforeReturn 需求 + 明确防死循环方案时重启

## 4. subagent/verify 工具池 getter 化(P1-4)✅(subagent 部分;verify readonlyTools 推迟)
- [x] `createChatSdk.ts`(~:844/861):subagentMw/subagentsMw 装配传 `allTools: () => allTools`(getter 闭包读 let 最新值)
- [x] `subagent.ts`:SubagentOptions/SubagentsMiddlewareOptions.allTools 类型放宽接受 `() => StructuredToolInterface[]`;runSubagent 内 `getAllTools` normalize(typeof function),两处 filter 改调 getter
- [x] selftest(sec-23):spy getter 触发 spawn_agent 断言 getter 被调用(子 agent 走 getter 不走快照)+ 链路完成;1165 全过
- [ ] verify readonlyTools getter 化 —— **推后**:verify+adversarial 双 opt-in,动态工具对 adversarial 子 agent 影响极小;getter 化需动 verify 签名 + runAdversarial,收益不抵改动(READONLY_FOR_ADVERSARIAL 装配期 filter 保持)
- [ ] e2e:setTools 后 spawn 见新工具 / MCP 工具对子 agent 可见 —— **推后**(selftest sec-23 白盒覆盖 getter 路径核心)

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
