# Specification Delta: page-agent-core

> 本文件为 change `add-verify-middleware` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 循环 beforeReturn 钩子(可拦截 return 并回灌自纠)

agent 主循环在「模型本轮无工具调用、即将返回最终结果」的收口点执行已注册中间件的 `beforeReturn` 钩子(正序)。钩子返回 `null`/放行则正常 return;返回反馈字符串时,系统将该反馈作为新 user 消息注入对话历史并**继续循环**(非 return),驱动 agent 基于反馈自纠。该机制为**纯增量插入**,不改变 `while` 循环骨架、不破坏 abort 语义与 `maxToolRounds` 上限。

## Requirement: 自纠次数兜底

系统为 beforeReturn 自纠维护计数(`verifyAttempts`),受 `maxVerifyAttempts` 配置约束。触发自纠时计数 +1;计数达到上限(或配置为 0/关闭)时,即使钩子仍有反馈也强制 return,防止无限自纠消耗 token。`maxVerifyAttempts` 默认关闭(纯放行),启用时默认上限 2。

## Requirement: Verify 自检中间件

系统提供 `createVerifyMiddleware({ check })` 中间件模板,把领域校验函数(`check: ({ messages, state }) => { ok, feedback? }`)包装为 `beforeReturn` 钩子:`ok=true` 放行 return,`ok=false` 将 `feedback` 回灌驱动自纠。通用 check 由集成方定义;框架不内置语义判断。`createPageAgent({ verify: { check, maxAttempts?, adversarial? } })` 与 `capabilities.verify`(默认关闭,向后兼容)控制装载。

## Requirement: 写后读回验证(domain 辅助)

系统提供可选 `createWriteBackCheck()`:检测当轮对话中是否包含 `set/edit/delete_window_prop` 写操作,若有则读回被改属性(读回前等待响应式更新生效),校验写入值非空且符合属性声明的 schema;不符合则生成反馈驱动自纠。该辅助仅做机械的「写入是否生效 + 是否符合 schema」验证,不做语义判断;集成方可完全自定义 `check` 覆盖。

## Requirement: 对抗式验证(可选,复用子 agent)

`verify.adversarial: true` 时,verify 中间件经子 agent 机制(#1)spawn 一个只读工具子集的「找茬」agent,审查 agent 最新回复是否存在错误或遗漏;审查结论含问题则作为反馈回灌。对抗验证复用现有子 agent 隔离与递归切断机制(排除 spawn 工具防递归),默认关闭(token 成本,显式开启)。
