# Specification Delta: page-agent-core

> 本文件为 change `tool-name-collision` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 工具重名覆盖语义(tool-name-collision)

系统对自定义工具(`tools` / 宿主动作 `actions` / MCP 工具)与内置工具重名时收敛为**显式覆盖语义**(后注册覆盖先注册),并全程可观察,消除当前「绑定重复定义 + 执行 builtin 赢 + 标注显示后注册者」的未定义行为。

- **装配期确定性**:`createChatSdk` 装配工具集时经纯函数 `dedupeTools` 按装配序(`builtin` → `user` → `action` → `humanConfirm/checkpoint` → `mcp`)以 name 收敛,**同名工具只保留一份**(Map.set 后注册覆盖先注册)。`rebuildExtraTools()`(setTools / MCP 注入)走同一收敛。**不得把重复定义 bind 给模型**(OpenAI 兼容协议下模型收到重名函数行为不确定)。
- **覆盖告警**:收敛产生覆盖时 `console.warn('[page-agent-sdk] 工具重名,后注册覆盖:')` 列出 `{name, winner, loser}` 来源;`debug` 模式逐条 detail。重名是配置瑕疵,告警不抛错(向后兼容)。
- **执行与标注一致**:`coreExecTool` 按 `find(name)` 执行装配后唯一的那份;`toolSources` 收敛后重建(先 clear 再按最终生效者 set),DebugDrawer 展示来源 = 实际执行来源。
- **`addTool` 去重升级**:与**最终工具集**按名比较(非仅 userTools);重名 → warn + 覆盖(含覆盖内置工具)。
- **`removeTool` 语义显式化**:按名移除最终工具集成员 —— user/action/mcp 工具直接移除;**内置工具经 `disabledNames` 集合在装配/rebuild 时过滤**实现「删内置」(等价 page-agent 传 null 删内置;API 形态保持 `removeTool(name)`)。移除后 `inspect().tools` 不含、LLM 调不到;setTools/addTool 不得复活被删内置。现有「删用户工具」用法完全兼容。
- **`setTools` 收敛**:整体替换 user 组走统一收敛,重算覆盖告警;内置组仍由 `capabilities` 决定装载,不受影响。
- **行为约束**:API 零新增零删除;对从未重名的现有用户零影响;对重名用户从「未定义」变为「确定性覆盖」。内置专属工具(`restore_last_checkpoint` 等)同样可删可覆盖。
