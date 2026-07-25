# CLAUDE.md

本文件为 Claude(及兼容 Agent)在本仓库工作时的项目指引,请先通读再动手。

## 项目概述

`page-agent-sdk`(npm 包名,仓库目录仍名 `zhuanti-agent`)是**框架无关的 JS SDK**:对话框形态挂载到任意网页,内置 ReAct 模式 Tool-Calling Agent,通过自定义 tool 读写宿主页面 `window` 属性(属性注册表 + schema 校验)、GET 抓取文档,具备 planning / skills / 内存工作区 / context 管理能力。

采用**自研 Deep Agents 风格 harness**(规避 `deepagentsjs#292` 浏览器打包阻塞,不引入 LangGraph/langchain 整包)。

- 构建产物:`dist/page-agent-sdk.{js,umd.cjs,iife.js,css}`;类型声明 `types/index.d.ts`(手动维护);入口 `src/index.ts`

## Agent 身份

通用「页面操作助手」。systemPrompt 由 `createChatSdk({ systemPrompt })` 注入,不硬编码业务身份。

## 技术栈

- **框架**:Vue 3.5(打包进 SDK,对外框架无关;非 peer)
- **构建**:Vite 8(库模式 `build.lib`);**语言**:TypeScript 7
- **AI**:LangChain **浏览器子包**(`@langchain/openai` + `@langchain/core`),兼容 OpenAI 协议(默认接 DeepSeek);`llm` 可传 `BaseChatModel` 实例或 `LLMConfig`。**不引 langchain 整包/LangGraph**
- **MCP**:`@modelcontextprotocol/sdk`(optional peerDep,动态 import;浏览器仅 http/sse/websocket 远程 transport)
- **校验**:zod 4;**Markdown**:`marked` + `highlight.js`(打包进库)

## 常用命令

```bash
npm run dev       # 本地开发(端口 3000;被占则自动换)
npm run build     # 库模式构建到 dist/
npm run preview   # 预览构建产物
npm run test      # 自测(tsx 跑 src/__tests__/selftest.ts,341 项断言)
```

## 环境配置

AI 配置通过 `.env`(前缀 `VITE_`):`VITE_AI_API_KEY` / `VITE_AI_BASE_URL` / `VITE_AI_MODEL` / `VITE_AI_TEMPERATURE`(操作大 JSON 建议低温 0.3)/ `VITE_AI_MAX_TOKENS` / `VITE_AI_SYSTEM_PROMPT`(必须单行)。

上下文压缩策略不经 `.env`,由 `createChatSdk({ contextOptions, summaryLlm, maxMemoryRounds, contextPreset })` 显式配置。

## 目录结构

```
src/core/                       # 通用 SDK 核心(框架无关)
├── harness/                    # 自研 agent harness(createAgent + 中间件)
│   ├── createAgent.ts          # ReAct 循环 + 中间件驱动核心
│   ├── middleware.ts           # Middleware 契约 + 执行器
│   ├── todos.ts/skills.ts/memory.ts/permissions.ts/summarization.ts/retry.ts
│   ├── subagent.ts/verify.ts/usageHints.ts
├── sdk/                        # createChatSdk(命令式入口)/ defineTool
├── tools/                      # windowOps / fetchDoc / windowQuery
├── toolsets.ts                 # 内置工具集预设
├── backends/{vfs,storage}.ts   # 内存工作区 / 持久化存储
├── mcp/client.ts               # MCP client
├── composables/                # useChat / useContextManager / useMarkdown
├── components/                 # ChatDialog / MessageContent / CodePreview / DebugDrawer
├── presets.ts / types/index.ts / index.ts
examples/                       # 各 demo(page-demo/subagent-demo/mcp-demo 等)
doc/                            # architecture.md + README.md(索引)
demo/plain.html                 # 框架无关集成示例
```

## 架构要点

