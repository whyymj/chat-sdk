# Changelog

本变更日志基于 git commit 历史整理,遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 风格,版本号对应 npm 发布版本。

## [2.10.3] - 2026-07-28

### Fixed
- **README 链接 404**:`README.md`/`README.zh-CN.md` 中相对链接(`./README.zh-CN.md`、`./CLAUDE.md`、`./LICENSE`、`./doc/*.md`)在 npm 站点解析为 `npmjs.com/package/...` → 404;改为 GitHub 绝对 URL(`https://github.com/whyymj/chat-sdk/blob/master/...`),npm 与 GitHub 均可正确跳转

## [2.10.2] - 2026-07-28

### Fixed
- **`dialogCfg` 作用域 bug**:`resolveDialogConfig` 返回值原误置于 `buildCore` 作用域,`mount` 函数(在 `createChatSdk` 作用域)引用 `dialogCfg` 致 `ReferenceError: dialogCfg is not defined` → 聊天框不渲染;现移至 `createChatSdk` 作用域修复
- **输入框可拖拽**:`resize: vertical` 支持拖拽右下角调整高度(上限 50vh);`inputRows` 默认 2 行
- **ChatDialog 样式优化**:`chat-header`/`chat-footer` 添加 `flex-shrink: 0`(textarea 撑高时由 chat-body 吸收,避免容器竖向滚动);footer 添加 `padding-bottom` safe-area 间距

## [2.10.0] - 2026-07-28

### Added
- **`dialog` 归组配置**:对话框 UI 配置(`title`/`placeholder`/`drawer`/`drawerWidth`/`drawerHidden`/`inputRows`/`onClose`)归组到 `dialog` 字段,API 更整洁;**扁平写法已移除**(不再支持顶层 `title`/`placeholder`/`drawer`/...)
- **`inputRows` 默认改 2 + 可拖拽**:输入框默认 2 行初始高度(原 1 行),更易输入多行内容;`resize: vertical` 支持拖拽右下角调整高度(上限 50vh);仍自动扩展
- **`drawerWidth` 选项**:抽屉模式自定义聊天框宽度(像素或 CSS 字符串,如 `500` / `'500px'` / `'40vw'`);默认 420px;仅 `dialog.drawer: true` 生效
- **`drawerHidden` 选项**:抽屉模式默认隐藏(`mount` 后不显示,需 `sdk.show()` 才出现):适合「点击按钮才出现聊天框」场景;仅 `dialog.drawer: true` 生效
- **Skill 独立持久化(SkillStore)**:用户创建的 skill 不再随 `SessionSnapshot` 持久化,改由独立 `SkillStore` 管理(`backends/skillStore.ts`)
  - **默认 indexedDB**:即使 `storage:false`(会话持久化关闭),用户 skill 仍持久化,跨刷新恢复
  - **跨页面/跨 agent 复用**:新增 `skillStorage` 选项,手动指定同一 `id` 即可让多个 `createChatSdk` 实例(不同 agentId)共享同一套用户 skill;不传 `id` 默认按 `agent::{agentId}` 隔离
  - `skillStorage: false` 关闭持久化(仅当前会话内存有效)
- **`sdk.getUserSkill(name)`**:读取用户创建的 skill 详情(返回 `{name, description, content}` 或 `undefined`),供 SkillPanel 编辑
- **SkillPanel 编辑能力**:点击已创建 skill 加载到表单编辑(名称锁定不可改,描述/内容可改),保存调 `sdk.addSkill`(同名覆盖 = 编辑)
- **`SkillStoreConfig` 类型 + `createSkillStore` 导出**:集成方可独立构造 SkillStore 自定义 UI/管理
- **ChatDialog 样式优化**:`chat-header`/`chat-footer` 添加 `flex-shrink: 0`(textarea 撑高时由 chat-body 吸收,避免容器竖向滚动);footer 添加 `padding-bottom` safe-area 间距

