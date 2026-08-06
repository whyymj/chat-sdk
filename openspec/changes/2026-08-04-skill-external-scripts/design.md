# Design: skill-external-scripts(自定义 skill 支持外部脚本执行)

> **核心**:`SkillSpec` 加 `exec`(执行钩子)+ `tools`(附带工具);沙箱复用泛化的 `runSandboxedScript`;宿主执行 opt-in + 远程/宿主禁止组合。全增量,默认零行为变化。评审修正:核对沙箱实现与 rebind 链路。

## 1. 现状核对(证据)

### 1.1 skill 内容来源(`src/core/harness/skills.ts`)
- `SkillSpec` = `{ name, description, doc?, getContent? }`(`skills.ts:19`)
- `readSkillDoc(doc, readVfs)`(`skills.ts:61`):`http` 走 `fetch`(CORS/截断)、`vfs` 走 `readVfs`(未启用则报错)
- `loadSkillTool`(`skills.ts:183`):优先 `contentCache` → 无则 `readSkillDoc` 或 `getContent()` → `loaded.add(name)` → 返回 `skill "<name>" 完整指令:\n\n${content}`
- `createSkillsMiddleware`(`skills.ts:113`)`tools: [loadSkillTool]` —— **中间件工具静态数组**,skill 工具注入需要新增回调

### 1.2 沙箱引擎(`src/core/tools/dataSlotQuery.ts`)
- `runSandboxedScript(data, script, timeoutMs=3000)`(`:468`):
  - 静态扫描 `SANDBOX_FORBIDDEN_PATTERNS`(动态 import/eval/Function/require 拒绝,防沙箱绕过)
  - `WORKER_PREAMBLE`(禁用 fetch/XHR/importScripts/WebSocket/indexedDB/caches/Worker/EventSource/BroadcastChannel/sendBeacon)
  - Worker 内 `new Function("data", script)` 执行,`data` 为 structured-clone 入参;超时 `terminate`
- **强绑 `data` 入参** —— 泛化为 `createSandboxRunner(script, input?, timeout)` 即可无参/有参共用

### 1.3 rebind 链路(`src/core/sdk/createChatSdk.ts` / `src/core/harness/createAgent.ts`)
- `allTools` 可变 + `rebuildExtraTools()` + `core.agent.setTools(allTools)`(`createChatSdk.ts:1229-1251`)
- `createAgent.setTools` → `allTools = [中间件贡献工具 + userTools]` + `rebindTools()`(`createAgent.ts:713-718`)
- skill 工具注入复用此链路:skills 中间件暴露「工具注入回调」→ createChatSdk 组装时把已加载 skill 的 tools 合进 `rebuildExtraTools`

## 2. SkillSpec 扩展

```ts
export interface SkillSpec {
  name: string
  description: string
  doc?: string
  getContent?: () => string | Promise<string>
  exec?: SkillExecSpec
  tools?: SkillToolFactory[]
}

export interface SkillExecSpec {
  code?: string                      // 内联 JS(与 url 二选一)
  url?: string                       // 远程脚本 URL(与 code 二选一)
  context?: 'sandbox' | 'host'       // 默认 'sandbox'
  inject?: 'append' | 'prepend'      // 默认 'append'(结果追加到文档后)
}

/** skill 附带工具工厂:返回单个工具或工具数组 */
export type SkillToolFactory = (ctx?: { signal?: AbortSignal }) =>
  StructuredToolInterface | StructuredToolInterface[] | Promise<StructuredToolInterface | StructuredToolInterface[]>
```

- **默认值**:`context` 默认 `'sandbox'`(安全默认)、`inject` 默认 `'append'`。
- **校验**:`code` 与 `url` 二选一(都空 → 该 skill 无 exec;都填 → warn + 用 code)。`url` + `context:'host'` → **拒绝**(远程不可信不能宿主全权跑,构造时 warn 并在 load 时跳过 exec)。

## 3. 沙箱引擎泛化

```ts
// src/core/tools/sandbox.ts(新,从 dataSlotQuery.ts 抽出)
export interface SandboxResult { ok: boolean; result?: unknown; error?: string; elapsedMs: number }
export function createSandboxRunner(script: string, timeoutMs = 3000):
  (input?: unknown) => Promise<SandboxResult>
```

- 无 `input`:Worker 内 `new Function(script)` 执行(无参);有 `input`:现逻辑(`new Function("data", script)` + 传 data)。
- 静态扫描 + `WORKER_PREAMBLE` + 超时 terminate 原样保留(单一真相源)。
- `eval_script` 改调 `createSandboxRunner(script)(data)` 等价(行为不变);skill `exec` 调 `createSandboxRunner(code)()` 无参。
- 远程 URL:先 `fetch` 拉文本(借鉴 `fetchDoc.ts` 的 CORS/错误处理)→ `createSandboxRunner(fetched)(undefined)`。

## 4. 宿主执行器

```ts
// src/core/tools/hostScript.ts(新)
export async function runHostScript(code: string, timeoutMs = 3000): Promise<SandboxResult>
```

