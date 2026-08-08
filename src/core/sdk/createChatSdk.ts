/**
 * 框架无关 SDK 入口 —— createChatSdk
 *
 * 组装:harness(createAgent)+ 内置中间件(todos/skills/vfs/memory/permissions)
 *   + 内置工具(数据操作/fetch 文档)+ 用户工具/skills/memory/data
 *   + 持久化(IndexedDB,降级内存;多 agent id 隔离;全局配额/LRU 淘汰)
 * 对外命令式 API:mount(container) / unmount() / send(message) / switchSession()。
 * 内部用 Vue 渲染 ChatDialog(打包进 SDK,使用者无需安装 Vue)。
 *
 * 持久化模型:三层命名空间 DB→agentId→sessionId。
 *   - send() 与 mount()(经 useChat)共享同一响应式 messages 数组(唯一来源)。
 *   - mount 异步:await 持久化恢复 → 构造 agent → 渲染。
 *
 * 共享上下文(shareContext):同 agentId 的多个 createChatSdk 实例可复用同一 AgentCore
 *   (messages/agent/vfsStore/store/todos/memory 全共享 = 「同一 agent 的多个对话框视图」)。
 *   模块级 sharedCores 注册表 + 引用计数;mount/unmount 各自渲染到不同 container。
 */
import { createApp, h, defineComponent, reactive, ref, type App as VueApp, type Ref } from 'vue'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import ChatDialog from '../components/ChatDialog.vue'
import { createAgent } from '../harness/createAgent'
import { asAgentError } from '../tools/toolError'
import { z } from 'zod'
import { getSchemaAtPath } from '../tools/schemaUtils'
import { createTodosMiddleware } from '../harness/todos'
import { createMissionMiddleware } from '../harness/mission'
import { createFocusMiddleware } from '../harness/focus'
import { createWorkingMemoryMiddleware } from '../harness/workingMemory'
import { createSkillsMiddleware, type SkillSpec } from '../harness/skills'
import { createMemoryMiddleware } from '../harness/memory'
import { createPermissionsMiddleware, type PermissionRule } from '../harness/permissions'
import { createApprovalMiddleware } from '../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../harness/humanConfirm'
import {
  createCheckpointManager,
  createCheckpointMiddleware,
  restoreInPlace,
  type CheckpointManager,
} from '../harness/checkpoint'
import type { Middleware } from '../harness/middleware'
import { createSubagentMiddleware, createSubagentsMiddleware, type SubagentConfig } from '../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, type VerifyCheck } from '../harness/verify'
import { createContextInspectorMiddleware } from '../harness/contextInspector'
import { connectMcp, type McpServerConfig } from '../mcp/client'
import { createSummarizationMiddleware } from '../harness/summarization'
import { buildDataPrompt, buildSystemPrompt } from './promptBuilder'
import { isChatModel, resolveLlm, deriveTitle } from './llmResolver'
import { constructLlmFromConfig, constructOpenLlmSync } from '../llm/constructLlm'
import { createConflictManager } from './conflictManager'
import { resolveStorage, resolveDialogConfig } from './optionsResolver'
import { resolveCapabilities } from '../capabilities'
import { createSdkEvents } from './events'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { resolveContextOptions, PRESET_PRESERVE, type ContextPreset } from './contextPreset'
import { composeMiddlewareStack } from './middlewareStack'
import { createVfs, createVfsMiddleware, VFS_TOOL_NAMES, type VfsStore } from '../backends/vfs'
import type { VfsFile, HarnessState, Mission, Focus } from '../harness/state'
import { createDataOps, filterByToolMode, type DataConfig, type DataOpsController, type ConflictResolution } from '../tools/dataOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { domTools } from '../tools/domTool'
import { inspectTools } from '../tools/envTool'
import { getTraceMetrics } from '../utils/traceMetrics'
import { createBudgetMiddleware } from '../harness/budget'
import { actionsToTools, actionsToInspectInfo, type ActionMap } from './actions'
import { selectBuiltinTools } from '../toolsets'
import { dedupeTools } from './toolRegistry'
import { createUsageHintsMiddleware } from '../harness/usageHints'
import { type SessionStore, type StorageConfig, type StorageBackendType, type SessionSnapshot, type SessionMeta } from '../backends/storage'
import { createSkillStore, type SkillStore, type SkillStoreConfig, type PersistedSkill } from '../backends/skillStore'
import { makeId } from '../utils/id'
import { resolveModelCaps, MIN_CONTEXT_WINDOW } from '../utils/modelCaps'
import { trimMemoryMessagesImpl, composeTrimSummary } from '../utils/rounds'
import { indexSummarize } from '../composables/contextIndex'
import { extractVfsRefs, gcVfsLargeResults } from '../utils/vfsGc'
import { createSerialRunner } from '../utils/serialRunner'
import type { AgentMessage, StreamHandler, AgentInfo, SdkEvent, SdkEventHandler, TokenUsage, BatchResult, BatchProgress } from '../types'
import type { ToolCallContext } from '../harness/middleware'

export interface LLMConfig {
  apiKey: string
  /** provider 选择:缺省 'openai'(兼容 OpenAI/DeepSeek 协议,向后兼容);'anthropic' 动态加载 @langchain/anthropic 走 Claude */
  provider?: 'openai' | 'anthropic'
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 模型上下文窗口(token);缺省按 model 名查表。影响 offload 阈值与压缩触发(大模型自适应) */
  contextWindow?: number
  /** 模型最大输出(token);缺省按 model 名查表。maxTokens 未传时作其缺省,避免设错被截断 */
  maxOutputTokens?: number
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking: { thinking: { type: 'enabled' } }) */
  extraBody?: Record<string, any>
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并 */
  extraConfig?: Record<string, any>
}

/** 单 agent 实例的会话控制 */
export interface SessionOptions {
  /** 显式会话 id(载入指定会话;不存在则以该 id 新建) */
  id?: string
  /** 自动恢复最近会话(默认 true;false 则每次新建) */
  autoResume?: boolean
  /** 会话标题(供未来会话列表 UI) */
  title?: string
}

/**
 * augmentSystem 钩子上下文:集成方回调据此按运行时状态动态注入 system prompt 段。
 * - `state`:harness 当前状态(messages/todos/files/skills/memory…);**不含 data**(data 是 createChatSdk 层概念,不下沉通用 HarnessState)
 * - `data`:当前主数据配置(每轮从 liveData() 取最新,setData 后自动同步;含 schema/bind/description)
 */
export interface SystemAugmentContext {
  state: HarnessState
  data?: DataConfig
}

export interface ChatSdkOptions {
  /** 挂载点(选择器或元素;headless 模式 ui:false 时可不传) */
  container?: string | HTMLElement
  /** UI:'default'(默认,渲染内置 ChatDialog)/ false(headless 不渲染,只返回 agent 核心,集成方自建 UI) */
  ui?: boolean | 'default'
  /** LLM:配置对象(LLMConfig,兼容 OpenAI 协议)或预构造模型实例(任意 provider,provider 抽离) */
  llm: LLMConfig | BaseChatModel
  /**
   * agent 实例 id(多 agent 共存隔离用)。强烈建议传稳定值:刷新后据此恢复数据。
   * 不传则随机生成并告警(刷新后无法恢复)。
   */
  id?: string
  /** 持久化:默认关闭;赋值后端字符串('indexed'/'session'/'local'/'memory')或配置对象开启;false 关闭 */
  storage?: StorageBackendType | StorageConfig | false
  /** 会话控制 */
  session?: SessionOptions
  /** 共享上下文:默认 false(每实例独立);true 时同 id 复用同一 AgentCore(同页多对话框 = 同一 agent) */
  shareContext?: boolean
  /**
   * 系统提示词(base + 可操作数据段,数据段随 data 动态;不含 todos/skills/memory/augmentSystem 等运行态 augmentPrompt 段)。
   * 通用「JSON 操作助手」身份,可覆盖。自定义时默认自动追加 reliableWriteRules(见 appendReliableWriteRules)。
   */
  systemPrompt?: string
  /** 自定义 systemPrompt 时是否自动追加 reliableWriteRules(默认 true,用 '---' 分隔线区分用户内容与 SDK 追加的写入规则);设 false 则不追加(用户已自行写规则时用);不传 systemPrompt 用默认 prompt 时已内置,此项无效 */
  appendReliableWriteRules?: boolean
  /**
   * 动态 system prompt 注入钩子:每轮 buildSystemPrompt 时调用,集成方按运行时状态(state/data)返回字符串 → 作为 system prompt 一段注入;返回 undefined → 跳过。
   * - `ctx.data` 每轮从 liveData() 取最新(setData 后自动同步),可据此动态算组件说明 / 部分 schema 描述
   * - 回调异常降级为跳过该段 + debug 日志(不崩 agent)
   * - 段排在内置段(base/dataHint/usageHints/.../subagents)之后、用户 middleware 之前
   * - 不配 = 完全现状行为(无该段)
   * 本质是 createChatSdk 层把 augmentPrompt 中间件 + liveData 闭包预包装成便捷选项(类比 memory)
   */
  augmentSystem?: (ctx: SystemAugmentContext) => string | undefined
  /** 用户自定义工具(散工具 / 展开的预设数组 / 模块 default,皆可;与内置工具合并) */
  tools?: StructuredToolInterface[]
  /**
   * 宿主动作(胜任自动化):集成方注册的页面操作(保存/发布/预览/导出等),SDK 自动包成命名 tool 供 agent 调用。
   * 每个动作 = { description, run, params? };LLM 直接看到 save_draft/publish 等命名 tool(无需 trigger_action 中转)。
   * agent 改完数据 → 调 save_draft 保存 → publish 发布,配合 get_dom 形成"改数据→看 DOM→触发动作"闭环。
   */
  actions?: ActionMap
  /** 声明式 skill(渐进式披露) */
  skills?: SkillSpec[]
  /**
   * 用户创建 skill 的独立持久化存储(与 `storage` 选项分离)。
   * - 默认:`{ backend: 'indexed' }`(即使 `storage:false` 也持久化;浏览器不可用降级内存)
   * - `id`:**手动指定同一 id 即可跨页面/跨 agent 复用同一套用户 skill**;不传则默认按 `agentId` 隔离
   * - `false`:关闭 skill 持久化(仅当前会话内存有效,刷新丢失)
   * - `backend`:'indexed'(默认)/ 'local' / 'session' / 'memory'
   */
  skillStorage?: SkillStoreConfig | false
  /**
   * AGENTS.md 风格持久指令(加载时优先于持久化的 memory)。
   * 支持三种形态:
   *   - string:静态文本
   *   - () => string:同步求值(每次 beforeAgent 求值,适合读运行时变量)
   *   - () => Promise<string>:异步求值(首次 beforeAgent 求值并缓存,适合异步加载 RAG 文档)
   * 函数 source 不可序列化,reload 时 options.memory 仍是函数会重新求值。
   */
  memory?: string | (() => string | Promise<string>)
  /** 主数据对象(单对象;schema 校验 + bind 直连,工具直接读写 bind,不挂 window) */
  data?: DataConfig
  /** 大 schema 分层披露阈值(默认 maxKeys=15/maxChars=4000;超则 systemPrompt 只注入顶层概览,深层约束查 schema_data;add-schema-tiered-disclosure) */
  schemaHint?: { maxKeys?: number; maxChars?: number }
  /** scope 白名单(默认不启用;启用后对 window/vfs 工具生效) */
  permissions?: PermissionRule[]
  /** 自定义中间件(在内置中间件之后注入;可拦截/观察模型调用、工具执行、prompt 增强等) */
  middleware?: Middleware[]
  /** 虚拟工作区:初始文件 + 内存字节上限(默认 4MB,超限 LRU 淘汰最旧) */
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number; poolBytes?: { largeResults?: number; drafts?: number; userFiles?: number } }
  /** 每个 数据槽最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  /** 自动乐观锁(默认 true):写入时若 LLM 未传 expectedHash,自动用其最后 get 读到的 hash 比对;设 false 回退「不传 = 不校验」 */
  autoLock?: boolean
  /** 数据操作审计回调:每次 set/edit/delete/restore 经此回调外发结构化事件(独立于 debug,无需 debug:true);集成方做合规审计/操作追溯 */
  onAudit?: (entry: { op: string; value?: unknown; detail?: string; timestamp: number }) => void
  /** 工具呈现模式:simple(默认,主推 read/write 但保留 query/search/eval/snapshot)| advanced(全暴露)| minimal(只 read/write) */
  toolMode?: 'simple' | 'advanced' | 'minimal'
  /** 读写拦截器:read/write 透传给数据工具(脱敏/转换/审计/拒绝 LLM 读写);input/output 在 agent IO 入口/出口预处理 */
  interceptors?: {
    read?: (value: unknown) => unknown
    write?: (payload: unknown, current: unknown) => unknown | { error: string }
    /** agent 接收输入时拦截:send/stream 的 user message 预处理(可改写/审计) */
    input?: (input: unknown) => unknown
    /** agent 产出输出时拦截:返回前 postprocess(可改写最终回复) */
    output?: (json: unknown) => unknown
  }
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number
  debug?: boolean
  maxToolRounds?: number
  /** 规划阶段总轮次预算(默认 5);planning 状态下超限 → write_todos/update_todo 回灌提示,防"光规划不执行"死循环。与 maxIterations 总闸正交 */
  maxPlanRevisions?: number
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number
  /** token 预算上限(累计 total_tokens 超过 → 停止 agent + emit BUDGET_EXCEEDED;需 capabilities.automation:true) */
  tokenBudget?: number
  /** 时间预算 ms(从 agent 开始计时,超过 → 停止;需 capabilities.automation:true) */
  timeBudgetMs?: number
  /** 无人值守错误恢复:致命错误(invoke 抛错)自动 restore_last_checkpoint + 重试次数(默认 1;防单点错误永久中断批量/长任务)。需 capabilities.automation:true */
  maxAutoRetries?: number
  /** 同轮多个工具调用的并发上限(默认 1 串行;>1 并发,可能影响有状态中间件如 todos 的计数) */
  maxParallelTools?: number
  /** 模型上下文窗口(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表。影响 offload 阈值与压缩触发 */
  contextWindow?: number
  /** 模型最大输出(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表 */
  maxOutputTokens?: number
  /** 内置能力开关(默认全开;关掉某能力则对应中间件/工具不装载) */
  capabilities?: {
    dataOps?: boolean          // 数据操作工具集(默认 true;关 → 不装数据工具,省 token/上下文)
    fetch?: boolean          // 文档抓取工具 fetch_document(默认 true;关 → 不装)
    planning?: boolean       // todos 任务规划
    missionAnchor?: boolean  // 任务目标锚定(默认 true;长任务防跑偏,revive-mission-anchor Phase 1)
    workingMemory?: boolean  // 跨压缩工作记忆(默认 true;pin 最近 path/hash,防压缩后丢定位;revive-cross-round-working-memory Phase 1)
    focus?: boolean         // 上下文聚焦·指定组件精修(默认 true;聚焦后目标/视野/范围三层收敛到单组件;focus-context)
    skills?: boolean         // 渐进式披露技能
    vfs?: boolean            // 虚拟工作区(关 → 大结果外存退化为截断)
    summarization?: boolean  // 上下文压缩(关 → 长会话不压缩)
    memory?: boolean         // AGENTS.md 持久指令
    subagent?: boolean       // 子 agent 委派(与 subagent.enabled:false 等效)
    verify?: boolean         // 自检中间件(默认 false;开启后 agent 返回前跑 check 自纠,需配合 verify.check)
    domInspect?: boolean     // DOM 读取工具 get_dom(默认 false;agent 读渲染后 DOM 结构,opt-in;有 token 成本,集成方按需开启)
    inspectEnv?: boolean     // 环境探查工具 inspect_env(默认 true;读 window 环境/location/调试变量,轻量只读,排查调试用)
    draftWrite?: boolean     // 分块写工具 draft_write/draft_commit(默认 false;几百 K JSON 分块构建再原子提交,opt-in;需 dataOps + vfs,advanced 暴露)
    tracing?: boolean        // 结构化追踪 TraceSpan(默认 false;opt-in,采集有开销;DebugDrawer trace tab + getTraceMetrics + onEvent('trace'))
    todoDeps?: boolean       // todos 层级依赖 parentId/deps(默认 false;opt-in,LLM 维护依赖图;structured-todos-tier Phase 2)
    automation?: boolean     // 无人值守自动化(默认 false;预算闸 token/time + 错误恢复;automation-layer Phase 4,opt-in 最远)
    skillHostScript?: boolean  // skill exec 宿主脚本执行(默认 false;opt-in,允许 skill exec.context:'host' 全权执行;仅集成方内联 code,远程 url+host 禁止)
    contextInspector?: boolean // 上下文检查 inspectContext(默认 true;读每轮消息分类 token 占比,纯计算零 LLM 成本)
  }
  /** 子 agent 委派(spawn_agent/spawn_agents);默认开启,{ enabled: false } 关闭 */
  subagent?: { enabled?: boolean; allowedTools?: string[]; systemPrompt?: string; temperature?: number; maxTokens?: number; skills?: SkillSpec[]; llm?: LLMConfig | BaseChatModel; maxDepth?: number; maxParallel?: number }
  /** 预声明子 agent 列表:每个用同主配置方式声明,自动生成 use_<id> 委派工具(与 spawn_agent 共存) */
  subagents?: SubagentConfig[]
  /** 自检:agent 返回前跑 check,不通过则 feedback 回灌自纠(默认关闭)。需 capabilities.verify:true 开启;check 必填(期三起可省略,默认用 createWriteBackCheck) */
  verify?: {
    /** 显式关闭(优先级最高;即使 capabilities.verify:true) */
    enabled?: boolean
    /** 领域校验函数(ok=false 时 feedback 回灌自纠) */
    check?: VerifyCheck
    /** 自纠上限(默认 2) */
    maxAttempts?: number
    /** 对抗式验证(期四实现:spawn 找茬子 agent) */
    adversarial?: boolean
  }
  /**
   * 主动征询(默认开启):装载 `request_human_confirmation` 工具 + 注入默认提示词,
   * LLM 在不确定 / 多方案 / 高风险不可逆时主动调它征询用户(把选项做成可点选按钮),而非自行猜测。
   * 默认 true(不传也开);传 false 关闭。被动确认(白名单)仍由 `approval.tools`/`approval.confirm` 声明(业务相关,无法自动推断)。
   * 传了 `approval` 时,`approval.humanConfirmTool: false` 亦可关闭本能力(向后兼容)。
   */
  humanConfirm?: boolean
  /**
   * 人工确认:工具调用前弹确认框,用户「允许/拒绝」后才执行(默认关闭,不传 = 不装)。
   * tools 指定需确认的工具名(如 ['write','set_data','edit_data']);confirm 自定义判定;timeoutMs 超时自动拒绝。
   * humanConfirmTool(传 approval 时默认 true;false 关闭):装载 request_human_confirmation 工具,LLM 可在不确定/多方案/高风险时主动征询用户。
   */
  approval?: {
    tools?: string[]
    confirm?: (name: string, args: any) => boolean
    timeoutMs?: number
    /** 是否装载 request_human_confirmation 主动确认工具(传 approval 时默认 true;false 关闭) */
    humanConfirmTool?: boolean
  }
  /**
   * 会话级 checkpoint 回滚(回到上次正常时)。默认关闭,不传 = 不装。
   * 传 true 用默认;或 { maxCheckpoints?, auto? }。auto(默认 true):每轮 agent 行动前自动存一个 checkpoint;
   * restore_last_checkpoint / list_checkpoints 工具供 LLM 自纠;SDK 暴露 restoreLastCheckpoint/listCheckpoints 供 UI 一键回退。
   */
  checkpoint?: boolean | { maxCheckpoints?: number; auto?: boolean }
  /** MCP server 列表(连远程 server,动态把其 tools 注入 agent;浏览器仅 http/sse/websocket transport) */
  mcp?: McpServerConfig[]
  /** 上下文压缩配置(false 关闭;默认 LLM 摘要,失败回退索引摘要) */
  contextOptions?: Partial<ContextManagerOptions> | false
  /**
   * 上下文压缩预设档位(默认 'auto'):auto / conservative / aggressive。
   * 提供一组合理默认,降低配置学习难度;contextOptions 细参可在其基础上覆盖个别字段。
   */
  contextPreset?: ContextPreset
  /**
   * 摘要压缩专用 LLM:可传 BaseChatModel 实例或 LLMConfig(如更便宜的小模型)。
   * 不传则默认用主 agent 的模型(options.llm)。
   */
  summaryLlm?: BaseChatModel | LLMConfig
  /** 标题生成 LLM(BaseChatModel 实例或 LLMConfig;不传则用 summaryLlm → 主 llm)。用于首轮后自动生成会话标题(主旨,替代规则截取) */
  titleLlm?: BaseChatModel | LLMConfig
  /** 自动生成会话标题(默认 true:首轮 user+assistant 后调 LLM 生成主旨标题;false 关闭用规则 deriveTitle 截取) */
  autoTitle?: boolean
  /** 摘要 LLM 温度(默认 0.3,稳定输出) */
  summaryTemperature?: number
  /** 摘要 LLM 输出上限(默认 1024;摘要无需大输出,省成本) */
  summaryMaxTokens?: number
  /** 摘要 LLM 超时毫秒(默认 15000;超时回退零成本索引摘要,不阻塞用户) */
  summaryTimeoutMs?: number
  /**
   * SDK 事件回调:订阅常用时机(数据槽变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
   * UI 与 headless 模式均生效;用于外部联动(如宿主页面响应式刷新、埋点、日志),替代轮询。
   * 注意:approval_request 不外发(UI 已处理,避免双重 resolve)。
   */
  onEvent?: SdkEventHandler
  /** 流式输出(默认 true 逐字流式);false 时等整段回复再显示(底层仍 stream 聚合) */
  streaming?: boolean
  /** 对话框 UI 配置(title/placeholder/drawer/drawerWidth/drawerHidden/inputRows/onClose 归组) */
  dialog?: DialogConfig
}