### Changed
- **`SessionSnapshot` 移除 `skills` 字段**:用户创建 skill 不再随会话快照持久化(改由独立 SkillStore);`SNAPSHOT_KINDS` 由 5 项减为 4 项(messages/vfs/todos/memory)
- `PersistedSkill` 接口标记 `@deprecated`(保留仅为类型兼容,不再写入 SessionSnapshot)
- `applySnapshot` 不再恢复 skills(由 `loadUserSkillsFromStore` 在 init 时从 SkillStore 加载)
- **移除扁平写法(破坏性)**:`title`/`placeholder`/`drawer`/`drawerWidth`/`drawerHidden`/`inputRows`/`onClose` 不再支持顶层传入,统一改用 `dialog: { ... }` 归组(减少历史包袱)
- IIFE 体积阈值 1.6MB → 1.7MB(SkillPanel/skillStore 新增代码致全量包略增)

### Fixed
- **`dialogCfg` 作用域 bug**:`resolveDialogConfig` 返回值原误置于 `buildCore` 作用域,`mount` 函数(在 `createChatSdk` 作用域)引用 `dialogCfg` 致 `ReferenceError: dialogCfg is not defined` → 聊天框不渲染;现移至 `createChatSdk` 作用域修复

## [2.9.1] - 2026-07-27

### Docs
- **对接提示词通用模板**:新增 `skills/page-agent-sdk-integrate/references/integration-prompt.md`(进 npm 包,英文),供集成方复制给对接项目的 AI(Cursor/Claude Code)按流程集成;README 中英 + SKILL.md + CLAUDE.md 补充"对接提示词推荐"段
- 新增 `doc/集成提示词-Vue2-低代码页面-抽屉.md`(中文特定场景示例,仓库内)

## [2.9.0] - 2026-07-27

### Fixed
- **schema 白名单子路径投影**:`read components.0` 等子路径读现按该位置的子 schema 递归投影(隐藏 child 未声明字段);原仅顶层投影,子路径泄露 child 不可见字段
- **`isPathAllowed` 逐段校验**:`jsonPath` 逐级检查每段在 schema 声明内(防子路径绕过顶层白名单);`unwrapSchema` 支持 ZodLazy 解包(递归 schema)
- **`set`/`write(set)` 整对象 + `interceptors.write` 补充不可见字段写回 bind**:原 schema strip + safeMerge 丢失补充字段;现从原始 parsed 取不在 allowKeys 的字段写回(信任集成方拦截器/用户显式传值)

### Added
- **ChatDialog 抽屉模式**(`drawer: true`):右侧滑出 + 遮罩 + 关闭按钮(替代折叠箭头);关闭默认 `hide()` 保留历史与生成进程
- **`sdk.hide()` / `sdk.show()`**:不卸载 Vue 应用与 agent,仅加 `cs-hidden` 类隐藏;`mount()` 对已挂载隐藏实例幂等调 `show()`
- **动画**:展开/收起、卸载退出、挂载进入(抽屉滑入)三类 CSS 过渡
- **`onClose` 选项**:自定义关闭行为;抽屉模式默认 `hide()`,非抽屉默认 `unmount()`
- `animation-demo`(动画 + hide/show)、`multi-agent-demo`(多 agent 并行 + 互斥切换)
- `EditableBanner` 标识 AI 可编辑区、`DevNav` 折叠下拉

## [2.8.0] - 2026-07-27

### Added
- **`sdk.setSkills(skills)`**:运行时替换整个 skill 列表(同名覆盖);下轮 system prompt skill 索引段重渲染,清 skill 全文缓存,下次 `load_skill` 取最新全文(含 vfs doc)
- **`sdk.invalidateSkillCache(name?)`**:动态 skill 内容变化时主动失效缓存(不传清全部,传 name 清指定)
- **`sdk.exportData()` / `sdk.importData(data)`**:导出/导入主数据 `bind` 的深拷贝
- **`sdk.usage`**:累计 token 用量 `{prompt_tokens, completion_tokens, total_tokens}`
- **`onAudit` 选项**:结构化审计回调(set/edit/delete/restore)
- **`session_restored` 事件**:会话恢复时触发
- **skill 全文缓存**:`SkillsController` + `contentCache`,跨轮不重复 load 同一 skill;`offloadLargeResult` 内容寻址去重(VFS 不重复存同一内容)
- **`infoTick`**:DebugDrawer 实时刷新(动态 skill/data 变化反映)

## [2.7.1] - 2026-07-27

### Docs
- README 中英补充「schema / systemPrompt / skill 三层配合」设计思路章节

