# Change: focus-context(上下文聚焦 · 指定组件精修)

> 用户诉求(2026-08-03):「如果聊天框需要制定上下文,例如:指定一个组件进行精修;给出交互规划」。
> **状态**:proposal(未实施)。独立 change,与 `chatdialog-component-split`(ChatDialog 拆分)互补但可独立实施。**用户拍板:范围收紧 strict 强制 + 三种触发方式(点击拾取/对话驱动/手动输入)全要。**

## Why

页面上有多个组件(`components.0..9`),用户想精修其中一个(如「导航栏」`components.3`)。当前缺:对话一旦开始,agent 仍看到**整个大 schema**、可写**所有组件**,容易跑偏改到别处。聚焦的价值 = 让 agent 的操作范围、视野、目标提示**收敛到一个组件**。

现有能力各自独立、需集成方手动组合,没有一个统一的「上下文聚焦」概念:

| 现有能力 | 作用 | 缺什么 |
|---|---|---|
| `mission`(任务锚定) | augmentPrompt 注入「当前主线目标」pin 段 | 只注入文字,不限制范围 |
| `permissions`(per-path 白名单) | glob 匹配 jsonPath 收紧写范围 | 需手配规则,动态聚焦要自动生成 |
| `getSchemaAtPath(schema, jsonPath)` | 取子树 schema | 存在但未用于「聚焦视野收敛」 |
| `read { jsonPath }` / `schema_data({ jsonPath? })` | 子路径读 | 每次手动,无「当前焦点」概念 |
| ChatDialog 头部/输入区 | 展示 title/placeholder/cap-badge | 无焦点状态显示位 |

## What Changes

新增**上下文聚焦(Focus)**能力:一个会话级焦点状态 `{ path, label? }`,聚焦后 agent 的三层行为收敛(目标提示 / 视野 / 范围),配三种触发方式 + ChatDialog 焦点条。

### 1. Focus 状态 + SDK API
```ts
interface Focus { path: string; label?: string }   // path=jsonPath 锚点,如 components.3
sdk.setFocus(focus) / sdk.getFocus() / sdk.clearFocus()
inspect().focus 反映当前焦点
```
- Focus 存**中间件 state**(不在 messages)→ augmentPrompt 注入 → **天然跨压缩**(同 mission/workingMemory,`compressInput` 不碰)。
- 聚焦时 `read` 返回附 `focus=components.3` 提示;`setFocus` 校验 path 合法性(`getSchemaAtPath` 命中才可聚焦,非法返回错误)。

### 2. Focus 中间件(三层收敛)
- **目标提示**:augmentPrompt 注入「## 当前精修目标:components.3(导航栏)。仅操作该子树,不要改动其他组件」。
- **视野收敛**:注入 `getSchemaAtPath(schema, focus.path)` 取的**子树 schema** 描述(用 `extractSchemaHint` 渲染),LLM 每轮只看到该组件结构,不看其他 9 个。
- **范围收紧(strict 强制)**:wrapToolCall 对写工具(`write`/`set_data`/`edit_data`/`delete_data`/`eval_script` write 意图)拦截 —— `jsonPath` 必须以 `focus.path` 为前缀,否则返回 `PATH_DENIED`(聚焦越界)。读工具不限制(用户仍需看全量上下文)。
  - 决策:用 focus 中间件 wrapToolCall 拦截,而非动态改 data schema(改 schema 会牵连 read 整体语义;拦截显式、可单测)。

### 3. 触发方式(三种全要)
| 方式 | 机制 | 归属 |
|---|---|---|
| **对话驱动** | agent 内建 `set_focus({ path, label? })` / `clear_focus` 工具;LLM 用 read 定位 path 后回填焦点 | SDK 内建,无 UI 集成也能用 |
| **点击拾取** | 宿主组件渲染时绑 `data-path`,点击 → 调 `sdk.setFocus(path, {label})` | 宿主契约(SDK 提供契约文档,不侵入宿主渲染) |
| **手动输入** | ChatDialog 焦点条输入/选路径(内置 chip + 切换/清除) | SDK UI |

### 4. ChatDialog 焦点条
- ChatDialog 加 `focus` + `onSetFocus`/`onClearFocus` props;聚焦时头部下方显示「🎯 正在精修:导航栏 `components.3`」chip(✕ 退出 · ▾ 切换 · 编辑路径)。
- 与 `chatdialog-component-split` 的关系:焦点条是 header 下的**新区块**,拆分后由 `#focus` slot 承载(集成方可换自己的选择器)。**本 change 先做内置 prop 版,拆分时挪 slot。**

### 5. `capabilities.focus`
- 默认**开**(同 missionAnchor 模式;提供 set_focus/clear_focus 工具,未聚焦时 no-op)。
- `false` 关:`setFocus`/`getFocus` 仍可调但 no-op,`set_focus` 工具不装,聚焦条不显示。

## Impact

- **测试**:
  - selftest:Focus 中间件 augmentPrompt 注入(聚焦/清除)/ strict 范围收紧(子树内放行、越界 PATH_DENIED)/ `set_focus`/`clear_focus` 工具参数校验 / setFocus 非法 path 拒绝 / capabilities.focus 关后 no-op。
  - e2e:`setFocus`/`getFocus`/`clearFocus` API + `inspect().focus` 反映 + 聚焦后写越界返回 PATH_DENIED。
  - browser:聚焦精修组件端到端(点组件 → 聚焦 → 改 title → chip 显示/退出)。browser 计数 +2~3。
- **行为变化**:聚焦是 opt-in(需用户/宿主主动 setFocus),默认不聚焦行为与现在完全一致(向后兼容)。聚焦后写越界被拒是预期的安全收紧。
- **向后兼容**:新 capability 默认开但需主动聚焦才生效;新增 API(setFocus/getFocus/clearFocus)全增量;`Focus` 类型导出。

## 决策

1. **strict 强制收紧(用户拍板)**:聚焦 = 承诺只改该子树。越界写返回 PATH_DENIED(复用 dataOps 错误码语义),agent 收到错误回灌自纠,不会静默跑偏。用户想改其他组件须先 clear_focus 或换焦点。
2. **触发方式全要(用户拍板)**:对话驱动是内建主路径(无 UI 集成也能用);点击拾取是宿主契约(不侵入渲染);手动输入是 UI 兜底。
3. **范围收紧用 wrapToolCall 拦截,不改 data schema**:改 schema 牵连 read 整体语义 + isPathAllowed 全链;拦截显式、可单测、可独立开关。
4. **Focus 存中间件 state 跨压缩**:同 mission/workingMemory 模式,augmentPrompt 注入,`compressInput` 不碰,长任务聚焦不丢。
5. **与 mission 共存**:mission 管任务级目标,Focus 管对象级精修目标。聚焦时 augmentPrompt 的「当前精修目标」段置前,mission 段保留(不冲突)。

## Non-goals

- 不做 ChatDialog 拆分(独立 change:`2026-08-03-chatdialog-component-split`)。本 change 的焦点条先做内置 prop 版,拆分时挪 slot。
- 不做宿主点击拾取的内置实现(SDK 只给契约文档 + `setFocus` API,不侵入宿主组件渲染)。
- 不做 P0/P1 架构债(独立 change:`2026-08-03-fix-write-safety-bypass` + `2026-08-03-arch-review-p1-fixes`)。