/** 对话框 UI 配置(归组写法,推荐) */
export interface DialogConfig {
  /** 对话框标题 */
  title?: string
  /** 输入框 placeholder */
  placeholder?: string
  /** 抽屉模式:ChatDialog 从右侧滑入 + 遮罩 + 关闭按钮(替代收起下箭头);点击遮罩/关闭按钮触发 unmount(带退出动画)。默认 false(inline 占满 container) */
  drawer?: boolean
  /** 抽屉模式宽度(像素或 CSS 字符串,如 500 / '500px' / '40vw');默认 420px。仅 drawer:true 生效。inline 模式宽度由 container 决定 */
  drawerWidth?: number | string
  /** 抽屉模式默认隐藏(mount 后不显示,需 sdk.show() 才显示):适合「点击按钮才出现聊天框」场景。默认 false(mount 立即显示)。仅 drawer:true 生效 */
  drawerHidden?: boolean
  /** 输入框行数(可见高度);默认 2(2 行初始高度,自动扩展至 max-height:100px)。设 1 则单行;设 >2 则更高 */
  inputRows?: number
  /** 抽屉模式关闭回调:点击遮罩/关闭按钮时调用(默认调 unmount 带退出动画)。集成方需同步外部挂载状态时传此选项覆盖默认行为 */
  onClose?: () => void
}

export interface ChatSdk {
  /** 渲染对话框到 container(异步:含持久化恢复);ui:false 时仅 init agent(headless)。
   *  可选传 overrideContainer(HTMLElement | 选择器字符串)覆盖创建时 options.container —— 异步绑定:创建时可省略 container,mount 时才指定 */
  mount(overrideContainer?: HTMLElement | string): Promise<void>
  /** 响应式消息数组(headless 模式下供集成方自建 UI 读取;与内部共享同一引用) */
  messages: AgentMessage[]
  /** 卸载(shareContext 时仅减引用计数,归零才真销毁) */
  unmount(): void
  /** 抽屉模式隐藏:加 cs-hidden class,不卸载 vueApp/不 release agent —— 保留聊天历史与正在进行的生成进程;再 show() 恢复可见 */
  hide(): void
  /** 抽屉模式显示:移除 cs-hidden class 恢复可见(配合 hide 使用;首次挂载用 mount) */
  show(): void
  /** 命令式发送一条消息(共享内部 messages,自动持久化);options.interceptors per-call 覆盖顶层 input/output 拦截器,options.maxAutoRetries per-call 覆盖 automation 重试次数 */
  send(message: string, options?: SendOptions): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 切换到指定会话(载入其上下文);不传 id 则新建。返回新会话 id。storage 未开启时抛错 */
  switchSession(sessionId?: string): Promise<string>
  /** 列出当前 agent 的所有历史会话(供「历史列表」UI;storage 未开启 → []) */
  listSessions(): Promise<import('../backends/storage').SessionMeta[]>
  /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;直接消费无需手动 listSessions/refresh) */
  readonly sessions: Ref<import('../backends/storage').SessionMeta[]>
  /** 删除指定历史会话;不可删除当前会话(删当前请先 switchSession 切走);storage 未开启 → no-op + warn */
  deleteSession(sessionId: string): Promise<void>
  /** 当前会话 id(switchSession/onClear 后实时反映;供历史列表高亮当前项) */
  readonly sessionId: string
  /** 检视 agent 详细信息(tools/skills/data/middleware/todos 等),供 debug 或外部消费 */
  inspect(): AgentInfo
  /** 读取最近一次上下文构成快照(每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
  inspectContext(): import('../utils/contextAnalysis').ContextSnapshot | undefined
  /** 读取当前任务目标锚点 mission(自动 capture 或 setMission;capabilities.missionAnchor:false → undefined) */
  getMission(): Mission | undefined
  /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
  setMission(mission: Partial<Mission>): void
  /** 读取当前聚焦焦点(指定组件精修;未聚焦 / capabilities.focus:false → undefined) */
  getFocus(): Focus | undefined
  /** 设置聚焦焦点(path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法 path 返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
  setFocus(focus: Focus): { ok: boolean; error?: string }
  /** 清除聚焦焦点(退出精修模式,恢复全量可操作范围) */
  clearFocus(): void
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);需开启 checkpoint 选项,无可用 checkpoint 返回 false */
  restoreLastCheckpoint(): boolean
  /** 列出可用 checkpoint(回退点);需开启 checkpoint 选项,未开启返回空数组 */
  listCheckpoints(): { id: number; label?: string; timestamp: number; messageCount: number }[]
  /**
   * 批处理(automation):逐任务跑 agent,每任务前自动 checkpoint,任务间错误隔离(单任务失败记 error 不中断整批)。
   * 适合无人值守批量操作(批量生成/改一批页面)。不经 UI 排队(直接 invoke);返回每个任务结果(成功 reply / 失败 error)。
   * 配合 capabilities.automation + checkpoint 使用;onProgress 每任务完成调一次(done/total/task/ok)。
   */
  batch(tasks: string[], onProgress?: (p: BatchProgress) => void): Promise<BatchResult[]>
  /**
   * 运行时订阅 SDK 事件(常用时机:数据槽变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
   * 与构造时 `onEvent` 选项互补:可注册多个监听器、运行时动态订阅;返回取消函数。
   * approval_request 不外发(UI 已处理)。流式事件仅 stream 模式(UI 默认 stream;sdk.send 走 invoke 无流式事件)。
   */
  hook(handler: SdkEventHandler): () => void
  /**
   * 运行时替换主数据配置(如页面切换、schema 变更)。立即对数据工具生效(无需重建 agent);
   * 清空快照栈与乐观锁缓存。需开启 dataOps(默认开)。
   */
  setData(config: DataConfig): void
  /** 读取当前主数据配置(schema + bind + description);dataOps 关闭时返回 undefined */
  getData(): DataConfig | undefined
  /**
   * 运行时替换整个 skill 列表(同名 skill 覆盖更新)。立即生效:system prompt 的 skill 索引段下轮重渲染反映新 skill;
   * 清空 skill 全文缓存与本轮已加载记录,下次 load_skill 重新取最新全文(含 vfs doc)。需开启 skills(默认开)
   */
  setSkills(skills: SkillSpec[]): void
  /**
   * 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖)。触发 controller 合并 initialSkills + userSkills + infoTick 刷新。
   * 需开启 skills(默认开);关闭时 warn 并忽略
   */
  addSkill(skill: SkillSpec): void
  /**
   * 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills)。返回是否删除成功。
   * 需开启 skills(默认开);关闭时 warn 并返回 false
   */
  removeSkill(name: string): boolean
  /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
  listUserSkills(): string[]
  /** 读取用户创建的 skill 详情(返回 {name, description, content};不存在返回 undefined) */
  getUserSkill(name: string): { name: string; description: string; content: string } | undefined
  /**
   * 清 skill 全文缓存(动态 skill 内容变化时主动失效)。不传 name 清全部;传 name 清指定。
   * 下次 load_skill 重新 getContent/readSkillDoc 取最新。需开启 skills(默认开)
   */
  invalidateSkillCache(name?: string): void
  /** 导出主数据 bind 的深拷贝(备份/迁移用);dataOps 关闭或无 data 返回 null */
  exportData(): any
  /**
   * 导入数据整体替换主数据 bind(就地还原,保留 reactive 引用)。
   * - 默认经 schema 校验,不合法返回 {ok:false,error};校验通过写入并发 data_change 事件,返回 {ok:true}
   * - opts.validate:false 跳过校验(集成方自行保证数据合法);opts.emit:false 不发 data_change 事件
   */
  importData(json: any, opts?: { validate?: boolean; emit?: boolean }): { ok: boolean; error?: string }
  /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
  usage: import('../types').TokenUsage
  /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 此 ref 自建 UI */
  pendingConflict: import('vue').Ref<PendingConflict | null>
  /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
  resolveConflict(action: ConflictResolution['action']): void
  /**
   * 运行时替换用户工具集(内置工具由 capabilities 控制,不动)。立即生效:下一轮 LLM 调用即用新工具集(内部 rebindTools)。
   * 不调用 = 现状行为(创建时 tools 固定)。支持按权限/业务阶段/A-B 实验动态切换工具组,无需重建 agent。
   */
  setTools(tools: StructuredToolInterface[]): void
  /** 运行时追加用户工具(去重 by name);立即生效。需先 mount */
  addTool(tool: StructuredToolInterface): void
  /** 运行时移除用户工具(by name);内置工具不受影响。返回是否移除成功 */
  removeTool(name: string): boolean
  /**
   * 运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)。
   * 参数为 BaseChatModel 实例或 LLMConfig(内部构造 ChatOpenAI)。立即生效:重新绑定工具 + 重解析模型能力(影响 offload 阈值/压缩)。
   * summaryLlm(摘要专用)不受影响。新模型若不支持 tool calling 则工具调用失效(agent 不崩)。
   */
  setLlm(llm: BaseChatModel | LLMConfig): void
  /**
   * 运行时更新持久指令 memory。支持 string 与同步/异步函数:
   *   - string:立即生效,下一轮 augmentPrompt 注入
   *   - () => string | Promise<string>:后台求值(适合异步加载 RAG 文档),求值完成自动生效
   * setMemory('') 清空。不调用 = 现状行为(创建时 options.memory 固定)。
   */
  setMemory(source: string | (() => string | Promise<string>)): void
  /**
   * 重新求值当前 memory 函数 source(用于 RAG 文档更新后强制刷新);返回最新文本。
   * 字符串 source 直接返回当前值。
   */
  refreshMemory(): Promise<string>
  /**
   * 运行时替换整个预声明子 agent 列表(重新生成 use_<id> 委派工具,立即生效)。
   * 需创建时配 subagents:[](否则 controller 为 null,setter warn);不调用 = 现状行为。
   */
  setSubagents(configs: SubagentConfig[]): void
  /** 运行时追加预声明子 agent(id 重复 warn 跳过);需创建时配 subagents:[] */
  addSubagent(config: SubagentConfig): void
  /** 运行时移除预声明子 agent(by id);返回是否移除成功;需创建时配 subagents:[] */
  removeSubagent(id: string): boolean
}

/** send/stream options:mission 显式覆盖(优先于自动 capture)+ interceptors per-call 覆盖(顶层 input/output)+ automation 重试次数覆盖 */
interface SendOptions {
  mission?: Partial<Mission>
  interceptors?: { input?: (input: unknown) => unknown; output?: (json: unknown) => unknown }
  maxAutoRetries?: number
}

/** 内存中保留的对话轮数上限(超限压缩为摘要,防 OOM);0 表示关闭 */
const DEFAULT_MAX_MEMORY_ROUNDS = 50