## [2.7.0] - 2026-07-27

### Changed
- **`appendReliableWriteRules` 默认改 `true`**:自定义 `systemPrompt` 时自动追加 `reliableWriteRules`(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch),用 `\n\n---\n\n` 分隔线明确区分用户内容与 SDK 追加

## [2.6.1] - 2026-07-26

### Docs
- 所有 demo 展示 `appendReliableWriteRules: true` + 注释说明

## [2.6.0] - 2026-07-26

### Added
- **`appendReliableWriteRules` 选项**:自定义 `systemPrompt` 时自动追加 `systemPromptHelpers.reliableWriteRules`(默认 false,2.7.0 改 true)

## [2.5.1] - 2026-07-26

### Fixed
- **verify/checkpoint 支持单对象 data 模型**:`createWriteBackCheck` 加 `root` 选项、`createCheckpointManager` 加 `getData` 选项,`createChatSdk` 传 `root: () => liveData()?.bind` / `getData: () => liveData()?.bind`(原误读 `globalThis.window` 致单对象 data 校验/回滚失效)
- skills 重写 + 文档同步

## [2.5.0] - 2026-07-26

### Added
- **schema 形状自动白名单**:`data.schema` 为 `ZodObject` 时,顶层声明 key 自动作为可读写白名单(`read` 整体按 schema 投影隐藏未声明字段;`write`/`edit`/`delete` jsonPath 顶层段必须在白名单内否则 `PATH_DENIED`;整体 set 转 merge 语义防误删)
- **`write` 批量 `patches`**:一次原子应用多个 patch,任一失败整体回滚
- **`read` 字段裁剪 + 深度截断**:`read({ jsonPath, fields, depth })` 支持字段投影 + 深度截断瘦身大返回
- **`eval_script` 增量 transform**:沙箱脚本返回 transform 函数增量改 bind
- **`allowPaths` 选项**:细粒度 per-path 权限

### Fixed
- 记忆系统:`trimToolResults` 死代码移除;`summarization` 与 `trimMemoryMessages` 双摘要合并;`getRegisteredSlots` 术语更新为 `getRegisteredData`

## [2.4.1] - 2026-07-26

### Fixed
- 修复代码层旧名残留(window* → dataSlot*/slot* 重命名遗漏)
- examples 非 Vue 场景改造(普通对象 bind + onEvent tick 重渲染)

## [2.4.0] - 2026-07-26

### Breaking(统一配置:删 `io`/`bind` 顶层选项,并入 `dataSlots`;按 minor 发布,不升 major)
- **删除 `io` 顶层 IO 契约选项**:不再支持 `io.input`/`io.output`。原能力(从 zod schema 自动提取字段说明注入 systemPrompt)由 `dataSlots[].schema` 的 `.describe()` 自动承担 —— SDK 现扫描所有 `dataSlots` 的 schema,经 `extractSchemaHint` 提取字段说明,注入 systemPrompt「可操作属性」段(取代原「输入/输出契约」段)
- **删除 `bind` 顶层响应式直连选项**:不再支持 `bind: { key: obj }`。原能力(reactive/普通对象直连 + 自动挂 window + 注册 dataSlot)由 `DataSlotSpec.bind` 字段承担 —— `dataSlots: [{ path, schema, bind: obj }]`,SDK 自动 `window[path] = bind`(支持点号 path) + 注册为 dataSlot
- **`DataSlotSpec.description` 改为可选**:传了 `bind` 且未传 `description` 时,自动生成 `${path}(bind 直连)`;不传 `bind` 时建议仍写 `description`(否则用 `path` 兜底)
- **`DataSlotSpec` 新增 `bind?: any` 字段**:可选,传 reactive/普通对象 → 自动挂 `window[path] = bind` + 注册为 dataSlot;reactive 写后响应式刷新(推荐 UI),普通对象可写但不响应(适合 headless,集成方用 `onEvent`/`hook` 的 `data_slot_change` 通知)

