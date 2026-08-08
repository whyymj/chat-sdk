# Design: skill-external-scripts(自定义 skill 支持外部脚本执行)

> **核心**:`SkillSpec` 加 `exec`(执行钩子)+ `tools`(附带工具);沙箱复用泛化的 `runSandboxedScript`;宿主执行 opt-in + 远程/宿主禁止组合。全增量,默认零行为变化。评审修正:核对沙箱实现与 rebind 链路。
> **[2026-08-08 二次核实修正]**:原稿写于 `lockSandboxGlobal` 加固层落地**之前**,§1.2/§3 漏该层、§5 失败缓存语义有 bug、§6 未协同 dedupeTools、§5/§8 offload 描述矛盾。本稿已对照 `dataSlotQuery.ts:447`/`skills.ts:156`/createAgent offload 通用层逐项修正(见各节 ⚠️/修正标注)。

## 1. 现状核对(证据)

### 1.1 skill 内容来源(`src/core/harness/skills.ts`)
- `SkillSpec` = `{ name, description, doc?, getContent? }`(`skills.ts:19`)
- `readSkillDoc(doc, readVfs)`(`skills.ts:61`):`http` 走 `fetch`(CORS/截断)、`vfs` 走 `readVfs`(未启用则报错)
- `loadSkillTool`(`skills.ts:183`):优先 `contentCache` → 无则 `readSkillDoc` 或 `getContent()` → `loaded.add(name)` → 返回 `skill "<name>" 完整指令:\n\n${content}`
- `createSkillsMiddleware`(`skills.ts:113`)`tools: [loadSkillTool]` —— **中间件工具静态数组**,skill 工具注入需要新增回调

### 1.2 沙箱引擎(`src/core/tools/dataSlotQuery.ts`)
- `runSandboxedScript(data, script, timeoutMs=3000)`(`:481`),三层防护:
  - **入口静态扫描** `SANDBOX_FORBIDDEN_PATTERNS`(`:472`,动态 import/eval/Function/require 拒绝,防沙箱绕过与外泄)
  - **`lockSandboxGlobal(target)` 加固层**(`:447`,harden-eval-sandbox 后加,⚠️ 本 proposal 写于该层加固**之前**,原稿遗漏):`defineProperty configurable:false+writable:false` 锁死 fetch/XHR/importScripts/WebSocket/indexedDB/caches/Worker/SharedWorker/EventSource/BroadcastChannel/sendBeacon,**防 `delete self.fetch` 恢复原生外泄**(旧赋值覆盖可被 delete 绕过)。经 `WORKER_PREAMBLE=(lockSandboxGlobal.toString())(self)`(`:467`)序列化注入 Worker,单一真相源。纯函数已单测(sec-21:198)。
  - Worker 内 `new Function("data", script)` 执行,`data` 为 structured-clone 入参;建 fn 后 `self.eval=self.Function=undefined`(:510,双保险);超时 `terminate`
- **强绑 `data` 入参** —— 泛化为 `createSandboxRunner(script, input?, timeout)` 即可无参/有参共用(无 `input` 时 workerCode 仍 `new Function("data", script)` + 传 `undefined`,JS 多一个未用参数无害,**等价成立**)

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

- **workerCode 不变**(`new Function("data", script)`):无 `input` 时传 `undefined`,多一个未用参数无害,**等价**(不需 `new Function(script)` 两套建函数路径)。
- **三层防护整体迁移到 `sandbox.ts`**(单一真相源):① `SANDBOX_FORBIDDEN_PATTERNS` 静态扫描 ② **`lockSandboxGlobal` 纯函数 + `WORKER_PREAMBLE` 序列化引用**(`lockSandboxGlobal` 必须随之搬迁,否则 toString 引用断链)③ 超时 terminate。`dataSlotQuery.ts` 改 re-export `lockSandboxGlobal`(sec-21 单测 import 路径不断)或测试同步改 import。
- `eval_script` 改调 `createSandboxRunner(script)(data)` 等价(行为不变);skill `exec` 调 `createSandboxRunner(code)(undefined)`。
- 远程 URL:先 `fetch` 拉文本(借鉴 `fetchDoc.ts` 的 CORS/错误处理)→ `createSandboxRunner(fetched)(undefined)`。