// ===== AgentCore:可被多实例共享的核心上下文 =====
type AgentInstance = ReturnType<typeof createAgent>
type TodosMw = ReturnType<typeof createTodosMiddleware>
type MemoryMw = ReturnType<typeof createMemoryMiddleware>
type MissionMw = ReturnType<typeof createMissionMiddleware>
type WorkingMemoryMw = ReturnType<typeof createWorkingMemoryMiddleware>
type FocusMw = ReturnType<typeof createFocusMiddleware>

/** 乐观锁冲突挂起(等用户决定保留外部/强制覆盖/回退);resolve 由 resolveConflict 调用,清空后工具继续 */
export interface PendingConflict {
  id: number
  op: 'set' | 'edit' | 'delete'
  agentValue?: unknown
  currentValue: unknown
  currentHash: string
  expectedHash: string
  snapshotId: number
  resolve: (r: ConflictResolution) => void
}

interface AgentCore {
  agentId: string
  store: SessionStore | null
  messages: AgentMessage[]
  vfsStore: VfsStore
  /** SDK 事件监听器集合(sdk.hook 注册;shareContext 时多实例共享同一 core,故合并于此) */
  listeners: Set<SdkEventHandler>
  todosMw: TodosMw
  memoryMw: MemoryMw
  /** mission 中间件实例(switchSession/onClear 调 reset;capabilities.missionAnchor 关闭仍创建但不装载) */
  missionMw: MissionMw
  /** workingMemory 中间件实例(switchSession/onClear 调 reset;capabilities.workingMemory 关闭仍创建但不装载) */
  workingMemoryMw: WorkingMemoryMw
  /** focus 中间件实例(switchSession/onClear 调 reset;capabilities.focus 关闭仍创建但不装载) */
  focusMw: FocusMw
  agent: AgentInstance | null
  initDone: Promise<void>
  /** 当前会话 id(可变;共享时多实例同步) */
  sessionId: string
  /** 引用计数(shareContext 时多实例共用一个 core) */
  refCount: number
  /** MCP client closers(unmount/release 时关闭) */
  mcpClosers: Array<() => Promise<void>>
  /** 已连 MCP server 元信息(getInfo 展示;失败的 server 不进) */
  mcpServers: { name: string; url: string; toolCount: number }[]
  /** 会话级 checkpoint 管理器(未开启 checkpoint → null) */
  checkpoint: CheckpointManager | null
  /** dataOps 控制器(运行时替换配置;dataOps 关闭 → null) */
  dataOpsController: DataOpsController | null
  /** skills 控制器(运行时 setSkills/invalidateSkillCache;skills 关闭 → null) */
  skillsController: import('../harness/skills').SkillsController | null
  /** 卸载 skill 附带工具(setSkills 替换整个列表清全部 / invalidateSkillCache 指定 skill;skill-external-scripts §5) */
  unloadSkillTools?: (name?: string) => void
  /** Agent 信息刷新 tick(setSkills/setData 后 ++);经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取,实时反映动态 skill/data */
  infoTick: Ref<number>
  /** 乐观锁冲突挂起(等用户决定保留外部/强制覆盖/回退);UI 经此 ref 渲染冲突对话框,无冲突时为 null */
  pendingConflict: Ref<PendingConflict | null>
  /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;storage 未开启 → []) */
  sessions: Ref<SessionMeta[]>
  /** 刷新历史会话列表到 sessions(内部 switchSession/deleteSession/onClear/init 调;集成方一般无需手动调,直接消费 sessions) */
  refreshSessions: () => Promise<void>
  /** 当前主数据配置(反映运行时替换;供 inspect/verify/getData 读最新状态) */
  liveData: () => DataConfig | undefined
  /** 累计 token 用量(每轮 LLM 调用累加;供 sdk.usage 暴露) */
  usage: import('../types').TokenUsage
  /** 内部事件分发(供 return 对象的 importData 等手动发事件复用) */
  emit: SdkEventHandler
  applySnapshot(snap: SessionSnapshot): void
  afterRound(): void
  send(message: string, options?: { mission?: Partial<Mission> }): Promise<string>
  switchSession(sessionId?: string): Promise<string>
  /** 新建/清空会话:重置内存态 + 新 sessionId + emit session_restored(onClear 调;P0-4 收编,原 onClear 闭包越界引用 buildCore 局部致 ReferenceError) */
  resetSession(): void
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 添加用户创建的 skill(持久化 + 入 controller;同名覆盖) */
  addSkill(skill: SkillSpec): void
  /** 删除用户创建的 skill(仅删用户创建的);返回是否删除成功 */
  removeSkill(name: string): boolean
  /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
  listUserSkills(): string[]
  /** 读取用户创建的 skill 详情(返回 {name, description, content};不存在返回 undefined) */
  getUserSkill(name: string): { name: string; description: string; content: string } | undefined
  /** 实例 unmount 时调;引用计数归零才真销毁(store.dispose + 移出注册表) */
  release(): void
  /** 冲突解决:用户点「保留外部」/「强制覆盖」/「回退」→ 收口挂起的 conflict,工具继续 */
  resolveConflict(action: ConflictResolution['action']): void
  /** 检视 agent 详情(inspect() 与 debug 窗口消费) */
  getInfo(): AgentInfo
  /** 读取当前 mission(capture 或 setMission;capabilities.missionAnchor:false → undefined) */
  getMission(): Mission | undefined
  /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
  setMission(mission: Partial<Mission>): void
  /** 读取当前聚焦焦点(未聚焦 / capabilities.focus:false → undefined) */
  getFocus(): Focus | undefined
  /** 设置聚焦焦点(path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
  setFocus(focus: Focus): { ok: boolean; error?: string }
  /** 清除聚焦焦点(退出精修模式) */
  clearFocus(): void
  /** 运行时替换用户工具集(内置不动);立即 rebind + infoTick 刷新 */
  setTools(tools: StructuredToolInterface[]): void
  /** 运行时追加用户工具(去重 by name) */
  addTool(tool: StructuredToolInterface): void
  /** 运行时移除用户工具(by name;内置不动);返回是否移除成功 */
  removeTool(name: string): boolean
  /** 运行时切换 LLM(BaseChatModel 或 LLMConfig);rebind + 重解析能力 + infoTick */
  setLlm(llm: BaseChatModel | LLMConfig): void
  /** 运行时更新 memory;支持 string 与同步/异步函数 */
  setMemory(source: string | (() => string | Promise<string>)): void
  /** 重新求值当前 memory 函数 source;返回最新文本 */
  refreshMemory(): Promise<string>
  /** 运行时替换预声明子 agent 列表(重新生成委派工具 + rebind) */
  setSubagents(configs: SubagentConfig[]): void
  /** 运行时追加预声明子 agent */
  addSubagent(config: SubagentConfig): void
  /** 运行时移除预声明子 agent(by id);返回是否移除成功 */
  removeSubagent(id: string): boolean
  /** 批处理(automation):逐任务跑 agent,每任务前 checkpoint,任务间错误隔离 */
  batch(tasks: string[], onProgress?: (p: BatchProgress) => void): Promise<BatchResult[]>
}

/** shareContext 注册表:agentId → AgentCore(同页同 id 复用) */
const sharedCores = new Map<string, AgentCore>()

/**
 * 数据写工具名 → operation 映射(供 onEvent 的 data_change 推断操作类型)。
 * 非数据写工具返回 null。write 高层入口按 args 推断(del→delete,patch→edit,否则 set)。
 */
function matchDataOp(name: string, args?: any): 'set' | 'edit' | 'delete' | 'restore' | null {
  if (name === 'set_data') return 'set'
  if (name === 'edit_data') return 'edit'
  if (name === 'delete_data') return 'delete'
  if (name === 'restore_data') return 'restore'
  if (name === 'write') {
    if (args?.del) return 'delete'
    if (args?.patch) return 'edit'
    return 'set'
  }
  return null
}

/**
 * 内部事件中间件:把常用时机经 onEvent 外发给集成方。
 * - wrapToolCall:数据写工具(set/edit/delete/restore)执行后发 data_change(operation/value)
 * - afterModel:每轮 LLM 调用后提取 usage 累加到 core.usage,发 usage 事件(单轮 + 累计)
 * - afterAgent:每轮 agent 结束发 message_update(消息数)
 * stream 事件(round_start/text/tool_call/done 等)由 core.stream 包装层转发(见下)。
 */
function createSdkEventMiddleware(emit: SdkEventHandler, messages: AgentMessage[], liveData: () => DataConfig | undefined, usage: TokenUsage): Middleware {
  let roundCounter = 0
  return {
    name: 'sdk-events',
    wrapToolCall: async (ctx: ToolCallContext, next) => {
      const result = await next(ctx)
      const op = matchDataOp(ctx.name, ctx.args)
      if (op) {
        emit({ type: 'data_change', operation: op, value: liveData()?.bind } as any)
      }
      return result
    },
    afterModel: (res) => {
      // 从 LLM 响应消息提取 usage(OpenAI/DeepSeek 在 additional_kwargs.usage;部分 provider 在 response_metadata.token_usage/usage)
      const ak = (res.message as any).additional_kwargs || {}
      const rm = (res.message as any).response_metadata || {}
      const u: any = ak.usage || rm.usage || rm.token_usage || rm.tokenUsage
      if (u && typeof u === 'object') {
        const p = Number(u.prompt_tokens ?? u.promptTokens ?? 0) || 0
        const c = Number(u.completion_tokens ?? u.completionTokens ?? 0) || 0
        const t = Number(u.total_tokens ?? u.totalTokens ?? (p + c)) || 0
        const roundUsage: TokenUsage = { prompt_tokens: p, completion_tokens: c, total_tokens: t }
        usage.prompt_tokens = (usage.prompt_tokens ?? 0) + p
        usage.completion_tokens = (usage.completion_tokens ?? 0) + c
        usage.total_tokens = (usage.total_tokens ?? 0) + t
        roundCounter++
        emit({ type: 'usage', round: roundCounter, usage: roundUsage, cumulative: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens } })
      }
    },
    afterAgent: async () => {
      emit({ type: 'message_update', count: messages.length })
    },
  }
}