### 自研 harness
- `createAgent`:ReAct 循环 + 可插拔中间件,不绑定具体工具/能力
- **中间件契约**(`Middleware`):`beforeAgent`/`wrapModelCall`/`beforeModel`/`afterModel`/`wrapToolCall`/`afterAgent`/`beforeReturn` + `augmentPrompt`/`compressInput`/`tools`。before 类正序、after 类逆序、wrap 类洋葱
- 内置中间件装载序:`usageHints → todos → skills → vfs → summarization → memory → permissions → verify → subagent → 用户自定义`
- `createChatSdk` 组装:harness + 内置工具(`windowOps`/`fetchDoc` 默认装,经 `capabilities` 关闭)+ 用户 `tools`/`skills`/`memory`/`windowProps`/`middleware`

### window 操作
- 集成方声明 `windowProps: [{ path, description, schema }]`;工具:`list/describe/get/get_paths/set/edit/delete_window_prop` + `snapshot/list/restore_window_snapshot` + `query/search_window_prop` + `eval_window_script`
- `set/edit/delete` 仅限注册表内;`set/edit` 按 schema 校验,不合法返回结构化错误(不写入)
- `edit_window_prop` 按 `jsonPath` 发 patch(set/remove/merge/append),避免 LLM 重传整个大 JSON;就地写回改子属性不替换根引用 → 兼容 Vue reactive
- 快照回退:`set/edit/delete` 前自动存快照(per-path 栈);`restore_window_snapshot` 一键回退
- 大结果外存:工具结果 > 6000 字符转存 vfs,只留预览 + `vfs_read`/`vfs_grep` 引用
- **零桥接**:工具函数体 `window` = 宿主页面主 window(直接改);审计:set/edit/delete/restore 记日志
- 详细工具语义/JSONPath 子集/sandbox 禁用列表/错误码见 `src/core/tools/windowOps.ts` 与 `windowQuery.ts`

### 记忆管理
- 上下文压缩(纯内存、会话级):`summarization` 中间件复用 `useContextManager`(滑动窗口 + 摘要 + 关键词召回);`contextPreset`:`auto`(默认)/`conservative`(省成本)/`aggressive`(省上下文)
- 纯内存上限:vfs `maxBytes`(默认 4MB)LRU 淘汰;对话历史 `maxMemoryRounds`(默认 50)超限压缩为摘要 system 消息

### 持久化存储
- **默认关闭,赋值开启**:`storage: 'indexed'|'session'|'local'|'memory'` 或配置对象
- 三层命名空间:`DB → agentId → sessionId`;`options.id` 必传稳定值(多 agent 隔离)
- 可注入后端(Idb/WebStorage/Memory),不可用自动降级内存;配额/LRU 淘汰;`switchSession` 切上下文
- `shareContext: true` 同 `id` 多实例复用同一 `AgentCore`(同页多对话框视图)

### 对话鲁棒性
- 模型调用自动重试(`harness/retry.ts`):网络/429/5xx 指数退避(默认 `maxRetries`=2);4xx 与 abort 不重试
- 停止生成(abort):signal 穿透到 `llm.stream`;abort 时保留已生成 partial
- 自定义中间件外接:`createChatSdk({ middleware: [...] })` 拼到内置栈末尾;`Middleware` 类型已导出
- **onEvent 事件回调**:`createChatSdk({ onEvent })` 订阅常用时机(`window_prop_change`/`message_update`/`tool_call`/`tool_result`/`text`/`round_start`/`done`/`error`),供外部联动替代轮询;`approval_request` 不外发;流式事件仅 stream 模式(UI 默认 stream;`send` 走 invoke 无流式事件,但 window/message/error 仍发)。内部由 `sdk-events` 中间件 + `core.stream` 包装实现
- ⚠️ 错误判定**先排除 abort 再判 status**