## 4. 宿主执行器

```ts
// src/core/tools/hostScript.ts(新)
export async function runHostScript(code: string, timeoutMs = 3000): Promise<SandboxResult>
```

- `new AsyncFunction('...')` 在宿主全局执行,可读 window/调 fetch/操作 DOM;超时由外层 Promise.race 控制。
- **仅经 `capabilities.skillHostScript` 开启后可用**:`createChatSdk` 校验 —— 开且 skill `context:'host'` → 允许;关 → `console.warn('skill 含宿主权限脚本,需 capabilities.skillHostScript:true')` + 跳过 exec。
- 与 `eval_script` 的沙箱形成对照:`eval_script` 永远沙箱;skill 宿主执行是**集成方显式 opt-in 的页面内 JS**。
- **host 安全论证(为什么 opt-in 成立)**:host 脚本**必须是集成方内联 `exec.code`** —— 写死在 skill 定义里、由集成方自己编写,**不是 LLM 生成的、不是远程拉的**。这恰是决策 3「`url`+`context:'host'` 直接拒绝」守住的边界:远程代码不可信不能全权跑,LLM 无法注入任意 host 代码(它只能调已注入的 skill 工具,改不了 skill 定义)。故 host 可信度 = 集成方可信度,opt-in 合理。
- **host 跳过 `SANDBOX_FORBIDDEN_PATTERNS` 静态扫描**:静态扫描是防 LLM 沙箱脚本绕过外泄;host 是集成方可信内联代码,经 `AsyncFunction` 直接跑,不经过静态扫描(否则集成方合理用 `await fetch(...)` 会被误拒)。host 的边界是 `capabilities.skillHostScript` 整体 opt-in,不是静态扫描。

## 5. load_skill 执行流程(加载时注入)

```
load_skill(name):
  1. content = contentCache.get(name)                                    # 命中则直接返回(含上次 exec 成功结果)
     if 命中: loaded.add(name); 返回 `skill "<name>" 完整指令:\n\n${content}`
  2. content = (readSkillDoc | getContent)                                # 文本部分
  3. if (s.exec):
     a. sandbox 路径:code → createSandboxRunner(code)(undefined)  |  url → fetch → createSandboxRunner(fetched)(undefined)
     b. host 路径:capabilities.skillHostScript 开 → runHostScript(code);关/组合非法 → warn + 跳过 exec(当无 exec 处理)
     c. exec 成功 → result 文本 → content = (inject==='prepend' ? execResult + content : content + execResult)
     d. exec 失败 → 不阻塞:content 用文本部分 + 附「(skill 脚本执行失败:err)」标注;**不写 contentCache**(见下)
  4. if (exec 成功 或 无 exec): contentCache.set(name, content)           # 仅成功态缓存
  5. loaded.add(name)
  6. 返回 `skill "<name>" 完整指令:\n\n${content}`
```

- **exec 失败不缓存**(语义修正):`exec` 定位「动态 skill 每次加载拿实时数据」,失败结果若固化进 contentCache → 下次 load 直接命中、不重试 exec → 网络抖动一次失败就永久降级为静态文本,违背动态定位。故失败时**仅标注、不缓存**,下次 load 重新执行 exec;成功才缓存(跨轮跨会话复用,避免重复 IO)。
- **「一次读全」仅限静态文本部分**:静态 skill 文本(doc/getContent,通常几千字 <6000 阈值)调一次 load_skill 即读全。exec 注入的实时数据若较大,`load_skill` 返回总量超 6000 → **createAgent 层 `offloadLargeResult` 通用机制自动转 vfs**(所有工具结果共用,load_skill 不豁免)→ LLM 收到「文本全文 + exec 数据预览 + vfs_read 句柄」,实时数据按需二次读。这与「渐进式披露」同哲学(动态数据本就该按需查,一次灌进上下文反爆 token),非缺陷。

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

### 6.3 与 `dedupeTools`(tool-name-collision 2.23+)协同

skill 工具注入主工具池后,**走统一 `dedupeTools` 去重链路**(与内置/用户/MCP/subagent 工具同池竞争):