- `new AsyncFunction('...')` 在宿主全局执行,可读 window/调 fetch/操作 DOM;超时由外层 Promise.race 控制。
- **仅经 `capabilities.skillHostScript` 开启后可用**:`createChatSdk` 校验 —— 开且 skill `context:'host'` → 允许;关 → `console.warn('skill 含宿主权限脚本,需 capabilities.skillHostScript:true')` + 跳过 exec。
- 与 `eval_script` 的沙箱形成对照:`eval_script` 永远沙箱;skill 宿主执行是**集成方显式 opt-in 的页面内 JS**。

## 5. load_skill 执行流程(加载时注入)

```
load_skill(name):
  1. content = contentCache.get(name) ?? (readSkillDoc | getContent)   # 文本部分
  2. if (s.exec):
     a. sandbox 路径:code → createSandboxRunner(code)()  |  url → fetch → createSandboxRunner(fetched)()
     b. host 路径:capabilities.skillHostScript 开 → runHostScript(code);关/组合非法 → warn + 跳过
     c. exec 成功 → result 文本 → content = (inject==='prepend' ? execResult + content : content + execResult)
     d. exec 失败 → 不阻塞:content 用文本部分 + 附「(skill 脚本执行失败:err)」标注
  3. contentCache.set(name, content)
  4. loaded.add(name)
  5. 返回 `skill "<name>" 完整指令:\n\n${content}`
```

- exec 结果注入**进全文**再返回 → LLM 一次读全(文本 + 实时数据)。
- 失败不抛:skill 文本仍可用(降级),只标注脚本失败原因。

## 6. 工具形态(skill 附带工具)

### 6.1 skills 中间件加「工具注入回调」

```ts
interface SkillsMiddlewareOptions {
  // ...
  onToolsReady?: (name: string, tools: StructuredToolInterface[]) => void   // 新增
}
```

`loadSkillTool` 执行后:若 `s.tools` 存在 → 逐 factory 求值 → `onToolsReady(name, tools)`。

### 6.2 createChatSdk 装配

```ts
// skill 工具注入:load_skill 后并入 allTools + rebind
let loadedSkillTools: StructuredToolInterface[] = []
const skillToolsMw = createSkillsMiddleware({
  ...,
  onToolsReady: (_name, tools) => {
    loadedSkillTools.push(...tools)
    allTools = rebuildExtraTools()          // 含 loadedSkillTools
    if (core.agent) core.agent.setTools(allTools)   // rebind
    core.infoTick.value++
  },
})
// rebuildExtraTools 加 loadedSkillTools 组(放 mcp 前)
```

- **时机**:`load_skill` 触发注入 → 下一轮 LLM 调用即看到新工具(现有 rebind 机制)。
- **卸载**:`invalidateSkillCache(name)` 或 `setSkills` 清 `loadedSkillTools`(与 contentCache 同生命周期)。
- **source 标注**:skill 工具标 `'skill:<name>'`,DebugDrawer 可辨。

## 7. 安全边界汇总

| 路径 | 默认 | 开关 | 说明 |
|---|---|---|---|
| `exec.code` 沙箱 | ✅ 开 | — | Worker 无 window/网络,静态扫描 + 超时 |
| `exec.url` 远程 | ✅ 开 | — | fetch 拉取 + 沙箱;远程不可信 |
| `exec.url` + `context:'host'` | ❌ 禁 | — | 直接拒绝(不可信 + 全权) |
| `exec.code` 宿主 | ❌ 关 | `capabilities.skillHostScript:true` | 显式 opt-in;首次 warn |

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 宿主执行 = 任意代码全权访问页面 | `capabilities.skillHostScript` 默认关;集成方显式开;首次 warn;禁止远程+宿主 |
| 远程脚本不可信 | 默认沙箱(无 window/网络);静态扫描拒动态 import/eval;超时 terminate |
| exec 失败阻塞 skill 加载 | 降级:文本仍可用 + 标注失败原因;不抛 |
| skill 工具注入污染主工具池 | source 标注 `skill:<name>`;`invalidateSkillCache`/`setSkills` 同步卸载 |
| 沙箱泛化改 `eval_script` 引入回归 | 抽出 `createSandboxRunner` 等价重构,selftest 断言 eval_script 行为不变 |
| exec 结果过大 | 复用 offload(>6000 字符转存 vfs),注入内容截断 |

## 9. 关键实现文件

| 文件 | 改动 |
|---|---|
| `src/core/tools/sandbox.ts`(新) | `createSandboxRunner` 泛化沙箱 |
| `src/core/tools/hostScript.ts`(新) | `runHostScript` 宿主执行器 |
| `src/core/tools/dataSlotQuery.ts` | `runSandboxedScript` → `createSandboxRunner`(等价重构) |
| `src/core/tools/dataOps.ts` | `eval_script` 改调 `createSandboxRunner` |
| `src/core/harness/skills.ts` | `SkillSpec` + `exec`/`tools`;`loadSkillTool` 执行链;`onToolsReady` 回调 |
| `src/core/capabilities.ts` | `skillHostScript` 开关(默认关) |
| `src/core/sdk/createChatSdk.ts` | `loadedSkillTools` 装配 + rebind + source 标注;host 开关校验 |
| `src/core/types/index.ts` + `types/index.d.ts` | `SkillSpec`/`SkillExecSpec`/`SkillToolFactory` 类型同步 |
| `src/core/index.ts` | 导出 `createSandboxRunner`(可选)/ `runHostScript`(可选) |
