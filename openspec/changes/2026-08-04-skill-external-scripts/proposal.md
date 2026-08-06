# Change: skill-external-scripts(自定义 skill 支持外部脚本执行)

> 用户诉求(2026-08-04):「如何能使自定义 skill 支持外部脚本的执行」。用户拍板(AskUserQuestion):**执行目标 = 页面内 JS + 远程脚本 URL + skill 附带可调工具(全要);触发形态 = 加载时自动执行注入 + 可反复调用的工具(两者都要)**。
> **状态**:proposal(未实施)。**独立 change**,无前置依赖。基于对 skills 中间件 + 沙箱引擎的源码核对(证据见 design §1)。

## Why

当前 skill 是**纯文本指令** —— `SkillSpec` 只有 `name`/`description`/`doc`|`getContent` 三个字段,`load_skill` 只把全文注入上下文给 LLM 读(`skills.ts:183`),**skill 自身没有任何「执行」能力**:

| 现状 | 问题 |
|---|---|
| skill 只能声明静态文档(`doc`)或返回文本的函数(`getContent`) | 无法执行脚本拿**实时数据**(如拉订单/算统计),再基于结果给指令 —— 集成方得手写「先调 fetch_document 再看」 |
| 内容是一次性文本,进上下文后丢弃 | 无法成为 agent **可反复调用**的能力(如「查天气」工具) |
| 页面内 JS 只能靠 agent 手动调 `eval_script` | `eval_script` 是对**主数据 data** 的 Worker 沙箱,无 window/DOM/网络;skill 想要的宿主上下文执行没有出口 |
| 远程脚本 URL 无执行链路 | `fetch_document` 只 GET 文本不执行 |

**价值**:把 skill 从「给 LLM 的说明书」升级为「说明书 + 执行器」—— 动态 skill 每次加载拿实时数据 + 附带可调工具可反复执行。对齐「skill = 文档 + 动作」的完整形态,补上 `doc/page-agent-architecture-comparison.md` §3 里「缺页面交互层」在 skill 维度的能力。

## What Changes

扩展 `SkillSpec`,新增**执行钩子 `exec`** 与**附带工具 `tools`**,并复用/泛化现有 Web Worker 沙箱:

### 1. `SkillSpec` 扩展
```ts
export interface SkillSpec {
  name: string
  description: string
  doc?: string                          // 静态文档源(现有)
  getContent?: () => string | Promise<string>  // 动态内容(现有)
  // ↓ 新增
  exec?: SkillExecSpec                  // 加载时执行脚本,结果注入全文
  tools?: SkillToolFactory[]            // 附带可调工具,load_skill 后注入工具池
}

interface SkillExecSpec {
  code?: string        // 内联 JS(页面内执行)
  url?: string         // 远程脚本 URL(fetch 拉取后执行)
  context: 'sandbox' | 'host'           // 执行上下文(sandbox 默认;host 需显式声明 + opt-in 开关)
  inject: 'append' | 'prepend'          // 执行结果注入 skill 全文的位置
}
```

### 2. 沙箱引擎泛化
- `runSandboxedScript(data, script, timeout)`(`dataSlotQuery.ts:468`)强绑 `data` 入参 → 抽通用 `createSandboxRunner(script, input?, timeout)`:无 `input` 时执行无参脚本,`input` 存在时作入参。`eval_script` 与 skill `exec` 共用同一 Worker 沙箱(无 window/DOM、禁 fetch/importScripts、静态扫描 + 超时 terminate)。

### 3. 宿主执行(页面内 JS)
- **新增宿主执行器**:`AsyncFunction` 在宿主全局执行,可读 window / 调接口 / 操作 DOM。
- **安全边界(关键)**:`context:'host'` **显式声明才可**;`capabilities.skillHostScript` 默认关(整体禁宿主执行,只留沙箱);开启后首次加载 `console.warn` 提示「skill 含宿主权限脚本」。
- **远程 + 宿主禁止组合**:`url` + `context:'host'` 直接拒绝(远程代码不可信,不能在宿主全权上下文跑)。

### 4. 两种触发形态(用户拍板「都要」)
- **加载时注入**:`load_skill(name)` 若 skill 配 `exec` → 执行脚本 → 结果 `append`/`prepend` 拼进全文 → 注入上下文。一次性,动态 skill。
- **工具形态**:`load_skill` 后,skill 的 `tools`(工具工厂数组)注入 agent 工具池 → 可反复调用。skills 中间件加「工具注入回调」→ `createChatSdk` 走现有 `rebindTools` 机制。

### 5. 远程 URL 拉取
- `exec.url`:fetch 拉取脚本文本(CORS 处理借鉴 `fetch_document`)→ 默认沙箱执行。拉取失败返回明确错误(skill 加载仍可用文本部分)。

## Impact

- **测试**(按「新增功能测试同步约定」):
  - selftest:`exec` code 沙箱执行成功注入 / `context:'host'` 未开开关拒绝 / url+host 组合拒绝 / 远程拉取失败降级 / `tools` 注入后 agent 可调。
  - e2e:`inspect().tools` 反映 skill 工具注入(加载后)。
  - browser:mock LLM 跑「加载动态 skill → 执行脚本 → 注入 → 调附带工具」端到端。
- **行为变化**:默认不破坏 —— `exec`/`tools` 是**新增可选字段**,现有 skill(无这两字段)行为完全不变;`context:'host'` 默认关。
- **向后兼容**:全增量;`SkillSpec` 加可选字段,`defineSkill` 签名不变(透传)。
- **文档**:CLAUDE.md skill 小节补 exec/tools;usage-guide skill 小节补「动态 skill + 附带工具」;对比文档 §3 补「skill 执行能力」。

## 决策

1. **skill 仍以「文本注入」为主,执行是增强**:`load_skill` 返回全文(文本 + 执行结果),LLM 先读说明;附带工具是「执行增强」,不改变 skill 的渐进式披露定位。
2. **沙箱默认,宿主 opt-in**:对齐本项目「安全边界在 tool 层」—— 沙箱(无 window/网络)是安全默认;宿主(任意代码全权访问页面)须显式 `context:'host'` + `capabilities.skillHostScript:true`。
3. **远程脚本默认沙箱,禁止远程+宿主**:远程代码不可信,只能沙箱跑;组合直接拒绝(不 warn 兜底)。
4. **两种形态都做**(用户拍板):加载时注入(动态 skill)+ 工具形态(可反复调),共用 `exec`/`tools` 两字段。
5. **复用而非新造沙箱**:泛化 `runSandboxedScript`,不另写沙箱,`eval_script` 与 skill exec 共用,静态扫描/超时/禁用列表单一真相源。

## Non-goals

- 不做 Node/CLI 脚本执行(纯浏览器 SDK,无 `node:child_process`;headless/服务端场景另有 `tests/runtime` 路径)。
- 不做 skill 工具的「持久化注册」(工具生命周期 = 加载后当轮,`invalidateSkillCache` 同步清)。
- 不做宿主执行的细粒度权限(DOM/网络分别授权)—— 宿主执行整体 opt-in,细粒度权限是更大设计,留未来。
- 不并入 `tool-name-collision` / `context-inspector` / `agent-driven-compression`。