### Migration(2.x → 3.0)
- `bind: { page: pageObj }` + `io: { output: PageSchema }` → `dataSlots: [{ path: 'page', schema: PageSchema, bind: pageObj }]`
- `io: { input: InSchema, output: OutSchema }`(无 bind)→ 把 OutSchema 放到对应 `dataSlots` 项的 `schema`(字段说明自动注入);`io.input` 的输入契约段无对应替代,需自行在 `systemPrompt` 用 `extractSchemaHint(InSchema)` 拼入(罕见场景)
- 仅用 `dataSlots` 不用 `io`/`bind` 的集成方 → 无需改动

### Fixed
- **`write` 高层工具不触发 `data_slot_change` 事件**(L2 遗漏):`matchWindowOp` 原只映射底层 `set`/`edit`/`delete`/`restore_data_snapshot`,未匹配 `write`(simple 默认主入口)→ 集成方 `onEvent`/`sdk.hook` 订阅 `data_slot_change` 收不到通知。现 `matchWindowOp` 加 `write` 分支,按 args 推断 operation(`del`→delete,`patch`→edit,否则 set),`wrapToolCall` 传 `ctx.args`。simple 默认模式下 `write` 改数据槽现能正确触发 `data_slot_change`。

### Docs
- `doc/usage-guide.md` / `doc/usage-guide.en.md`:删 `io`+`bind` 段,新增 `dataSlots` 统一配置段(3.0+,含 `bind` 字段 + schema `.describe()` 自动注入 + 不强制 reactive + 通知外界机制)
- `README.md` / `README.zh-CN.md`:配置示例删 `io`/`bind` 行,`dataSlots` 行补 `bind` 字段说明
- `skills/page-agent-sdk-integrate/references/api.md`:删 `io`+`bind` 段,新增 `dataSlots` unified config 段
- `CLAUDE.md`:删 `io`/`bind` 架构要点,合并为 `dataSlots` 统一配置段;examples 段各 demo 配置方式标注更新(3.0 dataSlots bind / dataSlots 细粒度 / 手动 toolset);e2e 描述更新
- `types/index.d.ts`:`DataSlotSpec` 加 `bind?`、`description?` 改可选;删 `ChatSdkOptions.io`/`ChatSdkOptions.bind`

## [2.3.0] - 2026-07-26

### Added(L3:顶层 IO 契约 + 响应式绑定 + input/output 拦截器,纯新增,不 breaking)
- **`io` 顶层 IO 契约**:声明 agent 的输入/输出 JSON 形状(zod schema),SDK 自动提取字段说明注入 systemPrompt(输入/输出契约段),集成方不用手写 description
  - `io.input`:agent 能读的明文 JSON 形状 → 注入 systemPrompt「输入契约」段
  - `io.output`:agent 能写的明文 JSON 形状 → 注入 systemPrompt「输出契约」段;兼作 `bind` 主对象 schema
  - 与 `dataSlots` 并存:`io` 是单主对象声明式快捷方式,`dataSlots` 是多 slot + 动态注册复杂场景
- **`bind` 响应式对象直连**:集成方直接把响应式对象绑给 sdk,每个 key 自动注册为 dataSlot(path=key, schema 从 io.output 推断或 z.any),底层挂到 window[key]
  - LLM write → 响应式对象自动更新;集成方改对象 → LLM read 可见
  - 底层仍走注册表 + schema 校验 + 乐观锁,不绕过安全边界
- **`interceptors.input`/`interceptors.output`**:agent 级 IO 预处理/后处理
  - `input(input)`:send 入口预处理 user message(可改写/审计)
  - `output(json)`:agent 返回前 postprocess(可改写最终回复)
- 新导出:`extractSchemaHint(schema)` 纯函数(从 zod schema 提取字段说明,供集成方预览 io 契约将注入的提示)

### Changed
- `inspect().systemPrompt` 现反映 io 契约拼接后的最终 systemPrompt(含输入/输出契约段)

### Migration
- 旧代码不传 `io`/`bind`/`interceptors.input`/`interceptors.output` → 行为不变
- 推荐新代码用 `io` + `bind` 声明式用法(单主对象场景),免手写 dataSlots description + 手动同步

## [2.2.0] - 2026-07-26