/** 构建一个独立的核心上下文(含持久化恢复 + agent 构造 + 操作函数) */
function buildCore(options: ChatSdkOptions, agentId: string): AgentCore {
  // ===== 累计 token 用量(每轮 LLM 调用经 sdk-events 中间件 afterModel 提取累加;供 sdk.usage 暴露 + onEvent('usage') 单轮外发) =====
  const usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  // ===== 乐观锁冲突人工介入(dataOps 写入时检测到主数据已被外部改过 → 挂起等用户决定保留外部/强制覆盖/回退) =====
  // ===== 乐观锁冲突人工介入管理器(emit getter 延迟求值:emit 在下方 listeners 后定义,set 运行时才调) =====
  const conflictMgr = createConflictManager(() => emit)
  // Agent 信息刷新 tick:setSkills/setData 等运行时变更后 ++,经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取(实时反映动态 skill/data)
  const infoTick = ref(0)

  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (options.debug && store) {
    store.onEvent((e) => console.log('[page-agent-sdk][storage]', e))
  }

  // ===== 模型能力 + 摘要 LLM invoke(统一由 resolveLlm 解析;声明优先 > model 名查表 > 缺省)=====
  // let modelCaps:setLlm 后经 onLlmChange 重解析(影响 offload 阈值/压缩触发/maxTokens 缺省)
  const { modelCaps: initialModelCaps, summaryLlmInvoke, titleLlmInvoke } = resolveLlm(options)
  let modelCaps = initialModelCaps
  if (options.debug) console.log('[page-agent-sdk][modelCaps]', modelCaps)
  // harden-context-resilience:最小窗口校验(<200K throw,排除小窗口模型;设计假设 ≥200K)
  if (modelCaps.contextWindow < MIN_CONTEXT_WINDOW) {
    throw new Error(
      `[page-agent-sdk] 模型上下文窗口 ${modelCaps.contextWindow} 小于最小支持 ${MIN_CONTEXT_WINDOW}(需 ≥200K 窗口模型,如 GLM-5.2/Claude/Kimi/Qwen-1M/DeepSeek-v4)`,
    )
  }
  // recall-and-trim-llm 方向2:trim 异步 LLM 增强的配置门 + preserveSet(复用于 summarization 装配,消除重复 resolveContextOptions 调用)
  const resolvedCtxOpts = resolveContextOptions(options, modelCaps.contextWindow)
  const enableTrimLlm = resolvedCtxOpts.enableLLMSummary !== false
  const trimPreserveArr: string[] =
    (options.contextOptions && (options.contextOptions as any).preserveLastToolResults) ??
    PRESET_PRESERVE[options.contextPreset ?? 'auto']
  const trimPreserveSet = new Set<string>(trimPreserveArr)
  // 当前 LLM 实例/配置:setLlm 后更新(inspect().model 读最新);主 LLM 实例化由 createAgent/setLlm 处理
  let currentLlm: BaseChatModel | LLMConfig = options.llm
  if (options.debug && !summaryLlmInvoke) console.warn('[page-agent-sdk][summarization] 未构造 llmInvoke(apiKey 缺失?),摘要回退零成本索引摘要')

  // ===== 共享 messages(send/mount 唯一来源)=====
  const messages = reactive<AgentMessage[]>([])

  // ===== vfs + 中间件(保留可 reset 的引用以便恢复注入)=====
  const vfsStore = createVfs(options.vfs?.initialFiles, {
    persist: store
      ? { save: (files: Record<string, VfsFile>): void => {
          if (core.sessionId && store) void store.save(agentId, core.sessionId, { vfs: files })
        } }
      : undefined,
    maxBytes: options.vfs?.maxBytes,
    poolBytes: options.vfs?.poolBytes,
  })

  const todosMw = createTodosMiddleware([], { maxPlanRevisions: options.maxPlanRevisions })
  const missionMw = createMissionMiddleware()
  // 上下文聚焦(focus-context):指定组件精修,目标/视野/范围三层收敛。getSchema 延迟引用 liveData(适配 setData 运行时替换,同 checkpointMgr.getData 模式)
  const focusMw = createFocusMiddleware({ getSchema: () => liveData()?.schema })
  const workingMemoryMw = createWorkingMemoryMiddleware()
  const memoryMw = createMemoryMiddleware(options.memory || '')
  // memory 为函数(同步/异步)时,后台预求值,首次 beforeAgent 前尽量就绪(不阻塞 mount)
  if (typeof options.memory === 'function') void memoryMw.refresh()

  // agent 实例引用 holder(checkpoint manager 需读 agent.getState 取 todos,但 agent 在 initDone 内才创建;闭包延后读取)
  const agentRef: { current: any } = { current: null }

  // data:单主对象配置(schema + bind 直连,工具直接读写 bind,不挂 window;集成方按需自己挂 window)
  const finalDataConfig: DataConfig | undefined = options.data
    ? { ...options.data, description: options.data.description ?? '主数据对象' }
    : undefined

  // 会话级 checkpoint(默认关;传 options.checkpoint 开启):每轮自动存 + 一键回滚到上次正常时
  const checkpointOpts = options.checkpoint
  const useCheckpoint = checkpointOpts !== undefined && checkpointOpts !== false
  const checkpointMgr: CheckpointManager | null = useCheckpoint
    ? createCheckpointManager({
        getData: () => liveData()?.bind,  // 单对象 data 模式:快照/回滚主数据 bind(getter 适配 sdk.setData 运行时替换)
        consumeDataDirty: () => dataOpsController?.consumeDataDirty?.() ?? true,  // bind 脏标记增量(dataOpsController 在下方声明,闭包延迟引用同 getData→liveData;无 controller 返 true=整体 clone 向后兼容)
        slotPaths: finalDataConfig ? [''] : [],
        vfsStore,
        todosMw,
        getTodos: () => agentRef.current?.getState?.()?.todos ?? [],
        messages,
        maxCheckpoints:
          checkpointOpts && typeof checkpointOpts === 'object' ? checkpointOpts.maxCheckpoints : undefined,
      })
    : null
  const checkpointAuto = !checkpointOpts || typeof checkpointOpts !== 'object' || checkpointOpts.auto !== false

  // 内置能力开关(默认全开;false 则对应中间件/工具不装载)
  const caps = resolveCapabilities(options.capabilities)  // 单一解析(消除 !==false/===true 混;opt-in/out 经注册表 defaultOn,requires 表达依赖)
  const useDataOps = caps.dataOps
  const useDraft = caps.draftWrite  // draft_write/commit 分块构建大 JSON(opt-in,默认关;需 dataOps + vfs)
  const useTracing = caps.tracing  // 结构化追踪 TraceSpan(opt-in,默认关;采集有开销)
  const useAutomation = caps.automation  // 无人值守自动化(预算闸+错误恢复;opt-in,最远)

  // 最终 systemPrompt 的 base 段(不含数据段):用户 systemPrompt(或默认)+ 可选 reliableWriteRules 追加,统一由 buildSystemPrompt 处理
  // 数据段移交 dataHint 中间件每轮从 liveData() 动态重算(修 setData 不同步 Bug);inspect 与 createAgent 共用 baseSystemPrompt 保持一致
  const baseSystemPrompt = buildSystemPrompt(options)

  // 工具:数据操作 + 文档抓取 + 用户自定义(子 agent 中间件据此筛选只读子集)
  // dataOps/fetch 可经 capabilities 关闭(默认开,保持零配置;关则不进工具池,省 token/上下文);筛选经纯函数 selectBuiltinTools(可单测)
  const dataOpsTools = useDataOps && finalDataConfig
    ? createDataOps(finalDataConfig, {
        onAudit: options.onAudit ?? (options.debug ? (e) => console.log('[page-agent-sdk][data audit]', e) : undefined),
        maxSnapshots: options.maxSnapshots,
        onConflict: conflictMgr.set,
        autoLock: options.autoLock,
        interceptors: options.interceptors,
        vfsStore: useDraft ? vfsStore : undefined,  // draft 工具(opt-in):vfsStore 提供 → createDataOps 装 draft_write/draft_commit
      })
    : []
  // toolMode 筛选:simple(默认)主推 read/write 但保留高级能力;advanced 全暴露;minimal 只 read/write
  const dataOpsFiltered = useDataOps ? filterByToolMode(dataOpsTools, options.toolMode) : []
  // 数据操作控制器(运行时替换配置;dataOps 关闭时为 null)
  const dataOpsController = useDataOps && finalDataConfig
    ? (dataOpsTools as StructuredToolInterface[] & { controller?: DataOpsController }).controller ?? null
    : null
  /** 当前主数据配置(反映运行时替换;供 inspect/verify 等读最新状态) */
  const liveData = (): DataConfig | undefined => dataOpsController?.get() ?? finalDataConfig
  // 工具来源标注(builtin / mcp:<name> / user),供 getInfo 展示(DebugDrawer 区分内置/MCP/用户工具)
  const toolSources = new Map<string, string>()
  const builtinTools = selectBuiltinTools(caps, dataOpsFiltered, fetchDocTools, domTools, inspectTools)
  builtinTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  // userTools 可变:支持运行时 setTools/addTool/removeTool 动态增删用户工具
  const userTools: StructuredToolInterface[] = [
    ...(options.tools || []),
  ]
  userTools.forEach((t) => toolSources.set(t.name, 'user'))
  // 宿主动作(actions):集成方注册的页面操作 → 自动包成命名 tool;异常隔离(run 抛错回灌 LLM 不崩)
  const actionTools: StructuredToolInterface[] = actionsToTools(options.actions ?? {})
  actionTools.forEach((t) => toolSources.set(t.name, 'action'))
  // mcpTools 可变:mount 时收集,setTools 重建 extraTools 时纳入
  const mcpTools: StructuredToolInterface[] = []
  // 人工确认(主动侧):默认开启(不猜测,不确定/多方案/高风险时主动征询);顶层 humanConfirm:false 或 approval.humanConfirmTool:false 关闭
  const useHumanConfirm =
    options.humanConfirm !== false && (options.approval ? options.approval.humanConfirmTool !== false : true)
  const humanConfirmTool = useHumanConfirm ? createHumanConfirmTool() : null
  if (humanConfirmTool) toolSources.set(HUMAN_CONFIRM_TOOL_NAME, 'builtin')
  // 会话级 checkpoint 回滚工具(供 LLM 自纠:流程异常/走偏时回退到上次正常态)
  const checkpointTools: StructuredToolInterface[] = useCheckpoint && checkpointMgr
    ? [
        tool(
          async () => {
            const list = checkpointMgr.list()
            if (!list.length) return '无可用 checkpoint,无法回退。'
            const ok = checkpointMgr.restore()
            return ok
              ? `已回退到最近一次正常状态(checkpoint #${list[list.length - 1].id})。对话历史、主数据、vfs、todos 已整体还原。请基于回退后的状态重新判断并继续。`
              : '回退失败:无可用 checkpoint。'
          },
          { name: 'restore_last_checkpoint', description: '回退到最近一次正常状态(整体还原对话历史 + 主数据 + vfs + todos)。当本轮操作出错、页面被改坏、或走偏时调用,回到本轮起点重新来过。不传参数即回退最近一次。', schema: z.object({}).optional() },
        ),
        tool(
          async () => {
            const list = checkpointMgr.list()
            if (!list.length) return '无可用 checkpoint。'
            return '可用 checkpoint:\n' + list.map((c) => `#${c.id} [${c.label ?? 'auto'}] 消息数=${c.messageCount} 时间=${new Date(c.timestamp).toLocaleTimeString()}`).join('\n')
          },
          { name: 'list_checkpoints', description: '列出可用会话 checkpoint(回退点)。', schema: z.object({}).optional() },
        ),
      ]
    : []
  checkpointTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  // 上下文聚焦工具 set_focus/clear_focus(focus-context;advanced 暴露,simple/minimal 经 UI/宿主 API 触发)。
  // set_focus 校验 path 在 schema 内(getSchemaAtPath 命中)才聚焦,非法回灌错误让 LLM 自纠(同 sdk.setFocus 校验逻辑)
  const useFocus = caps.focus
  const setFocusTool = tool(
    async ({ path, label }: { path: string; label?: string }) => {
      const schema = liveData()?.schema
      if (!schema) return '聚焦失败:当前无主数据 schema,无法聚焦。'
      if (!getSchemaAtPath(schema, path)) return `PATH_DENIED · 聚焦失败:path "${path}" 不在 schema 内。请先用 read 查看可操作路径再聚焦。`
      focusMw.setFocus({ path, ...(label ? { label } : {}) })
      return `已聚焦到 ${path}${label ? `(${label})` : ''}。后续仅可写该子树(越界被拒),每轮只看到该组件结构。完成精修后调 clear_focus 退出。`
    },
    {
      name: 'set_focus',
      description: '聚焦到指定组件子树(如 components.3)精修。聚焦后:仅可写该子树(越界 PATH_DENIED)+ 每轮只看到该组件结构。多组件页面精修其中一个时用,避免改到别处。先 read 定位 path 再聚焦;完成调 clear_focus。',
      schema: z.object({ path: z.string().describe('要聚焦的组件 jsonPath,如 components.3'), label: z.string().optional().describe('人类可读标签,如「导航栏」') }),
    },
  )
  const clearFocusTool = tool(
    async () => {
      focusMw.clearFocus()
      return '已清除聚焦,恢复全量可操作范围(可读写所有组件)。'
    },
    { name: 'clear_focus', description: '清除当前聚焦,退出精修模式,恢复对全部组件的读写权限。', schema: z.object({}).optional() },
  )
  const focusTools: StructuredToolInterface[] = useFocus && options.toolMode === 'advanced' ? [setFocusTool, clearFocusTool] : []
  focusTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  // skill 附带工具(load_skill 后动态注入;skill-external-scripts §5)。按 skill 名记录归属,便于 invalidate/setSkills 卸载
  let loadedSkillTools: StructuredToolInterface[] = []
  const skillToolOwner = new Map<string, string>()  // toolName → skillName(source 标 `skill:<skillName>`)
  // allTools 可变:setTools 后重建,inspect().tools 读最新值
  // tool-name-collision:装配期 dedupeTools 收敛「自定义与内置重名」为后注册覆盖先注册(对齐 page-agent),
  // 消除「绑定层重复定义 + 执行层 builtin 赢(find 取第一个)+ 标注层后注册来源」三者漂移;覆盖时 warn 告警集成方
  let allTools: StructuredToolInterface[] = rebuildExtraTools()
  /** 重建 extraTools(传 createAgent 的 tools):dedupeTools 收敛 builtin + userTools + actions + humanConfirm + checkpoint + mcp(后覆盖先,返回唯一集) */
  function rebuildExtraTools(): StructuredToolInterface[] {
    const { tools, collisions } = dedupeTools([
      { label: 'builtin', tools: builtinTools },
      { label: 'user', tools: userTools },
      { label: 'action', tools: actionTools },
      { label: 'humanConfirm', tools: humanConfirmTool ? [humanConfirmTool] : [] },
      { label: 'checkpoint', tools: checkpointTools },
      { label: 'focus', tools: focusTools },
      { label: 'mcp', tools: mcpTools },
      { label: 'skill', tools: loadedSkillTools },
    ])
    if (collisions.length) {
      console.warn('[page-agent-sdk] 工具重名,后注册覆盖先注册:', collisions.map((c) => `${c.name}(${c.loser}→${c.winner})`).join(', '))
    }
    return tools
  }

  const usePlanning = caps.planning
  const useMission = caps.missionAnchor // mission 默认开(分层默认核心;长任务防跑偏)
  const useWorkingMemory = caps.workingMemory // workingMemory 默认开(pin 最近 path/hash,防压缩后丢定位)
  const useSkills = caps.skills
  const useVfs = caps.vfs
  // vfs 是内置中间件,其工具(createVfsMiddleware 注入)标 builtin(否则 inspect().tools 里会落到 'user',语义错)
  if (useVfs) {
    for (const n of VFS_TOOL_NAMES) toolSources.set(n, 'builtin')
  }
  // planning 是内置中间件,其工具(write_todos 整表替换 / update_todo 增量)标 builtin(否则落 'user',语义错;add-adaptive-planning)
  if (usePlanning) {
    for (const t of todosMw.tools ?? []) toolSources.set(t.name, 'builtin')
  }
  const useSummarization = caps.summarization
  const useMemory = caps.memory
  const useSubagent = caps.subagent
  // verify 默认关(烧 token);需 capabilities.verify:true + 未显式 enabled:false + maxAttempts>0(check 可选,省略则用 createWriteBackCheck)
  const verifyMaxAttempts = options.verify?.maxAttempts ?? 2
  const useVerify = caps.verify && options.verify?.enabled !== false && verifyMaxAttempts > 0
  const useContextInspector = caps.contextInspector  // 上下文检查(默认开,纯计算零 LLM 成本;inspectContext/进度条/tab)
  // 诊断:常见误用 warn(与 options.id/mcp 的 warn 惯例一致),避免"以为开了实际没开"
  if (options.verify?.check && !caps.verify) {
    console.warn('[page-agent-sdk][verify] 检测到 verify.check 但 capabilities.verify 未开启,verify 未装载')
  }

  // 子 agent 中间件(capabilities.subagent 或 subagent.enabled 为 false 则关闭)
  const subOpts = options.subagent
  // 子 agent 工具:allowedTools(从主池按名选)
  const subAllowed = subOpts?.allowedTools ?? []
  const subagentMw =
    !useSubagent || subOpts?.enabled === false
      ? undefined
      : createSubagentMiddleware({
          llm: subOpts?.llm ?? options.llm,
          allTools: () => allTools, // P1-4:getter —— setTools/addTool/MCP 动态加的工具对子 agent 立即可见(不用装配期快照)
          allowedTools: subAllowed.length ? subAllowed : undefined,
          // 子 agent 独立配置(自定义身份/温度/上下文上限/技能)
          systemPrompt: subOpts?.systemPrompt,
          temperature: subOpts?.temperature,
          maxTokens: subOpts?.maxTokens,
          skills: subOpts?.skills,
          maxDepth: subOpts?.maxDepth,
          maxParallel: subOpts?.maxParallel,
          debug: options.debug,
        })

  // 预声明子 agent(subagents:[] → 每个 use_<id> 委派工具;与上面 spawn 中间件共存)
  // 支持运行时动态:经 controller.set/add/remove 重新生成委派工具 + 触发 rebind
  // 注:subagents:[](空数组)也创建 controller,支持「初始无子 agent,运行时动态 add」场景(不依赖 length 判定)
  // capabilities.subagent 关闭时不创建(与 spawn 中间件一致)
  const subagentsMw = useSubagent && options.subagents !== undefined
    ? createSubagentsMiddleware(options.subagents, { llm: options.llm, allTools: () => allTools, debug: options.debug })
    : undefined
  const subagentsController = subagentsMw ? (subagentsMw as any).controller as import('../harness/subagent').SubagentsController : null

  // 对抗子 agent 的只读工具(白名单筛选,让其能实证读回数据检查而非臆测;dataOps 关闭则不含数据工具)
  const READONLY_FOR_ADVERSARIAL = ['get_data', 'describe_data', 'read', 'fetch_document']
  const readonlyTools = allTools.filter((t) => READONLY_FOR_ADVERSARIAL.includes(t.name))
  // verify 中间件(check 省略时默认 createWriteBackCheck 写后读回验证)。maxAttempts 经 maxVerifyAttempts 透传 createAgent,非中间件字段
  const verifyMw = useVerify
    ? createVerifyMiddleware({
        check: options.verify!.check ?? createWriteBackCheck({
          schemas: () => (liveData() ? { '': liveData()!.schema } : {}) as Record<string, any>,  // 动态取最新(适配 sdk.setData)
          root: () => liveData()?.bind,  // 单对象 data 模式:读回 root = bind(不挂 window);getter 适配 sdk.setData 运行时替换
        }),
        adversarial: options.verify?.adversarial ? { llm: options.llm, tools: readonlyTools } : undefined,
      })
    : undefined

  // 上下文检查中间件(context-inspector):每轮 wrapModelCall 快照实际消息构成(大小/分类/占比);默认开,纯计算零 LLM 成本
  const contextInspectorMw = useContextInspector
    ? createContextInspectorMiddleware({
        contextWindow: modelCaps.contextWindow,
        thresholdRatio: resolveContextOptions(options, modelCaps.contextWindow).summaryThresholdRatio,
      })
    : undefined

  // 能力用法提示(最前,紧跟 base systemPrompt;按 caps 注入,全关则不注入)
  const usageHintsMw = createUsageHintsMiddleware(
    {
      ...caps,
      humanConfirm: useHumanConfirm,
      // 预声明子 agent(供"规划-反思-执行"路由提示;只取 id/description/temperature 轻量字段)
      subagents: options.subagents?.map((s) => ({ id: s.id, description: s.description, temperature: s.temperature })),
    },
    useDataOps && !!finalDataConfig,
    options.toolMode,
  )
  // A4「可操作数据」段:每轮从 liveData() 动态重算(修 setData 不同步 Bug)
  // 插中间件栈最前(usageHints 之前),保证数据段紧跟 base —— LLM 看到的 system 结构与现状等价
  // 仅 finalDataConfig 存在时装载;无 data → buildDataPrompt 返 '' → augmentPrompt 返 undefined → 跳过
  const dataHintMw: Middleware | null = finalDataConfig
    ? { name: 'dataHint', augmentPrompt: () => buildDataPrompt(liveData(), options.schemaHint) || undefined }
    : null

  // augmentSystem 钩子:集成方按运行时状态(state/data)动态注入 system prompt 段
  // 插 subagents 之后、用户 middleware 之前(遵循 verify 既定「用户自定义中间件前」约定)
  // 回调异常降级为跳过该段 + debug 日志(不崩 agent);仅 options.augmentSystem 存在时装载
  const augmentSystemMw: Middleware | null = options.augmentSystem
    ? {
        name: 'augmentSystem',
        augmentPrompt: (state) => {
          try {
            return options.augmentSystem!({ state, data: liveData() })
          } catch (e) {
            if (options.debug) console.log('[page-agent-sdk][augmentSystem] 回调抛错,降级跳过:', (e as Error).message)
            return undefined
          }
        },
      }
    : null
  // SDK 事件回调:把常用时机外发给集成方(数据槽变化 / 消息更新 / 流式事件 / 错误)
  const userOnEvent = options.onEvent
  // SDK 事件系统(sdk.hook 注册监听器;emit 外发事件,approval_request 不外发,onEvent/listeners 各自 try/catch 隔离)
  const events = createSdkEvents(options.onEvent)
  const emit = events.emit

  let skillsMw: ReturnType<typeof createSkillsMiddleware> | undefined
  // 用户在 ChatDialog 创建的 skill(独立持久化;与集成方 initialSkills 合并后给 controller,同名 userSkills 覆盖)
  let userSkills: SkillSpec[] = []
  /** SkillSpec ↔ PersistedSkill 转换:持久化时把 getContent 闭包的 content 提取为字符串;恢复时还原为 getContent */
  const toPersistedSkill = (s: SkillSpec): PersistedSkill => ({
    name: s.name,
    description: s.description,
    // 用户创建的 skill 用 getContent 存 content;doc 类 skill 由集成方代码控制,不持久化
    content: typeof s.getContent === 'function' ? (s.getContent() as string) : '',
  })
  const toSkillSpec = (p: PersistedSkill): SkillSpec => ({
    name: p.name,
    description: p.description,
    getContent: () => p.content,
  })

  // ===== Skill 独立持久化(与 storage 选项分离;默认 indexedDB,可手动指定 id 跨页复用)=====
  const skillStore: SkillStore | null =
    options.skillStorage === false ? null : createSkillStore({
      ...(typeof options.skillStorage === 'object' ? options.skillStorage : {}),
      id: options.skillStorage && typeof options.skillStorage === 'object' && options.skillStorage.id
        ? options.skillStorage.id
        : `agent::${agentId}`,
    })

  /** 合并 initialSkills + userSkills(同名 userSkills 覆盖)→ controller.set;持久化 userSkills 到 SkillStore */
  const syncUserSkills = () => {
    const ctrl = skillsMw ? (skillsMw as any).controller as import('../harness/skills').SkillsController : null
    if (ctrl) {
      const initial = (options.skills || []).filter((s) => !userSkills.some((u) => u.name === s.name))
      ctrl.set([...initial, ...userSkills])
    }
    core.infoTick.value++
  }
  /** 从 SkillStore 加载用户 skill 到内存 + controller(挂载时调) */
  const loadUserSkillsFromStore = async () => {
    if (!skillStore) return
    try {
      const persisted = await skillStore.list()
      if (persisted.length) {
        userSkills = persisted.map(toSkillSpec)
        const ctrl = skillsMw ? (skillsMw as any).controller as import('../harness/skills').SkillsController : null
        if (ctrl) {
          const initial = (options.skills || []).filter((s) => !userSkills.some((u) => u.name === s.name))
          ctrl.set([...initial, ...userSkills])
        }
        core.infoTick.value++
      }
    } catch {
      /* skillStore 读取失败静默(降级内存,当前会话仍可用) */
    }
  }
  // harden-context-resilience:summarization 提取为变量(setLlm 后 onLlmChange 经 setContextWindow 回灌新 contextWindow)
  const summarizationMw = useSummarization
    ? createSummarizationMiddleware({
        // 预设档位(默认 auto)提供合理默认 → contextOptions 细参覆盖个别字段 → 兜底;复用 buildCore 顶部 resolvedCtxOpts
        ...resolvedCtxOpts,
        llmInvoke: summaryLlmInvoke,
        // A:压缩时注入当前主数据说明(防 LLM 基于过时记忆操作;dataOps 关闭时 liveData() 返回 undefined,无影响)
        getRegisteredData: () => liveData() ? [{ description: liveData()!.description ?? '主数据对象' }] : [],
        // C:跨轮摘要时保留 describe/read 工具的 result 摘要(防字段描述被摘要掉);复用 buildCore 顶部 trimPreserveArr
        preserveLastToolResults: trimPreserveArr,
      })
    : undefined
  // 中间件按声明式 priority 排序(替代数组字面量位置硬编码);条件构造顺序无关,末尾统一排序保证约束(declarative-middleware-ordering)
  const middlewares = composeMiddlewareStack([
    // dataHint 插最前:数据段紧跟 base(与现状等价);每轮从 liveData() 动态重算
    ...(dataHintMw ? [dataHintMw] : []),
    usageHintsMw,
    // 按 capabilities 条件装载内置中间件(默认全开;verify 默认关)
    ...(useMission ? [missionMw] : []), // mission 在 todos 前(pin 段在 todos 段前;revive-mission-anchor)
    ...(usePlanning ? [todosMw] : []),
    ...(useSkills
      ? [
          skillsMw = createSkillsMiddleware(options.skills || [], {
            // vfs 启用时注入 readVfs,让 skill 文档源(vfs://path)能读取 vfs 文件
            readVfs: useVfs ? (p: string) => vfsStore.files[p]?.content : undefined,
            // skill exec context:'host' 开关(caps.skillHostScript,opt-in 默认关;关时 host 脚本跳过 + warn)
            hostScriptEnabled: caps.skillHostScript,
            // skill 附带工具注入回调:load_skill 后合并 loadedSkillTools + 标 source + rebind(skill-external-scripts §5)
            onToolsReady: (skillName, tools) => {
              for (const t of tools) {
                // 同名 skill 工具先移除旧记录(避免重复累积;dedupeTools 兜底后注册覆盖)
                const existing = loadedSkillTools.findIndex((x) => x.name === t.name)
                if (existing >= 0) loadedSkillTools.splice(existing, 1)
                loadedSkillTools.push(t)
                skillToolOwner.set(t.name, skillName)
                toolSources.set(t.name, `skill:${skillName}`)
              }
              allTools = rebuildExtraTools()
              if (core.agent) core.agent.setTools(allTools)
              core.infoTick.value++
            },
          }),
        ]
      : []),
    ...(useVfs ? [createVfsMiddleware(vfsStore)] : []),
    ...(summarizationMw ? [summarizationMw] : []), // summarization:跨轮历史压缩(setLlm 后 setContextWindow 回灌新窗口)
    ...(useWorkingMemory ? [workingMemoryMw] : []), // summarization 后(augmentPrompt 段跨压缩保留;pin 最近 read/query/search 的 path/hash)
    ...(useFocus ? [focusMw] : []), // workingMemory 后:上下文聚焦(目标/视野/范围三层收敛 pin 段;同 mission 跨压缩保留)
    ...(useMemory ? [memoryMw] : []),
    ...(options.permissions?.length ? [createPermissionsMiddleware(options.permissions)] : []),
    // 会话级 checkpoint:auto 模式每轮 beforeModel 首次自动存(回滚到上次正常时);顺序无关(仅 beforeAgent/beforeModel 副作用)
    ...(useCheckpoint && checkpointAuto && checkpointMgr ? [createCheckpointMiddleware(checkpointMgr)] : []),
    // 人工确认(主动侧):拦截 request_human_confirmation,发 approval_request;装在 approval 白名单之前(更外层,先收口,避免双重确认)
    ...(useHumanConfirm ? [createHumanConfirmMiddleware()] : []),
    // 人工确认(被动侧):白名单工具调用前确认(wrapToolCall 洋葱,此处更内层)
    ...(options.approval && (options.approval.tools !== undefined || !!options.approval.confirm)
      ? [createApprovalMiddleware(options.approval)]
      : []),
    ...(verifyMw ? [verifyMw] : []), // permissions 之后(beforeReturn 正序,verify 在用户自定义中间件前)
    ...(subagentMw ? [subagentMw] : []),
    ...(subagentsMw ? [subagentsMw] : []),
    ...(augmentSystemMw ? [augmentSystemMw] : []),
    ...(contextInspectorMw ? [contextInspectorMw] : []),  // context-inspector:wrapModelCall 快照实际消息构成(大小/分类/占比)
    ...(options.middleware || []),
    // 资源预算闸(automation-layer Phase 4):wrapModelCall 每轮检查 token/time,超限 → aborted response 停止 agent + emit BUDGET_EXCEEDED
    ...(useAutomation ? [createBudgetMiddleware(usage, { tokenBudget: options.tokenBudget, timeBudgetMs: options.timeBudgetMs }, emit)] : []),
    // SDK 事件中间件(最末,最后观察):数据写后发 data_change;每轮结束发 message_update
    // 始终装载 —— 集成方可能运行时 sdk.hook() 订阅,构造时无 onEvent 也需就绪;无监听器时 emit 为 no-op,开销可忽略
    createSdkEventMiddleware(emit, messages, liveData, usage),
  ])

  const maxMemoryRounds = options.maxMemoryRounds ?? DEFAULT_MAX_MEMORY_ROUNDS

  // session-history Phase 6:会话历史响应式状态下沉(集成方直接消费 sdk.sessions,无需手动 listSessions/refresh/hook)
  const sessionsRef: Ref<SessionMeta[]> = ref([])
  /** 刷新历史会话列表到 sessionsRef(switchSession/deleteSession/onClear/init 后调;storage 未开启 no-op) */
  async function refreshSessions(): Promise<void> {
    if (!store) return
    sessionsRef.value = (await store.listSessions(agentId)).sort((a, b) => b.lastAccessed - a.lastAccessed)
  }

  const core: AgentCore = {
    agentId,
    store,
    messages,
    vfsStore,
    listeners: events.listeners,
    todosMw,
    memoryMw,
    missionMw,
    workingMemoryMw,
    focusMw,
    agent: null,
    initDone: Promise.resolve(),
    sessionId: '',
    refCount: 0,
    mcpClosers: [],
    mcpServers: [],
    checkpoint: checkpointMgr,
    dataOpsController,
    skillsController: skillsMw ? (skillsMw as any).controller as import('../harness/skills').SkillsController : null,
    infoTick,
    pendingConflict: conflictMgr.pendingConflict,
    sessions: sessionsRef,
    refreshSessions,
    liveData,
    usage,
    emit,

    /** 卸载 skill 附带工具(setSkills 替换整个列表清全部 / invalidateSkillCache 指定 skill;skill-external-scripts §5) */
    unloadSkillTools(name?: string) {
      if (!name) {
        if (!loadedSkillTools.length) return
        for (const t of loadedSkillTools) { toolSources.delete(t.name); skillToolOwner.delete(t.name) }
        loadedSkillTools = []
      } else {
        const before = loadedSkillTools.length
        loadedSkillTools = loadedSkillTools.filter((t) => {
          if (skillToolOwner.get(t.name) === name) { toolSources.delete(t.name); skillToolOwner.delete(t.name); return false }
          return true
        })
        if (loadedSkillTools.length === before) return
      }
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
    },

    /** 持久化恢复:灌入 messages / vfs / todos / memory / userSkills(hydrate 不触发 vfs save) */
    applySnapshot(snap: SessionSnapshot): void {
      if (snap.messages?.length) messages.push(...snap.messages)
      if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
      if (snap.todos?.length) todosMw.reset(snap.todos)
      // memory:options.memory 优先(非空覆盖),否则用持久化的
      if (snap.memory && !options.memory) memoryMw.reset(snap.memory)
      // automation 断点续跑:恢复 checkpoint 栈 + 累计 usage(刷新后 restoreLastCheckpoint 能用 + 预算统计连续)
      if (snap.checkpoints?.length && checkpointMgr) checkpointMgr.importStack(snap.checkpoints)
      // 恢复累计 usage(断点续跑:刷新后预算统计连续)。一次性恢复覆盖:此处把 snap.usage 整体赋到 usage;
      // 之后 sdk-events afterModel 在恢复后的 usage 上继续累加 —— 非"双写"(applySnapshot 恢复时一次性 + afterModel 每轮累加,时机不同,语义一致:恢复基线 + 后续累加)
      if (snap.usage) Object.assign(usage, snap.usage)
      // context-persist-resilience 功能A:恢复 mission/workingMemory(刷新/切会话后长任务目标 + 工作记忆不丢;reset 在 applySnapshot 前,恢复值不被清)
      if (snap.mission && useMission) missionMw.setMission(snap.mission)
      if (snap.workingMemory && useWorkingMemory) workingMemoryMw.restore(snap.workingMemory)
      // context-persist-resilience 功能B:加载兜底 GC —— 清历史孤儿(旧存档漏网 / 上轮 GC 漏的);新会话无孤儿则空操作
      gcVfsOrphans()
      // 注:用户创建的 skill 不再随 SessionSnapshot 持久化,由独立 SkillStore 管理(见 loadUserSkillsFromStore)
    },

    /** 添加用户创建的 skill(持久化到 SkillStore + 入 controller;同名覆盖) */
    addSkill(skill: SkillSpec): void {
      const idx = userSkills.findIndex((s) => s.name === skill.name)
      if (idx >= 0) userSkills[idx] = skill
      else userSkills.push(skill)
      syncUserSkills()
      if (skillStore) void skillStore.put(toPersistedSkill(skill))
    },
    /** 删除用户创建的 skill(仅删用户创建的;从 SkillStore 移除);返回是否删除成功 */
    removeSkill(name: string): boolean {
      const idx = userSkills.findIndex((s) => s.name === name)
      if (idx < 0) return false
      userSkills.splice(idx, 1)
      syncUserSkills()
      if (skillStore) void skillStore.remove(name)
      return true
    },
    /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
    listUserSkills(): string[] {
      return userSkills.map((s) => s.name)
    },
    /** 读取用户创建的 skill 详情(SkillPanel 编辑时调) */
    getUserSkill(name: string): { name: string; description: string; content: string } | undefined {
      const s = userSkills.find((u) => u.name === name)
      if (!s) return undefined
      return {
        name: s.name,
        description: s.description,
        content: typeof s.getContent === 'function' ? (s.getContent() as string) : '',
      }
    },

    /** 一轮结束后:裁内存历史(防 OOM)+ 安排持久化(debounced)。落盘等待由 onPersist/send 显式 await flush 保证 */
    afterRound(): void {
      trimMemoryMessages()
      persistRuntime()
    },

    async send(message: string, options?: SendOptions): Promise<string> {
      await core.initDone
      // 容错:partial 调用(headless 实测 sdk.send(msg) 不传 options)→ 默认空对象,避免 options.interceptors 误访问 undefined
      options = options ?? {}
      // mission 显式覆盖(send({mission}) 优先于自动 capture)
      if (options?.mission && useMission) missionMw.setMission(options.mission)
      // input 拦截器:send 入口预处理 user message(可改写/审计)
      let msg = message
      if (options.interceptors?.input) {
        try { const r = options.interceptors.input(message); if (typeof r === 'string') msg = r } catch { /* 拦截器抛错忽略,用原 message */ }
      }
      // automation 无人值守错误恢复:致命错误(invoke 抛错)→ restore_last_checkpoint 回到本轮前 + 重试(限 maxAutoRetries 次防循环)。
      // 适合无人值守批量/长任务:单点模型/工具致命错误不永久中断,自动回退重试;确定性错误重试仍耗尽 → fatal(emit + throw)。
      // checkpoint 在 beforeModel save(时点在 push user 后)→ restore 后 messages 已含本轮 user,故用 pushed 标记避免重复 push。
      const maxAuto = useAutomation ? (options.maxAutoRetries ?? 1) : 0
      let attempt = 0
      let pushed = false
      while (true) {
        if (!pushed) {
          messages.push({ role: 'user', content: msg, timestamp: Date.now() })
          pushed = true
        }
        try {
          let reply = await core.agent!.invoke(messages)
          // output 拦截器:返回前 postprocess(可改写最终回复)
          if (options.interceptors?.output) {
            try { const r = options.interceptors.output(reply); if (typeof r === 'string') reply = r } catch { /* 拦截器抛错忽略,用原 reply */ }
          }
          messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
          core.afterRound()
          if (store) await store.flush() // 确保落盘完成(indexed 异步事务;刷新前已写入)
          return reply
        } catch (err) {
          const ae = asAgentError(err, 'fatal')
          // 仍有重试次数 + 有 checkpoint 可回退 → restore 回本轮前(含本轮 user)+ 重试,emit observable 告知
          if (attempt < maxAuto && checkpointMgr?.canRestore()) {
            attempt += 1
            checkpointMgr.restore()
            pushed = true // restore 后 messages 已含本轮 user(checkpoint 在 beforeModel save,时点在 push user 后),不重复 push
            emit({ type: 'error', message: `致命错误自动恢复(${attempt}/${maxAuto}):${ae.message},已回退 checkpoint 重试`, severity: 'observable', code: 'AUTO_RECOVER_RETRY', context: { attempt, cause: ae.code ?? ae.message.slice(0, 120) } } as any)
            continue
          }
          // 重试耗尽或未开 automation:invoke 抛错 = fatal(emit 结构化 error + 重新抛中断);asAgentError 归一化提取 severity/code/context
          emit({ type: 'error', message: ae.message, severity: ae.severity, ...(ae.code ? { code: ae.code } : {}), ...(ae.context !== undefined ? { context: ae.context } : {}) } as any)
          throw err
        }
      }
    },

    /**
     * 批处理(automation):逐任务跑 agent,每任务前自动 checkpoint(失败可 restoreLastCheckpoint 回退到任务前),
     * 任务间错误隔离(单任务失败不中断整批,记 observable error 继续下一个)。适合无人值守批量操作(批量生成/改一批页面)。
     * 不经 UI 排队(直接 invoke);返回每个任务结果(成功 reply / 失败 error)。配合 capabilities.automation + checkpoint 使用。
     */
    async batch(tasks: string[], onProgress?: (p: BatchProgress) => void): Promise<BatchResult[]> {
      await core.initDone
      if (!tasks.length) return []
      const results: BatchResult[] = []
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]
        // 每任务前存 checkpoint:该任务失败时 restoreLastCheckpoint 可回退到任务前态
        if (checkpointMgr) checkpointMgr.save(`batch:${i}`)
        const beforeLen = messages.length  // 失败时 truncate 回(撤销本轮 user + invoke 期间的中间 push)
        try {
          messages.push({ role: 'user', content: task, timestamp: Date.now() })
          const reply = await core.agent!.invoke(messages)
          messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
          core.afterRound()
          if (store) await store.flush()
          results.push({ index: i, task, reply, ok: true })
          onProgress?.({ done: i + 1, total: tasks.length, task, ok: true })
        } catch (err) {
          // 任务级错误隔离:invoke 抛错不中断整批;truncate 回本轮前(撤销 user + 中间 push,防失败 user 残留致下一任务连续 user 上下文错乱 — bug-review MED)+ 记 observable error
          if (messages.length > beforeLen) messages.splice(beforeLen)
          const ae = asAgentError(err, 'fatal')
          emit({ type: 'error', message: `批量任务 ${i + 1}/${tasks.length} 失败:${ae.message}`, severity: 'observable', code: 'BATCH_TASK_FAILED', context: { index: i, task: task.slice(0, 100) } } as any)
          results.push({ index: i, task, error: ae.message, ok: false })
          onProgress?.({ done: i + 1, total: tasks.length, task, ok: false })
        }
      }
      return results
    },

    /** 切换会话:flush 当前 → 载入/新建目标 → 清内存态并灌入快照(替换语义)→ 返回新会话 id */
    async switchSession(sessionId?: string): Promise<string> {
      await core.initDone
        if (!store) throw new Error('page-agent-sdk: storage 未开启,无法切换会话(请传 storage 选项)')
      // 收口挂起的冲突(按「保留外部」),防切会话后旧 conflict Promise 永久挂起
      conflictMgr.resolve('keep_external')
      // context-persist-resilience:切走前 persist 当前会话的 mission/workingMemory(防 setMission / 工作记忆积累后切走丢失;persistRuntime 仅 afterRound 触发,setMission 后未发消息即切会话会漏存)
      if (core.sessionId && store) {
        if (useMission) { const m = missionMw.getMission(); if (m) void store.save(agentId, core.sessionId, { mission: m } as Partial<SessionSnapshot>) }
        if (useWorkingMemory) { const wm = workingMemoryMw.getWorkingMemory(); if (wm) void store.save(agentId, core.sessionId, { workingMemory: wm } as Partial<SessionSnapshot>) }
      }
      vfsStore.flush?.()
      await store.flush()
      let target = sessionId ?? ''
      let snap: SessionSnapshot | undefined
      if (target) {
        snap = await store.load(agentId, target)
        if (!snap) await store.createSession(agentId, options.session?.title, target)
      } else {
        target = await store.createSession(agentId, options.session?.title)
      }
      core.sessionId = target
      // 清空当前内存态(替换语义,非叠加)
      messages.splice(0, messages.length)
      vfsStore.clear?.()
      todosMw.reset([])
      if (!options.memory) memoryMw.reset('')
      // P1-5:切会话重置 mission/workingMemory,防旧会话 goal / 定位 path·hash 污染新会话(过期 hash 诱发乐观锁误冲突)
      missionMw.reset()
      workingMemoryMw.reset()
      focusMw.reset()
      // session-history S1:切会话清 checkpoint 栈,防旧会话快照污染新会话(开 checkpoint 时,否则 restore 会回退到旧会话态)
      if (checkpointMgr) checkpointMgr.importStack([])
      // 释放上一会话的调试日志(切会话后旧日志不再相关,立即释放内存)
      core.agent!.debugLogs.value = []
      if (!snap) snap = await store.load(agentId, target)
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: target, rounds: snap.messages?.length ?? 0 })
      }
      if (options.memory) void store.save(agentId, core.sessionId, { memory: memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
      void refreshSessions()  // session-history Phase 6:切会话后刷新历史列表(响应式 sessions 自动更新)
      lastTitle = undefined; titleLLMDone = false   // 切会话:重置 title 缓存 + LLM 标志,新会话重新生成
      return target
    },

    /** 新建/清空会话:重置内存态(vfs/todos/memory/mission/workingMemory/checkpoint/debugLogs)+ 新 sessionId + emit session_restored。
     *  收编进 core(主流程审查 P0-4):onClear 闭包原在 createChatSdk 作用域赋值 buildCore 局部 lastTitle/titleLLMDone → 运行期 ReferenceError;
     *  共享状态变更一律 AgentCore 方法(mount Wrapper 只传引用不写逻辑,1.3.1 教训机制化)。 */
    resetSession: () => {
      if (!store) return
      core.sessionId = makeId()
      vfsStore.clear?.()
      todosMw.reset([])
      if (!options.memory) memoryMw.reset('')
      missionMw.reset()
      workingMemoryMw.reset()
      focusMw.reset()
      if (checkpointMgr) checkpointMgr.importStack([])
      if (core.agent) core.agent.debugLogs.value = []
      void store.createSession(core.agentId, options.session?.title, core.sessionId)
      emit({ type: 'session_restored', sessionId: core.sessionId, rounds: 0 })
      void refreshSessions()
      lastTitle = undefined; titleLLMDone = false
    },

    stream: (msgs, onEvent, signal) => {
      if (!core.agent) throw new Error('page-agent-sdk: agent 尚未初始化完成,请先 await mount()')
      // P4(harden-context-resilience):注入被引用集 → vfs LRU 淘汰时跳过被消息引用的 large_results(防 vfs_read 404)
      vfsStore?.setProtectedRefs?.(extractVfsRefs(msgs))
      // 包装:把 stream 事件同时转发给集成方 onEvent(approval_request 已由 emit 过滤)
      const wrappedHandler: StreamHandler = userOnEvent
        ? (event) => { onEvent?.(event); emit(event as SdkEvent) }
        : onEvent
      // abort 联动:用户停止生成时,自动收口挂起的乐观锁冲突(按「保留外部」处理,防工具永久挂起)
      if (signal) {
        const abortConflict = () => conflictMgr.resolve('keep_external')
        if (signal.aborted) abortConflict()
        else signal.addEventListener('abort', abortConflict, { once: true })
      }
      return core.agent.stream(msgs, wrappedHandler, signal)
    },

    release(): void {
      core.refCount--
      if (core.refCount <= 0) {
        if (store) {
          vfsStore.flush?.()
          void store.flush()
          store.dispose()
        }
        if (skillStore) skillStore.dispose()
        const closers = core.mcpClosers.splice(0)
        if (closers.length) void Promise.allSettled(closers.map((c) => c()))
        sharedCores.delete(agentId)
      }
    },

    resolveConflict: conflictMgr.resolve,

    /** 运行时替换用户工具集(内置不动);立即 rebind + infoTick 刷新 */
    setTools(tools: StructuredToolInterface[]): void {
      userTools.length = 0
      tools.forEach((t) => { userTools.push(t); toolSources.set(t.name, 'user') })
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
      core.infoTick.value++
    },
    /** 运行时追加用户工具(tool-name-collision:重名按后注册覆盖先注册,跨最终工具集去重 + warn,不再静默 return) */
    addTool(tool: StructuredToolInterface): void {
      if (allTools.some((t) => t.name === tool.name)) {
        console.warn(`[page-agent-sdk] 工具 "${tool.name}" 已存在,新工具覆盖(后注册覆盖先注册)`)
      }
      // userTools 内同名先移除(避免数组脏累积);rebuildExtraTools 的 dedupeTools 保证最终唯一(且 user 覆盖 builtin/action)
      for (let i = userTools.length - 1; i >= 0; i--) if (userTools[i].name === tool.name) userTools.splice(i, 1)
      userTools.push(tool)
      toolSources.set(tool.name, 'user')
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
      core.infoTick.value++
    },
    /** 运行时移除用户工具(by name;内置不动);返回是否移除成功 */
    removeTool(name: string): boolean {
      const idx = userTools.findIndex((t) => t.name === name)
      if (idx < 0) return false
      userTools.splice(idx, 1)
      toolSources.delete(name)
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
      core.infoTick.value++
      return true
    },
    /** 运行时切换 LLM(BaseChatModel 或 LLMConfig);rebind + 重解析能力 + infoTick */
    setLlm(llmOpt: BaseChatModel | LLMConfig): void {
      let newLlm: BaseChatModel
      if (isChatModel(llmOpt)) {
        newLlm = llmOpt as BaseChatModel
      } else {
        const cfg = llmOpt as LLMConfig
        if ((cfg.provider ?? 'openai') === 'anthropic') {
          // Anthropic 动态 import 无法同步:setLlm 是同步契约(void),切 Anthropic 需传预构造的 BaseChatModel 实例
          throw new Error('[page-agent-sdk][setLlm] 切换到 Anthropic 需传 BaseChatModel 实例(动态 import 无法同步);请先 const { ChatAnthropic } = await import("@langchain/anthropic") 构造实例后传入')
        }
        newLlm = constructOpenLlmSync(cfg)
      }
      if (typeof (newLlm as any).bindTools !== 'function' && options.debug) {
        console.warn('[page-agent-sdk][setLlm] 新模型不支持 bindTools(tool calling 会失效)')
      }
      currentLlm = llmOpt
      // harden-context-resilience:权威重算 modelCaps(用原 llmOpt,保留 LLMConfig.contextWindow 声明)+ 最小窗口校验 + 集中回灌
      // (setLlm 把 LLMConfig 构造成 BaseChatModel 实例后 contextWindow 声明丢失;onLlmChange 拿不到 → 在此用 llmOpt 重算)
      const llmCfg = isChatModel(llmOpt) ? undefined : (llmOpt as LLMConfig)
      modelCaps = resolveModelCaps({
        model: llmCfg?.model ?? (llmOpt as any).model ?? (llmOpt as any).modelName,
        contextWindow: options.contextWindow ?? llmCfg?.contextWindow,
        maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens,
      })
      if (modelCaps.contextWindow < MIN_CONTEXT_WINDOW) {
        throw new Error(`[page-agent-sdk][setLlm] 新模型上下文窗口 ${modelCaps.contextWindow} 小于最小支持 ${MIN_CONTEXT_WINDOW}(需 ≥200K 窗口模型)`)
      }
      if (core.agent) {
        core.agent.setLlm(newLlm) // → onLlmChange(仅更新 currentLlm 实例)
        core.agent.setModelCaps?.(modelCaps) // offload 阈值跟随新窗口(修原固化)
      }
      summarizationMw?.setContextWindow?.(modelCaps.contextWindow)
      contextInspectorMw?.setContextWindow?.(modelCaps.contextWindow)
      core.infoTick.value++
      if (options.debug) console.log('[page-agent-sdk][setLlm] 重解析 modelCaps + 回灌:', modelCaps)
    },
    /** 运行时更新 memory;支持 string 与同步/异步函数(异步函数后台求值,下一轮 beforeAgent 前就绪)*/
    setMemory(source: string | (() => string | Promise<string>)): void {
      memoryMw.reset(source)
      if (typeof source === 'function') void memoryMw.refresh()
      core.infoTick.value++
    },
    /** 重新求值当前 memory 函数 source(用于 RAG 文档更新后强制刷新);返回最新文本 */
    refreshMemory(): Promise<string> {
      return memoryMw.refresh()
    },
    /** 运行时替换预声明子 agent 列表(重新生成委派工具 + rebind) */
    setSubagents(configs: SubagentConfig[]): void {
      if (!subagentsController) {
        if (options.debug) console.warn('[page-agent-sdk][setSubagents] 未配 subagents:[] 或 capabilities.subagent 关闭,忽略')
        return
      }
      subagentsController.set(configs)
      core.infoTick.value++
    },
    /** 运行时追加预声明子 agent */
    addSubagent(config: SubagentConfig): void {
      if (!subagentsController) {
        if (options.debug) console.warn('[page-agent-sdk][addSubagent] 未配 subagents:[] 或 capabilities.subagent 关闭,忽略')
        return
      }
      subagentsController.add(config)
      core.infoTick.value++
    },
    /** 运行时移除预声明子 agent(by id) */
    removeSubagent(id: string): boolean {
      if (!subagentsController) {
        if (options.debug) console.warn('[page-agent-sdk][removeSubagent] 未配 subagents:[] 或 capabilities.subagent 关闭,忽略')
        return false
      }
      const removed = subagentsController.remove(id)
      if (removed) core.infoTick.value++
      return removed
    },

    /** 检视 agent 详情:tools/skills/data/memory/middleware/todos(inspect() 与 debug 窗口消费) */
    getInfo(): AgentInfo {
      return {
        id: agentId,
        sessionId: core.sessionId,
        model: isChatModel(currentLlm) ? ((currentLlm as any).model ?? (currentLlm as any).modelName) : (currentLlm as LLMConfig).model,
        // 代理到 createAgent 权威拼装(base + Σ augmentPrompt,含 usageHints/skills/memory/todos/subagents/augmentSystem 等全部段);agent 未构造时回退 base+data(fix-introspection-consistency)
        systemPrompt: core.agent?.getEffectiveSystemPrompt?.() ?? (baseSystemPrompt + buildDataPrompt(liveData(), options.schemaHint)),
        tools: (core.agent?.allTools ?? allTools).map((t) => ({ name: t.name, description: t.description, schema: (t as any).schema, source: toolSources.get(t.name) || 'user' })),
        skills: (skillsMw ? (skillsMw as any).controller.get() as SkillSpec[] : (options.skills ?? [])).map((s) => ({ name: s.name, description: s.description })),
        data: liveData() ? { description: liveData()!.description, schema: liveData()!.schema } : undefined,
        contextPreset: options.contextPreset ?? 'auto',
        memory: memoryMw.get(),
        middleware: middlewares.map((m) => m.name),
        todos: (core.agent?.getState?.()?.todos ?? []).map((t) => ({
          id: t.id, content: t.content, status: t.status,
          ...(t.parentId !== undefined ? { parentId: t.parentId } : {}),
          ...(t.deps !== undefined ? { deps: t.deps } : {}),
          ...(t.criteria !== undefined ? { criteria: t.criteria } : {}),
          ...(t.evidence !== undefined ? { evidence: t.evidence } : {}),
        })),
        planPhase: todosMw.getPlanPhase(),
        mission: useMission ? missionMw.getMission() : undefined,
        workingMemory: useWorkingMemory ? workingMemoryMw.getWorkingMemory() : undefined,
        focus: useFocus ? focusMw.getFocus() : undefined,
        trace: useTracing && core.agent?.spans ? { spans: core.agent.spans.value, metrics: getTraceMetrics(core.agent.spans.value) } : undefined,
        actions: actionsToInspectInfo(options.actions ?? {}),
        subagent: {
          enabled: !!subagentMw,
          maxDepth: options.subagent?.maxDepth ?? 1,
          maxParallel: options.subagent?.maxParallel ?? 4,
          allowedTools: options.subagent?.allowedTools ?? [],
          // 预声明子 agent 列表(动态:反映 setSubagents/addSubagent/removeSubagent 后的最新)
          subagents: subagentsController?.get() ?? [],
        },
        verify: {
          enabled: !!verifyMw,
          maxAttempts: useVerify ? verifyMaxAttempts : 0,
          adversarial: useVerify && !!options.verify?.adversarial,
        },
        // 上下文构成快照(每轮 wrapModelCall 覆盖;复用 state.lastCompression 注入压缩统计,非新增写入路径)
        context: (() => {
          const snap = contextInspectorMw?.getSnapshot()
          if (snap) {
            const lc = core.agent?.getState?.()?.lastCompression
            if (lc) snap.compression = lc
          }
          return snap
        })(),
        mcp: { servers: core.mcpServers },
        lastCompression: core.agent?.getState?.()?.lastCompression as AgentInfo['lastCompression'],
        checkpoints: checkpointMgr
          ? { enabled: true, auto: checkpointAuto, list: checkpointMgr.list() }
          : undefined,
      }
    },
    /** 读取当前 mission(capture 或 setMission;capabilities.missionAnchor:false → undefined) */
    getMission(): Mission | undefined {
      return useMission ? missionMw.getMission() : undefined
    },
    /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
    setMission(m: Partial<Mission>): void {
      if (!useMission) {
        if (options.debug) console.warn('[page-agent-sdk][mission] capabilities.missionAnchor 关闭,setMission 忽略')
        return
      }
      missionMw.setMission(m)
      core.infoTick.value++ // 触发 DebugDrawer 刷新
    },
    /** 读取当前聚焦焦点(未聚焦 / capabilities.focus:false → undefined) */
    getFocus(): Focus | undefined {
      return useFocus ? focusMw.getFocus() : undefined
    },
    /** 设置聚焦焦点(path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法/无 schema 返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
    setFocus(focus: Focus): { ok: boolean; error?: string } {
      if (!useFocus) {
        if (options.debug) console.warn('[page-agent-sdk][focus] capabilities.focus 关闭,setFocus 忽略')
        return { ok: false, error: 'capabilities.focus 关闭' }
      }
      if (!focus || !focus.path) return { ok: false, error: 'path 必填且非空' }
      const schema = liveData()?.schema
      if (!schema) return { ok: false, error: '当前无主数据 schema,无法聚焦' }
      if (!getSchemaAtPath(schema, focus.path)) return { ok: false, error: `path "${focus.path}" 不在 schema 内` }
      focusMw.setFocus(focus)
      core.infoTick.value++ // 触发 DebugDrawer 刷新
      return { ok: true }
    },
    /** 清除聚焦焦点(退出精修模式,恢复全量可操作范围) */
    clearFocus(): void {
      if (!useFocus) return
      focusMw.clearFocus()
      core.infoTick.value++ // 触发 DebugDrawer 刷新
    },
  }

  /** 解析会话 id + 载入快照(仅 store 非 null 时) */
  async function resolveAndLoad(): Promise<void> {
    if (!store) return
    await store.ready
    const sessOpts = options.session || {}
    if (sessOpts.id) {
      core.sessionId = sessOpts.id
      const snap = await store.load(agentId, core.sessionId)
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: core.sessionId, rounds: snap.messages?.length ?? 0 })
      } else await store.createSession(agentId, sessOpts.title, core.sessionId)
    } else if (sessOpts.autoResume !== false) {
      const sessions = await store.listSessions(agentId)
      if (options.debug) console.log('[page-agent-sdk][restore] listSessions', agentId, sessions.length, sessions.map((s) => s.sessionId))
      if (sessions.length) {
        core.sessionId = sessions[0].sessionId
        const snap = await store.load(agentId, core.sessionId)
        if (snap) {
          core.applySnapshot(snap)
          emit({ type: 'session_restored', sessionId: core.sessionId, rounds: snap.messages?.length ?? 0 })
          if (options.debug) console.log('[page-agent-sdk][restore] 恢复会话', core.sessionId, `${snap.messages?.length ?? 0} msgs`)
        } else if (options.debug) {
          console.log('[page-agent-sdk][restore] 会话 meta 存在但快照为空', core.sessionId)
        }
      } else {
        core.sessionId = await store.createSession(agentId, sessOpts.title)
        if (options.debug) console.log('[page-agent-sdk][restore] 新建会话(无历史)', core.sessionId)
      }
    } else {
      core.sessionId = await store.createSession(agentId, sessOpts.title)
    }
    // options.memory 落盘(每次启动确保持久化;加载时 options 优先已在 applySnapshot 处理)
    // 函数 source 落盘已解析的文本(函数本身不可序列化,且 reload 时 options.memory 仍是函数会重新求值)
    if (options.memory) void store.save(agentId, core.sessionId, { memory: memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
    void refreshSessions()  // session-history Phase 6:init 载入会话后刷新历史列表
  }

  /** Skill 独立加载:从 SkillStore 恢复用户创建的 skill(与 storage 选项分离,即使 storage:false 也持久化) */
  async function loadUserSkills(): Promise<void> {
    await loadUserSkillsFromStore()
  }

  /**
   * 内存对话轮数上限:超限把最旧轮次压缩为一条摘要 system 消息(原地 splice,保持共享响应式引用)。
   * storage:false 也生效 —— 纯内存历史累积的 OOM 兜底。
   * 核心逻辑经纯函数 trimMemoryMessagesImpl(可单测):头部旧摘要并入新摘要,防更早摘要逐级丢失。
   */
  /** context-persist-resilience 功能B:快照指定 messages 引用的 vfs 大结果原文(归档用,读 vfsStore.files) */
  function snapshotVfsResults(msgs: AgentMessage[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const p of extractVfsRefs(msgs)) {
      const f = vfsStore.files[p]
      if (f) out[p] = f.content
    }
    return out
  }
  /** context-persist-resilience 功能B:可达性 GC —— 扫当前 messages 引用,删 vfs 不可达的 large_results(trim 后 / 加载兜底触发;delete 经 Proxy 落盘) */
  function gcVfsOrphans(): void {
    const toRemove = gcVfsLargeResults(vfsStore.files, extractVfsRefs(messages))
    for (const k of toRemove) delete vfsStore.files[k]
  }

  function trimMemoryMessages(): void {
    const r = trimMemoryMessagesImpl(messages, maxMemoryRounds)
    if (!r.trimmed) return
    const { older, summary } = r
    // context-persist-resilience 功能B:trim 收口 —— 快照 older vfs → 归档通知(带 vfs 大结果)→ 删 → GC
    // 删之前发通知,保证 dropped/vfsResults 是完整原文(还没被删);vfsResults 让集成方归档完整(对话 + 大结果)
    emit({
      type: 'context_trimmed',
      dropped: older.map((o) => ({
        round: o.round,
        user: o.userMsg.content,
        assistant: o.assistantMsgs.map((m) => m.content),
        steps: o.assistantMsgs.flatMap((m) => m.steps ?? []),
      })),
      vfsResults: snapshotVfsResults(older.flatMap((o) => [o.userMsg, ...o.assistantMsgs])),
      summary: summary.content as string,
      reason: 'max_memory_rounds',
    })
    messages.splice(r.deleteFrom, r.deleteCount, summary)
    gcVfsOrphans() // 删 older 后扫剩余引用,回收不可达的 large_results(被剩余轮引用的留)
    // recall-and-trim-llm 方向2:trim 异步 LLM 增强 —— 同步模板占位已 splice+落盘,异步用 LLM 重摘要 older 替换(照 titleLlmInvoke fire-and-forget 模式)。
    // 配置门:enableLLMSummary 默认 true(conservative 显式 false 不触发);优雅降级(LLM 失败/无 invoke 保留模板);竞态守卫(summaryMsg 未被新一轮 trim/clearSession 移除才替换)
    if (enableTrimLlm && summaryLlmInvoke) {
      const summaryMsg = r.summary // 引用(splice 进 messages 的同一条,用于竞态守卫 indexOf)
      const { prevSeg } = r
      void (async () => {
        try {
          const llmDigest = await summaryLlmInvoke(indexSummarize(older, trimPreserveSet))
          // 竞态守卫:summaryMsg 仍在 messages(未被新一轮 trim 覆盖 / clearSession 移除)才替换;indexOf<0 放弃保留当前态
          const idx = messages.indexOf(summaryMsg)
          if (idx < 0) return
          messages[idx].content = composeTrimSummary(older, prevSeg, llmDigest)
          persistRuntime() // 落盘 LLM 增强版(异步,不阻塞主循环)
        } catch {
          /* LLM 摘要失败:保留模板占位,优雅降级(模板已 splice+落盘,无需额外处理) */
        }
      })()
    }
  }

  // 会话标题自动生成:首条 user 截取(deriveTitle 纯函数,从 llmResolver 导入);变化才 updateTitle,避免每轮重复写
  let lastTitle: string | undefined
  let titleLLMDone = false   // LLM 标题是否已生成(每会话一次,主旨更准;switchSession/onClear 重置)

  /** 持久化当前会话的 messages + todos(一轮结束 / send 后调用) */
  function persistRuntime(): void {
    if (!core.sessionId || !store) return
    // messages 元素是 Vue reactive proxy → IDB structured clone 会抛 DataCloneError(静默失败,messages 存不进);
    // 先 JSON 纯化为普通对象。localStorage 走 JSON.stringify 本就纯化,故 local 不受影响、indexed 受影响。
    const pureMessages = JSON.parse(JSON.stringify(messages)) as AgentMessage[]
    void store.save(agentId, core.sessionId, { messages: pureMessages })
    // todos 始终同步当前态(含空数组覆写):否则会话内 todos 由有变空(LLM 主动 write_todos([]))后,
    // storage 仍残留旧清单 → 刷新恢复出遗留的已完成 todos。代价:未用过 todos 的会话多写一条空记录(可忽略)。
    const todos = core.agent?.getState?.()?.todos ?? []
    void store.save(agentId, core.sessionId, { todos })
    // context-persist-resilience 功能A:持久化 mission/workingMemory(刷新/切会话后长任务目标 + 工作记忆不丢;非空才写省 IDB 写)
    if (useMission) {
      const m = missionMw.getMission()
      if (m) void store.save(agentId, core.sessionId, { mission: m } as Partial<SessionSnapshot>)
    }
    if (useWorkingMemory) {
      const wm = workingMemoryMw.getWorkingMemory()
      if (wm) void store.save(agentId, core.sessionId, { workingMemory: wm } as Partial<SessionSnapshot>)
    }
    // automation 断点续跑:持久化 checkpoint 栈 + 累计 usage(刷新/崩溃后恢复,长任务可续跑;仅 automation 开启时写,省空间)
    if (useAutomation && checkpointMgr) {
      void store.save(agentId, core.sessionId, { checkpoints: checkpointMgr.exportStack() } as Partial<SessionSnapshot>)
      void store.save(agentId, core.sessionId, { usage } as Partial<SessionSnapshot>)
    }
    // 自动 title:首条 user 截取(变化才写,避免每轮重复;供历史列表显示,替代「会话 xxxxxx」)
    const title = deriveTitle(messages)
    if (title && title !== lastTitle) {
      lastTitle = title
      void store.updateTitle(agentId, core.sessionId, title)
    }
    // LLM 标题(异步,首轮 user+assistant 完成后一次;主旨更准,覆盖规则 title;失败/无 LLM 用规则兜底)
    const autoTitle = options.autoTitle !== false
    if (autoTitle && titleLlmInvoke && !titleLLMDone && messages.some((m) => m.role === 'user') && messages.some((m) => m.role === 'assistant')) {
      titleLLMDone = true
      void (async () => {
        const llmTitle = await titleLlmInvoke(messages)
        if (llmTitle) { await store.updateTitle(agentId, core.sessionId, llmTitle); await refreshSessions() }
      })()
    }
    if (options.debug) console.log('[page-agent-sdk][persist] save', core.sessionId, `${messages.length} msgs`)
  }

  // 初始化:解析会话 + 恢复 + 构造 agent(异步,不阻塞 buildCore 返回)
  core.initDone = (async (): Promise<void> => {
    await resolveAndLoad()
    // Skill 独立加载(与 storage 选项分离;即使 storage:false 也从 SkillStore 恢复)
    await loadUserSkills()
    // MCP:连所有 server(故障隔离),工具注入 allTools(createAgent 前 —— 构造后 bindTools 固化)
    if (options.mcp?.length) {
      const results = await Promise.allSettled(options.mcp.map((c) => connectMcp(c)))
      core.mcpClosers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.close] : []))
      core.mcpServers = []
      // 复用外层 mcpTools 数组(buildCore 作用域声明):旧实现在此用 const 声明同名局部变量遮蔽外层,
      // 致 push 进局部数组、rebuildExtraTools 读外层空数组 → MCP 工具从未注入 agent(主流程审查 P0-3)
      results.forEach((r, i) => {
        const cfg = options.mcp![i]
        const label = cfg.name ?? cfg.url
        if (r.status === 'fulfilled') {
          core.mcpServers.push({ name: label, url: cfg.url, toolCount: r.value.tools.length })
          r.value.tools.forEach((t) => toolSources.set(t.name, `mcp:${label}`))
          mcpTools.push(...r.value.tools)
        } else {
          console.warn(`[page-agent-sdk][mcp] server ${label} 连接失败:`, r.reason)
        }
      })
      // 重建 allTools(纳入 mcpTools);此时 createAgent 尚未构造,allTools 直接作为 tools 传入
      allTools = rebuildExtraTools()
      if (options.debug) console.log(`[page-agent-sdk][mcp] 注入 ${mcpTools.length} 个工具,${core.mcpServers.length} 个 server`)
    }
    // 主 LLM:实例直传;LLMConfig 经 constructLlmFromConfig(provider 分支,Anthropic 动态 import)构造实例注入
    const mainLlm = isChatModel(options.llm) ? options.llm : await constructLlmFromConfig(options.llm as LLMConfig)
    core.agent = createAgent({
      llm: mainLlm,
      systemPrompt: baseSystemPrompt,
      tools: allTools,
      middleware: middlewares,
      maxToolRounds: options.maxToolRounds,
      maxRetries: options.maxRetries,
      maxParallelTools: options.maxParallelTools,
      // 模型能力透传(已在 buildCore 解析,声明优先 > 表 > 缺省):驱动 maxTokens 缺省与 offload 阈值
      contextWindow: modelCaps.contextWindow,
      maxOutputTokens: modelCaps.maxOutputTokens,
      // verify 自纠上限:装载 verify 时用 verify.maxAttempts(默认 2),否则 0(关闭自纠 = 现状)
      maxVerifyAttempts: useVerify ? verifyMaxAttempts : 0,
      // setLlm 后回调:重解析模型能力(contextWindow/maxOutputTokens 影响 offload 阈值/压缩)
      onLlmChange: (newLlm: BaseChatModel) => {
        // 仅更新实例引用;modelCaps 重算 + 最小窗口校验 + 集中回灌由 createChatSdk.setLlm 权威处理
        // (createChatSdk.setLlm 把 LLMConfig 构造成 BaseChatModel 实例后 contextWindow 声明丢失,
        //  onLlmChange 拿不到原 cfg.contextWindow → 在 setLlm 用原 llmOpt 重算更准)
        currentLlm = newLlm
      },
      // trace:createAgent finally 调 onTrace(spans, metrics) → emit('trace')(capabilities.tracing 开时注入,关时 undefined → createAgent 不采集,零开销)
      onTrace: useTracing ? (spans, metrics) => { try { emit({ type: 'trace', spans, metrics }) } catch { /* emit 抛错忽略 */ } } : undefined,
      debug: options.debug,
    })
    agentRef.current = core.agent
    // 注入 subagents 动态重配置钩子:controller.set/add/remove 后触发 createAgent rebind(重新 bindTools)
    if (subagentsMw && (subagentsMw as any).setReconfigureHook) {
      ;(subagentsMw as any).setReconfigureHook(() => {
        if (core.agent) core.agent.setTools(rebuildExtraTools())
      })
    }
  })()

  return core
}