### 子 agent 与并行编排
- `spawn_agent`/`spawn_agents`(subagent 中间件,默认开启):委派独立子 agent 跑子任务,只把最终结论返回主上下文(省 token)
- 预声明子 agent:`subagents: [{ id, description, ... }]` 自动生成 `use_<id>` 委派工具(Claude Code 风格)
- `maxDepth`(默认 1)递归物理切断;子 agent 只读工具子集,排除 spawn 防递归
- 示例:`examples/subagent-demo/`

### MCP
- `createChatSdk({ mcp: [{ transport, url, name? }] })` 连远程 MCP server,动态注入 tools(`Promise.allSettled` 故障隔离)
- 动态 import `@modelcontextprotocol/sdk`(仅用时加载);MCP `inputSchema` 直传 LangChain `tool()`
- dev 预构建坑:`vite.config.ts` 的 `optimizeDeps.include` 已预声明 SDK 子路径,否则冷启动首次注入失败

### Verify 自检中间件
- `capabilities:{verify:true}` 开启(默认关,烧 token);agent 返回前跑 `check`,不通过则 feedback 回灌自纠(限 `maxAttempts`)
- 内置 `createWriteBackCheck()`:扫描写操作读回 + schema 校验;自定义 `verify:{ check: async ({messages,state}) => ({ok, feedback?}) }`
- adversarial 对抗验证(可选):check 通过后 spawn 只读子 agent 找茬

### Approval 人工确认
- `approval:{ tools?, confirm?, ... }`:工具调用前 human-in-the-loop(被动白名单确认 + 主动 `request_human_confirmation` 工具)
- 默认关闭,传 `approval` 即启用;headless 集成方监听 `approval_request` 事件自建确认框

### Checkpoint 会话级回滚
- `checkpoint: true`:每轮自动存档(对话 + window 属性 + vfs + todos),异常/改坏时一键回退到上次正常态
- 区别于 windowOps per-path 精细快照:checkpoint 整体回滚;API `restoreLastCheckpoint()` / LLM 工具 `restore_last_checkpoint` / UI 回退按钮

## 关键约定与坑

### LangChain 消息字段名
`ToolMessage` 构造参数用 snake_case `tool_call_id`(非 camelCase),否则 DeepSeek/OpenAI 报 `400 missing field tool_call_id`。`call.id` 可能 undefined,需生成兜底 id。

### ChatOpenAI 参数
用 `apiKey`(非 `openAIApiKey`)、`model`(非 `modelName`),`baseUrl` 通过 `configuration.baseURL` 传入。

### 库构建 external
`vite.config.ts`:`vue` 打包进 SDK;`zod` / `@langchain/*` external(peerDep);`marked`/`highlight.js` 打包进。**不引 langchain 整包/LangGraph**。

### 中间件生命周期
before 类正序、after 类逆序、wrap 类洋葱。新增能力做成**中间件或工具注入**,勿硬编码进 `createAgent`。

### window 工具零桥接
工具函数体 `window` = 宿主页面主 window。改 window 必经 `set_window_prop`(范围 + 校验)。

### 自测
`npm test`(341 项)覆盖核心逻辑(windowOps/vfs/中间件/存储配额淘汰/retry/pool/subagent/mcp/verify/approval/checkpoint),不依赖 LLM;子 agent / MCP / verify 自纠循环运行时手动验证。

## SDK 用法
```ts
import { createChatSdk, defineTool, defineSkill, type Middleware } from 'page-agent-sdk'
createChatSdk({
  container: '#root', llm: { apiKey, baseUrl, model },
  systemPrompt: '...', windowProps: [{ path, description, schema }],
  tools: [...], skills: [...], memory: '...',
  maxRetries: 2, maxParallelTools: 1,
  contextPreset: 'auto',
  subagent: { allowedTools: [...] },
  capabilities: { verify: true }, verify: { maxAttempts: 2 },
  approval: { tools: ['set_window_prop', 'edit_window_prop'] },
  checkpoint: true,
  middleware: [...],
}).mount()
```
**headless**(`ui: false`):不渲染内置对话框,用 `agent.messages` + `send`/`stream` 自建 UI。