### Added(L2:分层工具呈现 read/write + toolMode + 拦截器,向后兼容)
- **高层读写工具 `read`/`write`**:合并 list/describe/get 与 set/edit/delete + 自动乐观锁 + 自动快照,降低 LLM 认知负担
  - `read({path?})`:不传 path 列出所有可操作槽;传 path 返回当前值 + hash + 格式说明
  - `write({path, value?, patch?, del?})`:三种意图——整体 set(value 直传 JSON 对象,如 `{title:"x"}`)/ 增量 patch(`{op,jsonPath}`,op=set/remove/merge/append)/ 删除(`del:true`)。写入自动经 schema 校验 + 自动存快照 + 自动乐观锁(autoLock)
- **`toolMode` 选项**(`simple` 默认 / `advanced` / `minimal`):控制数据槽工具呈现面
  - `simple`(默认):主推 `read`/`write`,隐藏底层 `get`/`set`/`edit`/`delete`/`list`/`describe`(6 个),保留 `query`/`search`/`eval`/`snapshot` 等高级能力(共 9 个数据槽工具)
  - `advanced`:全暴露(15 个数据槽工具,等价旧 13 + read/write)
  - `minimal`:只 `read`/`write`(2 个数据槽工具)
- **`interceptors` 选项**(读写拦截器):集成方可脱敏/转换/审计/拒绝 LLM 的读写
  - `read(path, value)`:LLM 读时拦截,可脱敏/派生(只改 LLM 看到的值,不改实际存储)
  - `write(path, payload, current)`:LLM 写时拦截,可转换/审计,返回 `{error}` 拒绝
- 新导出:`filterByToolMode(tools, mode)` 纯函数 + 类型 `ToolMode`/`DataSlotInterceptors`
- `usageHints` 中间件按 `toolMode` 注入提示(simple 主推 read/write,advanced 保留底层 get/set 提示)

### Changed
- `createDataSlotOps` 返回工具数 13 → 15(新增 `read`/`write`);`defineDataSlotToolset` 同
- `createUsageHintsMiddleware` 新增第三参数 `toolMode`(默认 `simple`,向后兼容)

### Migration
- 旧代码不传 `toolMode` → 默认 `simple`,inspect().tools 不再含底层 `get_data_slot`/`set_data_slot` 等(被 read/write 合并);若依赖底层工具名,显式传 `toolMode:'advanced'`
- 旧代码不传 `interceptors` → 行为不变
- 推荐新代码用 `read`/`write` + `toolMode:'simple'` + `interceptors`(脱敏/审计),LLM 认知负担最低

## [2.1.0] - 2026-07-26

### Added(L1:JSON 直传 + 自动乐观锁,零缩水,向后兼容)
- **JSON 直传**:`set_data_slot`/`edit_data_slot` 的 `value` 现接受 JSON 对象直传(推荐,如 `{title:"x"}`),无需 stringify;仍兼容 JSON 字符串(向后兼容)。LLM 出错率显著下降
- **自动乐观锁 `autoLock`**(默认 `true`):写入时若 LLM 未显式传 `expectedHash`,自动用「LLM 最后一次 `get_data_slot` 读到的 hash」作基准比对,冲突走 `onConflict`(无则返回 `VERSION_CONFLICT`)。LLM 无需手动传 hash 即享乐观锁保护;设 `autoLock:false` 回退「不传 = 不校验」旧行为
- `DataSlotOpsOptions`/`ChatSdkOptions` 新增 `autoLock?: boolean` 字段

### Changed
- `get_data_slot` 内部记录 LLM 最后读到的 hash(供 autoLock 比对),返回格式不变

### Migration
- 旧调用传 JSON 字符串仍工作(向后兼容)
- 若依赖「不传 expectedHash = 不校验」的旧行为,显式设 `autoLock:false`
- 推荐新代码直接传 object + 依赖 autoLock,不再手动管理 hash

## [2.0.0] - 2026-07-26

