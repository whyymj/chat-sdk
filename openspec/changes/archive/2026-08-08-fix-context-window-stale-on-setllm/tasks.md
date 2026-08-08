# Tasks: fix-context-window-stale-on-setllm

> 关联 `proposal.md` + `design.md`。**独立 change**,无前置依赖。
> 方案 B(独立 setter),详见 design §3-§4。

## createAgent:setModelCaps
- [ ] `caps` / `offloadThreshold` / `offloadPassThrough` 从 `const` 改 `let`(`createAgent.ts:270-278`)
- [ ] 新增 `setModelCaps(newCaps)`:更新 caps + 重算 offloadThreshold/offloadPassThrough;返回对象暴露
- [ ] (可选附带)maxTokens 缺省跟随新 caps.maxOutputTokens(用户未显式传 maxTokens 时)
- [ ] selftest:`setModelCaps(小 caps)` → offloadThreshold 变小;`setModelCaps(大 caps)` → 变大

## 中间件工厂:setContextWindow controller
- [ ] `createSummarizationMiddleware` 返回 `{ middleware, setContextWindow(cw) }`(Object.assign,复用 focusMw 模式);内部 `ctxManager.config.contextWindow = cw`
- [ ] `createContextInspectorMiddleware` 返回 `{ middleware, setContextWindow(cw) }`;内部快照改 `let`(apply 时确认中间件内部 contextWindow 存法)
- [ ] selftest:`setContextWindow(小窗口)` 后 `ctxManager.config.contextWindow` 更新;`compress` 在新阈值下对超新窗口 token 的 rounds 触发(triggered=true);contextInspector 占比重算

## createChatSdk:onLlmChange 集中回灌
- [ ] `onLlmChange`(`createChatSdk.ts:1796-1805`)重算 modelCaps 后:`core.agent.setModelCaps(modelCaps)` + `summarizationMw?.setContextWindow?.(cw)` + `contextInspectorMw?.setContextWindow?.(cw)` + `infoTick++`
- [ ] 中间件变量(summarizationMw / contextInspectorMw)在 buildCore 作用域可见(确认引用,非被装配到数组后丢失)
- [ ] e2e:`sdk.setLlm(小窗口 LLMConfig)` → `inspect().context.contextWindow` 反映新值 + `inspect().model` 反映新模型

## inspect 反映
- [ ] `inspect().context` 读最新 contextWindow(getter,非创建时快照);`inspect().model` 已是 currentLlm(确认)
- [ ] e2e:setLlm 后 inspect 两项都刷新

## 文档 + 类型
- [ ] CLAUDE.md 上下文管理 / setLlm 段补「contextWindow 动态跟随(压缩/offload/占比)」
- [ ] types:`setModelCaps` 若对外暴露则补(ChatSdk return);`AgentInfo.context` contextWindow 描述
- [ ] CHANGELOG [Unreleased]:记录 fix

## 全量回归
- [ ] `npm run build` + `npm test` 全绿
- [ ] `npm run test:e2e` 全绿(setLlm inspect 新增断言)
- [ ] 计数同步:CLAUDE.md / README 中英