- **命名空间前缀**:skill 工具名建议 `<skill_name>__<tool>`(factory 返回的工具名带 skill 前缀),从源头避免与内置/用户工具重名(如 skill 想叫 `query` 会撞歧义)。
- **重名兜底**:即便重名,经 `dedupeTools` 按规则处理(后注册覆盖 + console.warn),不静默 return —— 与 2.23+ 全局语义一致。集成方在 warn 里能察觉命名冲突。
- **卸载一致性**:`invalidateSkillCache(name)` 清该 skill 的工具组(按 source `'skill:<name>'` 过滤 loadedSkillTools),`setSkills` 清全部。

### 6.4 exec vs tools 语义(文档澄清)

两个机制**正交**,避免集成方/LLM 混用:

| 机制 | 定位 | 触发 | 频次 |
|---|---|---|---|
| `exec` | **上下文初始化**:加载 skill 时拿一次性快照(如「当前订单概览」)注入文本 | `load_skill` 时自动 | 一次(每次 load 重新执行) |
| `tools` | **查询能力**:反复调用的工具(如「按条件查订单」) | LLM 显式调 | 反复 |

**勿同时用 exec 拿全量 + tools 查同样数据** —— exec 是快照(可能过时),tools 是实时,两份并存致 LLM 困惑。建议:exec 给概览/初始化,tools 给细粒度查询;或动态数据只走 tools、exec 仅做轻量初始化(读配置/探测环境)。

## 7. 安全边界汇总

| 路径 | 默认 | 开关 | 说明 |
|---|---|---|---|
| `exec.code` 沙箱 | ✅ 开 | — | Worker 无 window/网络;三层防护:静态扫描 + `lockSandboxGlobal` defineProperty 锁网络层(**纵深防御:防 self.fetch 直接/delete/重赋值;原型链 getPrototypeOf(self).fetch 仍可达,配合静态扫描抬高门槛**)+ 超时 |
| `exec.url` 远程 | ✅ 开 | — | fetch 拉取 + 同上沙箱;远程不可信(只准沙箱不准 host) |
| `exec.url` + `context:'host'` | ❌ 禁 | — | 直接拒绝(不可信 + 全权) |
| `exec.code` 宿主 | ❌ 关 | `capabilities.skillHostScript:true` | 显式 opt-in;首次 warn;**跳过静态扫描**(集成方可信内联代码,需 fetch 等正常 API) |

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **沙箱泛化漏迁移 `lockSandboxGlobal` 加固层**(关键) | `createSandboxRunner` 必须连同 `lockSandboxGlobal` 纯函数 + `WORKER_PREAMBLE` toString 引用 + sec-21 单测整体迁移;断言 `delete self.fetch` 仍抛。原稿写于该加固层之前故遗漏,本稿已补 |
| 宿主执行 = 任意代码全权访问页面 | `capabilities.skillHostScript` 默认关;集成方显式开;首次 warn;禁止远程+宿主;host 仅集成方内联 code(LLM 改不了 skill 定义) |
| 远程脚本不可信 | 默认沙箱(无 window/网络);静态扫描拒动态 import/eval;**lockSandboxGlobal 锁网络层兜底**(即便正则被混淆绕过,运行时也发不出数据);超时 terminate |
| exec 失败阻塞 skill 加载 | 降级:文本仍可用 + 标注失败原因 + **不缓存**(动态 skill 下次 load 重试 exec);不抛 |
| skill 工具注入污染主工具池 / 重名 | source 标注 `skill:<name>`;**走 `dedupeTools` 统一去重**(后注册覆盖 + warn);建议命名空间前缀 `<skill>__<tool>`;`invalidateSkillCache`/`setSkills` 同步卸载 |
| 沙箱泛化改 `eval_script` 引入回归 | 抽出 `createSandboxRunner` 等价重构(workerCode 不变,无参传 undefined),selftest 断言 eval_script 行为不变 + lockSandboxGlobal 单测 import 路径通 |
| exec 结果过大 | **走 createAgent 通用 `offloadLargeResult`**(>6000 字符转 vfs,所有工具结果共用,load_skill 不豁免)→ LLM 收预览 + vfs_read 句柄二次读;非「截断」,非 exec 专属选项 |

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