### Changed (breaking — major)
- 全局命名去 `window` 化,改为 `dataSlot`/`slot`,体现「规范化 JSON 操作 Agent、前后端通用」定位(原 `window` 前缀暗示浏览器 window 对象,在 Node/服务端场景误导):
  - 配置项 `windowProps` → `dataSlots`;类型 `WindowPropInfo`/`WindowPropSpec`/`WindowOpsOptions`/`WindowOpsController`/`WindowAuditEntry`/`WindowSnapshotEntry` → `DataSlotInfo`/`DataSlotSpec`/`DataSlotOpsOptions`/`DataSlotOpsController`/`DataSlotAuditEntry`/`DataSlotSnapshotEntry`
  - 能力开关 `capabilities.windowOps` → `capabilities.dataSlotOps`
  - 工具名:`list_window_props`/`describe_window_prop`/`get_window_prop`/`set_window_prop`/`edit_window_prop`/`delete_window_prop`/`snapshot_window_prop`/`list_window_snapshots`/`restore_window_snapshot`/`get_window_paths`/`query_window_prop`/`search_window_prop`/`eval_window_script` → `list_data_slots`/`describe_data_slot`/`get_data_slot`/`set_data_slot`/`edit_data_slot`/`delete_data_slot`/`snapshot_data_slot`/`list_data_snapshots`/`restore_data_snapshot`/`get_slot_paths`/`query_data_slot`/`search_data_slot`/`eval_script`
  - 实例 API `addWindowProp`/`removeWindowProp`/`listWindowProps` → `addDataSlot`/`removeDataSlot`/`listDataSlots`;工厂 `createWindowOps`/`defineWindowToolset` → `createDataSlotOps`/`defineDataSlotToolset`
  - 事件 `window_prop_change` → `data_slot_change`
  - 文件 `src/core/tools/windowOps.ts`/`windowQuery.ts` → `dataSlotOps.ts`/`dataSlotQuery.ts`;`tests/e2e/window-props.mjs` → `data-slots.mjs`
  - 注:`getByPath(window, ...)` 等工具函数体内裸 `window` 仍指宿主浏览器 window(零桥接设计,不变);`contextWindow`(LLM 上下文窗口)不变
  - 迁移:集成方需把 `windowProps:` 改 `dataSlots:`、`capabilities.windowOps` 改 `capabilities.dataSlotOps`、`sdk.addWindowProp` 改 `sdk.addDataSlot` 等;工具名变更影响 LLM 调用,旧 systemPrompt 若硬编码旧工具名需同步

## [1.4.2] - 2026-07-25

### Fixed
- 剪贴板复制在非 secure context(HTTP / 非 localhost)失效:`navigator.clipboard` 为 undefined 或 `writeText` reject 时无降级 + 未 catch 致 unhandled rejection + 仍显示「已复制 ✓」误导。新增 `copyText` helper(Clipboard API 优先,失败降级 `document.execCommand('copy')`,失败返回 false 不误导),`MessageContent`/`CodePreview`/`ChatDialog`/`DebugDrawer` 四处改用
- shareContext 多实例并发冲突覆盖:`setPendingConflict` 直接覆盖 `pendingConflict.value`,后者覆盖前者致前者 `resolve` 丢失 → 前者工具调用永久挂起。覆盖前自动按 `keep_external` 收口旧冲突兜底
- `ChatSdk` 接口缺 `pendingConflict` / `resolveConflict` 声明(tsc 报错)
- `types/index.d.ts` 与 src 不同步:`pendingConflict` 裸值 → 同步为 `Ref<PendingConflict | null>`;补 `copyText` 导出声明

### Added
- 导出 `copyText` 工具函数(供集成方自建 UI 复制按钮复用,自动降级兼容非 secure context)

## [1.3.8] - 2026-07-25

### Added
- 导出一致性检查(`tests/exports-consistency.mjs`):静态分析对比 `src/core/index.ts` 与 `types/index.d.ts` 导出名集合,防 d.ts 脱节
- 类型测试基线(`tests/types.test-d.ts` + `tsconfig.test.json` + `test:types`):tsc --noEmit 验证 types 导出齐全 + 关键类型正确
- 补全 `types/index.d.ts` 缺失的 27 个导出(resolveContextOptions/ContextPreset/CONTEXT_PRESETS、connectMcp/extractText/McpTransport/McpConnection、Middleware/ModelRequest/ModelResponse/ToolCallContext/StateUpdate、createSubagentsMiddleware/SubagentOptions/SubagentLlmConfig、createVfs、ContextManagerOptions/CompressionStats、resolveModelCaps/estimateTokens/offloadThresholdChars/offloadPassThroughChars/ModelCaps 等)