**能力开关**(`capabilities`):关掉无用内置能力(`windowOps`/`fetch`/`planning`/`skills`/`vfs`/`summarization`/`memory`/`subagent`,默认全开)省 token/体积。`verify` 反向(默认关,需 `capabilities.verify:true`)。

**预设**(`presets`):`pageBuilder` / `researcher` / `minimal`,spread 进 `createChatSdk`。

**UI 模块可复用**:`ChatDialog` / `MessageContent` / `CodePreview` + `useChat` 均从入口导出。`inspect()` 的 `AgentInfo` 含 `mcp.servers` 与每个工具 `source`。框架无关集成见 `demo/plain.html`。

## 编码规范
- `<script setup lang="ts">`,Composition API;注释用中文,只解释非显而易见处
- 新增 composable/组件/工具在 `src/index.ts` 导出并同步 `types/index.d.ts`
- 改构建依赖同步 `vite.config.ts` 的 external/globals
- `.env` 的 `VITE_AI_SYSTEM_PROMPT` 写单行

## 发布与引入

包名 `page-agent-sdk`(`package.json` 已配 `exports`/`files`/`peerDependencies`/`unpkg`/`jsdelivr`)。`vue` 打包进库;`zod`/`@langchain/*` 为 peer。三种引入:npm / CDN·ESM(esm.sh) / CDN·IIFE 全量(`unpkg` 单文件)。

构建:`npm run build` = `build:lib`(ESM+UMD,peer 外置)+ `build:iife`(IIFE 全量)。发布前确保 `npm run build` + `npm test` 通过,`types/index.d.ts` 与 `src/core/index.ts` 导出一致。

## 双远程仓库与发布约定(重要)

本地有两个远程,**职责不同,切勿混推**:

| remote | URL | 定位 |
|---|---|---|
| `origin` | gitee.com/whyymj/**chat-agent**.git | 📦 日常存储(保留全部细粒度 commit) |
| `github` | github.com/whyymj/**chat-sdk**.git | ✅ 正式开源(只接收整理过的提交) |

- **日常开发**:提交后只推 Gitee —— `git push origin master`。
- **发布到 GitHub**:推之前**必须整理 commit**(squash 合并零碎提交、写规范 message),并剔除个人笔记 `doc/待确认问题.md`。**不要直接 `git push github master`**。
- **一键发布脚本**:`./scripts/publish-github.sh "feat: 整理后的总结"`(自动 fetch → 检查待整理提交 → public 分支基于 github/master 重置 → squash merge master → 剔除笔记 → 提交 → push → 回 master)。
- **个人笔记** `doc/待确认问题.md` 已在 `.gitignore`,仅存 Gitee,不进 GitHub。

## npm 发布约定(包名 `page-agent-sdk`)

- **账号**:`whyymj`(已开 2FA,**禁止在文档/仓库/聊天记录中留存密码或 token 明文**)。凭据只存本机 user 级 `~/.npmrc`,不进项目目录、不进 git。
- **registry 陷阱**:本机默认 registry 是公司私有源;`package.json` 的 `publishConfig.registry` 已锁定官方 npm,`npm publish` 不受影响;但 `npm login`/`whoami` 需显式 `--registry=https://registry.npmjs.org/`。
- **2FA**:用 **Automation Access Token**(npmjs.com → Access Tokens → Classic → Automation,绕过 OTP),写入 `~/.npmrc`:`npm config set //registry.npmjs.org/:_authToken <token> --location=user`。用完即吊销。
- **发布前检查**:①`npm run build` ②`npm test` ③版本号 semver 递增(`npm version patch|minor|major`,不得重复发布)④`npm pack --dry-run` 核对不含 `.env`/`src`/`examples`/笔记 ⑤`npm publish`。
- **发布后测试**:`npm view page-agent-sdk version` + 临时目录 `npm i page-agent-sdk` 验证可装。
