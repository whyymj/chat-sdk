# Spec: focus-auto-switch(增量 requirement)

## REQ1: usageHints focus 引导

advanced 模式 + `capabilities.focus` 开启 → usageHints 注入 focus 引导段:
- 局部任务(改单个组件/区域)→ 先 read 定位 path,再 `set_focus({path})` 聚焦(聚焦后写其他路径 PATH_DENIED)
- 全局任务(多处/整体结构)→ 不聚焦,保持全量视野直接写
- 完成局部精修/转其他区域 → `clear_focus` 退出聚焦
- set_focus path 必须在 schema 内(类型校验)

**门控**:`rc.focus && !simple`(= capabilities.focus 开 + toolMode advanced),与 set_focus 工具暴露条件一致。simple/minimal/关 focus 不注入(也不暴露工具)。

## REQ2: focus 持久化

- focus 经 SessionSnapshot 持久化:`persistRuntime` 每轮 afterRound 落盘;`switchSession` 切走前补存(防 setFocus 后未发消息即切走漏存)
- `applySnapshot` 恢复 focus:经 `getSchemaAtPath(schema, focus.path)` 校验,path 在当前 schema 失效 → 丢弃(debug 模式 warn);无 schema → 丢弃
- 旧存档(无 focus kind)安全:load 时 `snap.focus` 为 undefined 跳过
- restore 复用 `setFocus`(同 mission 复用 setMission);`reset()` 已在 switchSession/resetSession 调用

## REQ3: 子 agent 继承 focus

- 主 agent 聚焦时,`spawn_agent`/`spawn_agents`/预声明 `use_<id>` 子 agent **默认继承同一焦点**(createFocusMiddleware `initialFocus` 构造参数 → 子 agent 三层收敛:目标提示 + 子树视野 + 写越界 PATH_DENIED)
- 主未聚焦 → `getFocus()` 返 undefined → 子 agent 无 focus 中间件(**零回归**)
- `getSchema` 透传主 schema(`() => liveData()?.schema ?? null`,与主 focusMw 同源),主子视野一致
- 子 agent PATH_DENIED(中间件层)与 writablePaths(工具层)两层独立校验,最严者胜

## REQ4: inspect / setLlm 反映

- `inspect().focus` 反映持久化/恢复的焦点(读 `focusMw.getFocus()`,applySnapshot 恢复后自动反映)
- `setLlm` 后焦点保留(setLlm 不碰 focusMw)
