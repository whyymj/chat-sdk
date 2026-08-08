# Specification Delta: page-agent-core

> 本文件为 change `skill-external-scripts` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: Skill 支持外部脚本执行(skill-external-scripts)

系统让自定义 skill 从「纯文本指令」升级为「说明书 + 执行器」:skill 可声明**执行钩子 `exec`**(加载时执行脚本、结果注入全文)与**附带工具 `tools`**(加载后注入 agent 工具池可反复调用),并复用泛化的 Web Worker 沙箱与 opt-in 宿主执行器,全程安全可控。

- **`SkillSpec` 扩展**:新增可选 `exec?: SkillExecSpec`(`{ code?, url?, context?: 'sandbox'|'host', inject?: 'append'|'prepend' }`,默认 `context:'sandbox'`、`inject:'append'`;`code` 与 `url` 二选一)与 `tools?: SkillToolFactory[]`(工厂返回单个/数组工具,可异步)。现有 `doc`/`getContent` 字段不变;不配 exec/tools 的 skill 行为完全不变(零破坏)。
- **沙箱引擎泛化**:抽 `createSandboxRunner(script, timeoutMs?)` 通用执行器(无参/有参共用),复用现有 Web Worker 沙箱的静态扫描(`SANDBOX_FORBIDDEN_PATTERNS` 拒动态 import/eval/Function/require)、禁网络预置(`WORKER_PREAMBLE` 禁 fetch/XHR/importScripts/WebSocket/indexedDB/caches 等)与超时 terminate。`eval_script` 改调之(行为不变)。
- **加载时注入(exec)**:`load_skill(name)` 若配 `exec` —— 沙箱路径(`code` 直执行 / `url` 先 fetch 拉取再执行)或宿主路径(`context:'host'`,经 `runHostScript` 的 `AsyncFunction` 宿主执行,可读 window/调接口/操作 DOM)—— 执行结果按 `inject` 拼进 skill 全文再注入上下文。**exec 失败不阻塞**:文本部分仍可用,附标注「(skill 脚本执行失败:err)」。结果过大走 offload。
- **宿主执行 opt-in 与组合拒绝**:`capabilities.skillHostScript` **默认关**;开且 skill `context:'host'` 才允许宿主执行,否则 `console.warn` + 跳过 exec。**`url` + `context:'host'` 组合直接拒绝**(远程代码不可信,不得在宿主全权上下文执行)。
- **工具形态(tools)**:`load_skill` 后,skill 的 `tools` 经工厂求值 → 经 skills 中间件 `onToolsReady` 回调注入 agent 工具池(复用 `rebuildExtraTools`/`setTools` rebind 机制)→ 下一轮 LLM 调用即可反复调用。工具 source 标注 `skill:<name>`。`invalidateSkillCache(name)`/`setSkills` 同步卸载已注入的 skill 工具。
- **行为约束**:全增量,API 零破坏;沙箱是安全默认,宿主执行是集成方显式 opt-in;远程脚本只能在沙箱执行。