### Fixed
- `types/index.d.ts` AgentInfo 后多余 `}` 致 tsc 报 TS1128(由类型测试基线首次跑发现)

## [1.3.7] - 2026-07-25

### Changed
- e2e 测试按模块拆分:单文件 `tests/e2e-integration.mjs` → `tests/e2e/*.mjs` 11 个主题模块 + runner 汇总
- 修正 `createAssert` 解构 bug(解构 pass/fail 取当时值不随 assert 递增,改用 ctx 引用末尾读 getter)

## [1.3.6] - 2026-07-25

### Added
- e2e 扩充至 120 项,覆盖各 API/配置项/功能模块/场景:导出项完整(39+ 函数/组件)、inspect 初始状态、storage 对象配置、presets 三预设、dataSlots 8 种 schema + 嵌套、动态注册与 inspect 同步、shareContext 开关、工具函数可用(isQuotaError/estimateTokens/jpEval/searchJson)、source=builtin、mount 边界、hook 多监听器、llm 配置

## [1.3.5] - 2026-07-25

### Added
- e2e 扩充至 86 项:自定义 tools/middleware/skills/memory 注入、inspect 反映配置(id/model/subagent/verify/mcp)、switchSession(开/未开)、restoreLastCheckpoint/listCheckpoints、导出项可用、配置项可传、shareContext 共享、storage 后端、presets

## [1.3.4] - 2026-07-25

### Added
- e2e 扩充至 48 项:inspect().tools 反映 dataSlotOps 开关 + 工具集完整性、inspect().middleware 反映 capabilities、预声明 subagents、默认 systemPrompt 含能力概述、自定义 + reliableWriteRules 拼接、onEvent + hook 联动

## [1.3.3] - 2026-07-24

### Fixed
- 修复 `createChatSdk` 顶层 `addDataSlot`/`removeDataSlot`/`listDataSlots` 作用域 bug(引用 buildCore 内部变量致运行时 ReferenceError)

## [1.3.2] - 2026-07-24

### Added
- e2e 集成测试(`tests/e2e-integration.mjs`):14 项,验证 createChatSdk 顶层 API(默认 systemPrompt/动态注册/inspect/hook)

## [1.3.1] - 2026-07-24

### Added
- `inspect().systemPrompt` 字段(供调试/验证默认提示词)
- `DEFAULT_SYSTEM_PROMPT`:未传 systemPrompt 时使用内置默认(含身份/能力概述/reliableWriteRules)

## [1.3.0] - 2026-07-24

### Added
- 运行时动态注册 `dataSlots`:`sdk.addDataSlot`/`removeDataSlot`/`listDataSlots`(懒加载组件场景)
- 压缩不丢信息保障(A/B/C/D):压缩注入注册表快照、写工具结果附 path 列表、preserveLastToolResults 可配、导出 `systemPromptHelpers.reliableWriteRules`
- `usageHints` 补 `list_data_slots`/`describe_data_slot`/`get_data_slot` 用法提示
- `examples/dynamic-demo/`:懒加载组件 + 动态注册 + onEvent 示例

## [1.2.0] - 2026-07-23

### Added
- `onEvent` 事件回调:订阅常用时机替代轮询(data_slot_change/message_update/tool_call/tool_result/text/round_start/done/error)
- `sdk.hook()` 实例方法:运行时动态订阅 SDK 事件(可多个监听器、可取消),与构造时 onEvent 互补
- 服务端(Node.js)兼容:mount/unmount 的 window/document 访问加 typeof 守卫

## [1.1.1] - 2026-07-22

### Changed
- skills 含入 npm 包 files(使用者可从 `node_modules/page-agent-sdk/skills/` 安装)

### Fixed
- release skill 改为维护者私有 —— 从公开 npm 包移除,仅留仓库 `.claude/skills/`

## [1.1.0] - 2026-07-22

### Added
- 两个项目 skill:`page-agent-sdk-integrate`(公开分发,集成 SDK)、`page-agent-sdk-release`(维护者自用,发布流程)
- 项目结构规范化:根目录 demo html 整理进各 `examples/<demo>/index.html`
- CLAUDE.md 补充完整发布流程 checklist(改代码→中英文文档→bump→build/test→推 gitee→推 github→发 npm→验证)