export function createChatSdk(options: ChatSdkOptions): ChatSdk {
  // ===== agent 实例 id(多共存隔离)=====
  const agentId: string = options.id ?? makeId()
  if (!options.id) {
    console.warn(
      `[page-agent-sdk] 未传 options.id,已生成随机 id "${agentId}"。刷新后持久化数据无法恢复,请传稳定 id。`,
    )
  }
  // 流式输出(默认 true 逐字);false 时 ChatDialog 走非流式 fetchResponse(等整段)
  const streaming = options.streaming ?? true
  const ui = options.ui ?? 'default'

  // ===== 获取或创建 core(shareContext 时同 id 复用)=====
  let core: AgentCore
  const existing = options.shareContext ? sharedCores.get(agentId) : undefined
  if (existing) {
    core = existing
  } else {
    core = buildCore(options, agentId)
    if (options.shareContext) sharedCores.set(agentId, core)
  }
  core.refCount++ // 本实例持有一引用

  // ===== 每实例:渲染 + 事件监听(不共享)=====
  let vueApp: VueApp | null = null
  let mountEl: HTMLElement | null = null

  // 对话框 UI 配置(归组写法;mount 渲染 ChatDialog 时读取)
  const dialogCfg = resolveDialogConfig(options)
  let flushHandler: (() => void) | null = null
  let visHandler: (() => void) | null = null

  async function mount(overrideContainer?: HTMLElement | string): Promise<void> {
    await core.initDone
    // 已挂载且隐藏中(抽屉模式 hide 后再 mount):直接 show,不重建 vueApp,保留 agent/历史/生成进程
    if (vueApp) {
      show()
      return
    }
    // mount 时传 container 覆盖 options.container(异步绑定:创建时可不传,mount 时才指定)
    if (overrideContainer !== undefined) options.container = overrideContainer
    // headless:不渲染 UI,只 init agent + 装 flush 兜底(集成方用 messages/send 自建 UI)
    if (ui === false) {
      if (core.store) {
        flushHandler = () => {
          core.vfsStore.flush?.()
          void core.store!.flush()
        }
        visHandler = () => {
          if (document.visibilityState === 'hidden') void core.store!.flush()
        }
        if (typeof window !== 'undefined') window.addEventListener('pagehide', flushHandler)
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visHandler)
      }
      return
    }
    const el =
      typeof options.container === 'string' ? document.querySelector(options.container) : options.container
    if (!el) throw new Error(`createChatSdk: 挂载点未找到(${options.container})`)
    mountEl = el as HTMLElement
    const debugLogsRef = core.agent!.debugLogs
    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ChatDialog, {
            fetchStream: streaming ? core.stream : undefined,   // P1-c:走 core.stream 包装(事件转发 onEvent/hook + abort 收口冲突),非裸 core.agent.stream
            fetchResponse: streaming ? undefined : (msgs: AgentMessage[], signal?: AbortSignal) => {
              if (signal) {
                const abortConflict = () => core.resolveConflict('keep_external')
                if (signal.aborted) abortConflict()
                else signal.addEventListener('abort', abortConflict, { once: true })
              }
              return core.agent!.invoke(msgs, signal)
            },
            title: dialogCfg.title,
            placeholder: dialogCfg.placeholder,
            debugLogs: debugLogsRef.value,
            initialMessages: core.messages,
            getInfo: () => core.getInfo(),
            onUndo: core.checkpoint ? () => core.checkpoint!.restore() : undefined,
            canUndo: core.checkpoint ? () => core.checkpoint!.canRestore() : undefined,
            onPersist: async () => {
              core.afterRound()
              if (core.store) await core.store.flush() // 等待落盘完成(useChat await 此 Promise,确保刷新前 indexed 已写入)
            },
            onClear: () => core.resetSession(),   // P0-4:收编进 core(见 core.resetSession);原闭包越界引用 buildCore 局部 lastTitle/titleLLMDone 致 ReferenceError
            pendingConflict: core.pendingConflict.value,
            onResolveConflict: (action: ConflictResolution['action']) => core.resolveConflict(action),
            infoTick: core.infoTick,  // 响应式 tick:setSkills/setData 后 ++,DebugDrawer watch 后重新拉 getInfo() 实时刷新 Agent 信息
            getSkillContent: core.skillsController ? (name: string) => core.skillsController!.getContent(name) : undefined,  // DebugDrawer 展开 skill 时调,取 skill 全文(优先缓存)
            onAddSkill: core.skillsController ? (skill: import('../harness/skills').SkillSpec) => core.addSkill(skill) : undefined,  // ChatDialog 创建 skill 面板提交时调
            onRemoveSkill: core.skillsController ? (name: string) => core.removeSkill(name) : undefined,  // ChatDialog 删除用户 skill 时调
            getUserSkillNames: core.skillsController ? () => core.listUserSkills() : undefined,  // ChatDialog 列出用户创建的 skill 名(刷新面板)
            onGetSkill: core.skillsController ? (name: string) => core.getUserSkill(name) : undefined,  // ChatDialog 编辑 skill 时读取详情
            drawer: dialogCfg.drawer === true,
            drawerWidth: dialogCfg.drawerWidth,
            drawerHidden: dialogCfg.drawerHidden === true,
            inputRows: dialogCfg.inputRows,
            // 上下文聚焦(指定组件精修;core.getFocus 返 undefined 时 chip 不显示;capabilities.focus:false → no-op chip 隐藏)
            getFocus: () => core.getFocus(),
            onSetFocus: (f: Focus) => core.setFocus(f),
            onClearFocus: () => core.clearFocus(),
            onClose: dialogCfg.onClose ?? (dialogCfg.drawer === true ? () => hide() : () => unmount()),  // 抽屉模式:点击遮罩/关闭按钮 → 默认 hide(保留 agent/历史/生成进程,再 mount 直接 show);非抽屉或用户传 onClose 时用自定义/卸载
            // 内置会话管理(storage 开启 → ChatDialog 默认显示「新建/历史」按钮 + 历史面板;关 → 不传,隐藏,向后兼容)
            ...(core.store ? {
              sessions: core.sessions.value,            // Ref 响应式 → Wrapper render 重渲染 → ChatDialog 自动更新
              currentSessionId: core.sessionId,
              onNewSession: () => { void runSerial(() => core.switchSession()) },          // 经 runSerial(与 return 的 switchSession 一致,防并发 state 竞态)
              onOpenSession: (id: string) => { void runSerial(() => core.switchSession(id)) },
              onRemoveSession: async (id: string) => { if (id !== core.sessionId) { await core.store!.deleteSession(agentId, id); await core.refreshSessions() } },
            } : {}),
          })
      },
    })
    vueApp = createApp(Wrapper)
    vueApp.mount(el)

    // 抽屉模式默认隐藏:mount 后不显示,需 sdk.show() 才出现(「点击按钮才出现聊天框」场景)
    if (dialogCfg.drawer === true && dialogCfg.drawerHidden === true) {
      hide()
    }

    // 刷新/切页兜底 flush(防丢 debounce 内的待写)
    if (core.store) {
      flushHandler = () => {
        core.vfsStore.flush?.() // vfs 自身的 800ms debounce 窗口也要立即落盘
        void core.store!.flush()
      }
      visHandler = () => {
        if (document.visibilityState === 'hidden') void core.store!.flush()
      }
      if (typeof window !== 'undefined') window.addEventListener('pagehide', flushHandler)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visHandler)
    }
  }

  function unmount(): void {
    // 收口挂起的冲突(按「保留外部」),防 unmount 后旧 conflict Promise 永久挂起泄漏
    core.resolveConflict('keep_external')
    if (flushHandler && typeof window !== 'undefined') window.removeEventListener('pagehide', flushHandler)
    if (visHandler && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visHandler)
    flushHandler = null
    visHandler = null
    // 退出动画:给根 .chat-dialog 加 cs-leaving class 触发淡出+缩放,动画结束再卸载 DOM
    const dialogEl = mountEl?.querySelector?.('.chat-dialog') as HTMLElement | null
    if (vueApp && dialogEl) {
      dialogEl.classList.add('cs-leaving')
      // 抽屉模式:遮罩同步淡出
      const maskEl = mountEl?.querySelector?.('.chat-mask') as HTMLElement | null
      if (maskEl) maskEl.classList.add('cs-leaving')
      let done = false
      const finish = () => {
        if (done) return
        done = true
        vueApp?.unmount()
        vueApp = null
        mountEl = null
        core.release() // 引用计数--;shareContext 归零才真销毁
      }
      dialogEl.addEventListener('transitionend', finish, { once: true })
      setTimeout(finish, 320) // 兜底:防 transitionend 不触发(transition: all 0.3s ease)
      return
    }
    vueApp?.unmount()
    vueApp = null
    mountEl = null
    core.release() // 引用计数--;shareContext 归零才真销毁
  }

  /** 抽屉模式隐藏:加 cs-hidden class(opacity:0 + visibility:hidden),不卸载 vueApp/不 release agent —— 保留聊天历史与正在进行的生成进程;再 mount() 直接 show 恢复 */
  function hide(): void {
    if (!vueApp) return
    const dialogEl = mountEl?.querySelector?.('.chat-dialog') as HTMLElement | null
    const maskEl = mountEl?.querySelector?.('.chat-mask') as HTMLElement | null
    if (dialogEl) dialogEl.classList.add('cs-hidden')
    if (maskEl) maskEl.classList.add('cs-hidden')
  }
  /** 抽屉模式显示:移除 cs-hidden class,恢复可见(配合 hide 使用;首次挂载用 mount) */
  function show(): void {
    if (!vueApp) return
    const dialogEl = mountEl?.querySelector?.('.chat-dialog') as HTMLElement | null
    const maskEl = mountEl?.querySelector?.('.chat-mask') as HTMLElement | null
    if (dialogEl) dialogEl.classList.remove('cs-hidden')
    if (maskEl) maskEl.classList.remove('cs-hidden')
  }

  // P1-2(arch-review):实例级操作串行化 —— 并发 send/switchSession/batch 排队执行,防共享闭包 state 竞态
  // (单实例同一时刻只服务一个会话:一个操作完整跑完下一个才开始;「一个会话操作 data 时,其他会话等它结束」)
  const runSerial = createSerialRunner()

  return {
    mount,
    unmount,
    hide,
    show,
    send: (...args: Parameters<typeof core.send>) => runSerial(() => core.send(...args)),
    /** 批处理(automation):逐任务跑 agent,每任务前 checkpoint,任务间错误隔离(单任务失败不中断整批);详见 ChatSdk.batch */
    batch: (...args: Parameters<typeof core.batch>) => runSerial(() => core.batch(...args)),
    switchSession: (...args: Parameters<typeof core.switchSession>) => runSerial(() => core.switchSession(...args)),
    /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;直接消费无需手动 listSessions/refresh/hook) */
    sessions: core.sessions,
    /** 列出当前 agent 的所有历史会话(主动查;一般用响应式 sessions 替代;storage 未开启 → []) */
    async listSessions(): Promise<import('../backends/storage').SessionMeta[]> {
      if (!core.store) return []
      return core.store.listSessions(agentId)
    },
    /** 删除指定历史会话;不可删除当前会话(删当前请先 switchSession 切走);storage 未开启 → no-op + warn */
    async deleteSession(sessionId: string): Promise<void> {
      if (!core.store) return
      if (sessionId === core.sessionId) { console.warn('[page-agent-sdk] deleteSession 忽略:不能删除当前会话,请先 switchSession 切到其他会话'); return }
      await core.store.deleteSession(agentId, sessionId)
      await core.refreshSessions()  // session-history Phase 6:删除后刷新历史列表(响应式 sessions 自动更新)
    },
    /** 当前会话 id(switchSession/onClear 后实时反映;供历史列表高亮当前项) */
    get sessionId(): string { return core.sessionId },
    stream: core.stream,
    inspect: core.getInfo,
    /** 读取最近一次上下文构成快照(每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
    inspectContext: () => core.getInfo().context,
    getMission: core.getMission,
    /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
    setMission: core.setMission,
    /** 读取当前聚焦焦点(未聚焦 / capabilities.focus:false → undefined) */
    getFocus: core.getFocus,
    /** 设置聚焦焦点(path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法返回 {ok:false,error} */
    setFocus: core.setFocus,
    /** 清除聚焦焦点(退出精修模式,恢复全量可操作范围) */
    clearFocus: core.clearFocus,
    messages: core.messages,
    /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);无可用 checkpoint 返回 false */
    restoreLastCheckpoint: () => core.checkpoint?.restore() ?? false,
    /** 列出可用 checkpoint(回退点) */
    listCheckpoints: () => core.checkpoint?.list() ?? [],
    /** 运行时订阅 SDK 事件(可多个监听器,返回取消函数);与构造时 onEvent 互补 */
    hook: (handler: SdkEventHandler) => {
      core.listeners.add(handler)
      return () => core.listeners.delete(handler)
    },
    /** 运行时替换主数据配置(如页面切换、schema 变更);立即生效,清空快照栈 */
    setData: (config: DataConfig) => {
      if (!core.dataOpsController) {
        console.warn('[page-agent-sdk] setData 忽略:dataOps 已关闭(capabilities.dataOps:false)')
        return
      }
      core.dataOpsController.set(config)
      core.infoTick.value++  // 触发 DebugDrawer 的 Agent 信息重新拉取(实时反映 data 变更)
    },
    /** 读取当前主数据配置;dataOps 关闭时返回 undefined */
    getData: () => core.liveData(),
    /** 运行时替换整个 skill 列表(同名覆盖);清缓存,下轮 system prompt 索引反映新 skill,下次 load_skill 取最新全文 */
    setSkills: (skills: SkillSpec[]) => {
      const ctrl = core.skillsController
      if (!ctrl) {
        console.warn('[page-agent-sdk] setSkills 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      ctrl.set(skills)
      core.unloadSkillTools?.()  // 整个 skill 列表替换 → 旧 skill 附带工具卸载 + rebind(§5)
      core.infoTick.value++  // 触发 DebugDrawer 的 Agent 信息重新拉取(实时反映 skills 变更)
    },
    /** 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖);触发 controller 合并 + infoTick 刷新 */
    addSkill: (skill: SkillSpec) => {
      if (!core.skillsController) {
        console.warn('[page-agent-sdk] addSkill 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      core.addSkill(skill)
      core.unloadSkillTools?.(skill.name)  // 同名覆盖时清旧工具,下次 load 注入新(§5)
    },
    /** 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills);返回是否删除成功 */
    removeSkill: (name: string): boolean => {
      if (!core.skillsController) {
        console.warn('[page-agent-sdk] removeSkill 忽略:skills 已关闭(capabilities.skills:false)')
        return false
      }
      const ok = core.removeSkill(name)
      if (ok) core.unloadSkillTools?.(name)  // 卸载该 skill 附带工具(防泄漏;§5)
      return ok
    },
    /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
    listUserSkills: (): string[] => core.listUserSkills(),
    /** 读取用户创建的 skill 详情(SkillPanel 编辑时调) */
    getUserSkill: (name: string) => core.getUserSkill(name),
    /** 清 skill 全文缓存(动态 skill 内容变化时主动失效);不传清全部,传 name 清指定 */
    invalidateSkillCache: (name?: string) => {
      const ctrl = core.skillsController
      if (!ctrl) {
        console.warn('[page-agent-sdk] invalidateSkillCache 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      ctrl.invalidateCache(name)
      core.unloadSkillTools?.(name)  // 同步卸载该 skill 的附带工具(下次 load_skill 重新注入;§5)
    },
    /** 导出主数据 bind 的深拷贝(备份/迁移用);dataOps 关闭或无 data 返回 null */
    exportData: () => {
      const bind = core.liveData()?.bind
      return bind == null ? null : JSON.parse(JSON.stringify(bind))
    },
    /**
     * 导入数据整体替换主数据 bind(就地还原,保留 reactive 引用)。
     * 默认经 schema 校验,不合法返回 {ok:false,error};校验通过写入并发 data_change 事件,返回 {ok:true}。
     * opts.validate:false 跳过校验(集成方自行保证数据合法);opts.emit:false 不发 data_change 事件。
     */
    importData: (json, opts) => {
      const cfg = core.liveData()
      if (!cfg || !core.dataOpsController) return { ok: false, error: 'dataOps 未开启或无主数据' }
      const bind = cfg.bind
      if (bind == null || typeof bind !== 'object') return { ok: false, error: '主数据 bind 非对象,无法就地还原(集成方应用对象包裹)' }
      if (opts?.validate !== false) {
        const r = (cfg.schema as any).safeParse(json)
        if (!r.success) return { ok: false, error: 'schema 校验失败:' + (r.error?.message ?? '未知错误') }
      }
      restoreInPlace(bind as Record<string, unknown> | unknown[], json)
      core.dataOpsController?.markDataDirty?.()  // 整体替换 bind → 标脏(下次 checkpoint save 必 clone 新基线,防复用旧 bind clone)
      if (opts?.emit !== false) core.emit({ type: 'data_change', operation: 'set', value: bind })
      return { ok: true }
    },
    /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
    usage: core.usage,
    /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 此 ref 自建 UI */
    pendingConflict: core.pendingConflict,
    /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
    resolveConflict: (action: ConflictResolution['action']) => core.resolveConflict(action),
    setTools: (tools: StructuredToolInterface[]) => core.setTools(tools),
    addTool: (t: StructuredToolInterface) => core.addTool(t),
    removeTool: (name: string) => core.removeTool(name),
    setLlm: (llm: BaseChatModel | LLMConfig) => core.setLlm(llm),
    setMemory: (source: string | (() => string | Promise<string>)) => core.setMemory(source),
    refreshMemory: () => core.refreshMemory(),
    setSubagents: (configs: SubagentConfig[]) => core.setSubagents(configs),
    addSubagent: (config: SubagentConfig) => core.addSubagent(config),
    removeSubagent: (id: string) => core.removeSubagent(id),
  }
}
