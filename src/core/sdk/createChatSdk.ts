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
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import ChatDialog from '../components/ChatDialog.vue'
import { createAgent } from '../harness/createAgent'
import { z } from 'zod'
import { createTodosMiddleware } from '../harness/todos'
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
import { connectMcp, type McpServerConfig } from '../mcp/client'
import { createSummarizationMiddleware } from '../harness/summarization'
import { systemPromptHelpers, extractSchemaHint } from '../presets'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { resolveContextOptions, type ContextPreset } from './contextPreset'
import { createVfs, createVfsMiddleware, type VfsStore } from '../backends/vfs'
import type { VfsFile } from '../harness/state'
import { createDataOps, filterByToolMode, type DataConfig, type DataOpsController, type ConflictInfo, type ConflictResolution } from '../tools/dataOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { selectBuiltinTools } from '../toolsets'
import { createUsageHintsMiddleware } from '../harness/usageHints'
import { createSessionStore, type SessionStore, type StorageConfig, type StorageBackendType, type SessionSnapshot } from '../backends/storage'
import { createSkillStore, type SkillStore, type SkillStoreConfig, type PersistedSkill } from '../backends/skillStore'
import { makeId } from '../utils/id'
import { resolveModelCaps } from '../utils/modelCaps'
import { trimMemoryMessagesImpl } from '../utils/rounds'
import type { AgentMessage, StreamHandler, AgentInfo, SdkEvent, SdkEventHandler, TokenUsage } from '../types'
import type { ToolCallContext } from '../harness/middleware'

export interface LLMConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 模型上下文窗口(token);缺省按 model 名查表。影响 offload 阈值与压缩触发(大模型自适应) */
  contextWindow?: number
  /** 模型最大输出(token);缺省按 model 名查表。maxTokens 未传时作其缺省,避免设错被截断 */
  maxOutputTokens?: number
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
  /** 系统提示词(通用"JSON 操作助手",可覆盖) */
  systemPrompt?: string
  /** 自定义 systemPrompt 时是否自动追加 reliableWriteRules(默认 true,用 '---' 分隔线区分用户内容与 SDK 追加的写入规则);设 false 关闭。不传 systemPrompt 用默认 prompt 时已内置,此项无效 */
  appendReliableWriteRules?: boolean
  /** 用户自定义工具(散工具 / 展开的预设数组 / 模块 default,皆可;与内置工具合并) */
  tools?: StructuredToolInterface[]
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
  /** AGENTS.md 风格持久指令(加载时优先于持久化的 memory) */
  memory?: string
  /** 主数据对象(单对象;schema 校验 + bind 直连,工具直接读写 bind,不挂 window) */
  data?: DataConfig
  /** scope 白名单(默认不启用;启用后对 window/vfs 工具生效) */
  permissions?: PermissionRule[]
  /** 自定义中间件(在内置中间件之后注入;可拦截/观察模型调用、工具执行、prompt 增强等) */
  middleware?: Middleware[]
  /** 虚拟工作区:初始文件 + 内存字节上限(默认 4MB,超限 LRU 淘汰最旧) */
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number }
  /** 每个 数据槽最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  /** 自动乐观锁(默认 true):写入时若 LLM 未传 expectedHash,自动用其最后 get 读到的 hash 比对;设 false 回退「不传 = 不校验」 */
  autoLock?: boolean
  /** 数据操作审计回调:每次 set/edit/delete/restore 经此回调外发结构化事件(独立于 debug,无需 debug:true);集成方做合规审计/操作追溯 */
  onAudit?: (entry: { op: string; jsonPath?: string; opDetail?: string; timestamp: number; success: boolean; error?: string }) => void
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
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number
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
    skills?: boolean         // 渐进式披露技能
    vfs?: boolean            // 虚拟工作区(关 → 大结果外存退化为截断)
    summarization?: boolean  // 上下文压缩(关 → 长会话不压缩)
    memory?: boolean         // AGENTS.md 持久指令
    subagent?: boolean       // 子 agent 委派(与 subagent.enabled:false 等效)
    verify?: boolean         // 自检中间件(默认 false;开启后 agent 返回前跑 check 自纠,需配合 verify.check)
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

/**
 * 默认 systemPrompt —— 用户未传 systemPrompt 时使用。
 * 定位:通用「JSON 操作助手」(规范化 JSON 操作 agent)——通过专用工具安全读写集成方声明的主数据对象(bind)。
 * 含身份 + 能力概述 + 可靠写入规则(改前先读、动态先查、字段以工具返回为准、写错看校验错误重试、优先增量 patch)。
 * 用户传了 systemPrompt 则完全覆盖此默认;默认 appendReliableWriteRules:true,会在自定义 systemPrompt 末尾用 '---' 分隔线追加 reliableWriteRules(避免集成方忘写写入规则);设 false 关闭。
 */
const DEFAULT_SYSTEM_PROMPT = [
  '你是一个 JSON 操作助手。集成方声明了一个主数据对象(含 zod schema 校验),你通过专用工具安全地读写它来完成任务。',
  '所有写操作都经范围控制(仅 schema 声明字段内)与 schema 校验(不合法会返回结构化错误而非写入),并自动留快照可回退。',
  '大对象/数组优先用增量 patch(只发改动)而非整体重传,避免输出被截断。',
  '---',
  systemPromptHelpers.reliableWriteRules,
].join('\n\n')

/** 拼接「可操作数据」段到 systemPrompt:从 data 的 schema 字段 .describe() 自动提取注入 */
function buildDataPrompt(data: DataConfig | undefined): string {
  if (!data) return ''
  const hint = extractSchemaHint(data.schema)
  return `\n\n## 可操作数据(字段以 read 工具返回的实际值为准)\n${data.description ? data.description + '\n' : ''}${hint}`
}

export interface ChatSdk {
  /** 渲染对话框到 container(异步:含持久化恢复);ui:false 时仅 init agent(headless) */
  mount(): Promise<void>
  /** 响应式消息数组(headless 模式下供集成方自建 UI 读取;与内部共享同一引用) */
  messages: AgentMessage[]
  /** 卸载(shareContext 时仅减引用计数,归零才真销毁) */
  unmount(): void
  /** 命令式发送一条消息(共享内部 messages,自动持久化) */
  send(message: string): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 切换到指定会话(载入其上下文);不传 id 则新建。返回新会话 id。storage 未开启时抛错 */
  switchSession(sessionId?: string): Promise<string>
  /** 检视 agent 详细信息(tools/skills/data/middleware/todos 等),供 debug 或外部消费 */
  inspect(): AgentInfo
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);需开启 checkpoint 选项,无可用 checkpoint 返回 false */
  restoreLastCheckpoint(): boolean
  /** 列出可用 checkpoint(回退点);需开启 checkpoint 选项,未开启返回空数组 */
  listCheckpoints(): { id: number; label?: string; timestamp: number; messageCount: number }[]
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
}

/** 内存中保留的对话轮数上限(超限压缩为摘要,防 OOM);0 表示关闭 */
const DEFAULT_MAX_MEMORY_ROUNDS = 50


/** 解析 storage 选项 → SessionStore | null(undefined/false/未传 关闭;字符串/对象 开启) */
function resolveStorage(storage: StorageBackendType | StorageConfig | false | undefined): SessionStore | null {
  if (storage === undefined || storage === false) return null
  if (typeof storage === 'string') return createSessionStore({ backend: storage })
  if (storage.enabled === false) return null
  return createSessionStore(storage)
}

/**
 * 解析对话框配置:从 options.dialog 读取归组配置(扁平写法已移除)。
 */
function resolveDialogConfig(opts: ChatSdkOptions): DialogConfig {
  return opts.dialog ?? {}
}

/** 判定 llm 选项是模型实例(BaseChatModel)还是配置对象(LLMConfig) */
function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

// ===== AgentCore:可被多实例共享的核心上下文 =====
type AgentInstance = ReturnType<typeof createAgent>
type TodosMw = ReturnType<typeof createTodosMiddleware>
type MemoryMw = ReturnType<typeof createMemoryMiddleware>

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
  /** Agent 信息刷新 tick(setSkills/setData 后 ++);经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取,实时反映动态 skill/data */
  infoTick: Ref<number>
  /** 乐观锁冲突挂起(等用户决定保留外部/强制覆盖/回退);UI 经此 ref 渲染冲突对话框,无冲突时为 null */
  pendingConflict: Ref<PendingConflict | null>
  /** 当前主数据配置(反映运行时替换;供 inspect/verify/getData 读最新状态) */
  liveData: () => DataConfig | undefined
  /** 累计 token 用量(每轮 LLM 调用累加;供 sdk.usage 暴露) */
  usage: import('../types').TokenUsage
  /** 内部事件分发(供 return 对象的 importData 等手动发事件复用) */
  emit: SdkEventHandler
  applySnapshot(snap: SessionSnapshot): void
  afterRound(): void
  send(message: string): Promise<string>
  switchSession(sessionId?: string): Promise<string>
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
}

/** shareContext 注册表:agentId → AgentCore(同页同 id 复用) */
const sharedCores = new Map<string, AgentCore>()

/** 从 LLM 响应消息提取文本内容(content 可能是 string 或 content parts 数组) */
function extractText(msg: BaseMessage): string {
  const c = msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('')
  }
  return String(c ?? '')
}

/**
 * 构建摘要用 LLM invoke 函数(供 summarization 中间件 llmInvoke)。
 * 优先用 options.summaryLlm(专用压缩模型,如更便宜的小模型);未配则回退主 agent 模型(options.llm)。
 * 复用实例或按 LLMConfig 另构造 ChatOpenAI(低温 + 限输出,压缩成连贯段落)。
 * 温度/输出/超时可配(summaryTemperature/summaryMaxTokens/summaryTimeoutMs);超时回退索引摘要(不阻塞用户)。
 */
function buildSummaryLlmInvoke(options: ChatSdkOptions): ((prompt: string) => Promise<string>) | undefined {
  const llmOpt = options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  const temperature = options.summaryTemperature ?? 0.3
  const maxTokens = options.summaryMaxTokens ?? 1024
  const timeoutMs = options.summaryTimeoutMs ?? 15000
  let llm: BaseChatModel
  if (isChatModel(llmOpt)) {
    llm = llmOpt
  } else {
    const cfg = llmOpt as LLMConfig
    if (!cfg.apiKey) {
      // 显式配了 summaryLlm 却无效(apiKey 缺失):非 debug 也 warn,避免"以为用了专用模型实际回退了主模型/索引摘要"
      if (options.summaryLlm) {
        console.warn('[page-agent-sdk][summarization] summaryLlm 已配置但缺 apiKey,摘要回退主 agent 模型或零成本索引摘要')
      }
      return undefined
    }
    llm = new ChatOpenAI({
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature,
      maxTokens,
      configuration: cfg.baseUrl ? { baseURL: cfg.baseUrl } : undefined,
    })
  }
  return async (prompt: string) => {
    // 超时保护:摘要 LLM 卡住时 reject → useContextManager 的 try/catch 回退索引摘要,不阻塞用户首次响应
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await llm.invoke(
        [
          new SystemMessage('你是对话历史压缩助手。把下面按轮次索引的对话要点,改写成一段连贯、紧凑的中文摘要,保留关键事实、用户意图与已用工具,不要编造。直接输出摘要正文。'),
          new HumanMessage(prompt),
        ],
        { signal: ac.signal } as any,
      )
      return extractText(res).trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

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
  const pendingConflict = ref<PendingConflict | null>(null)
  // Agent 信息刷新 tick:setSkills/setData 等运行时变更后 ++,经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取(实时反映动态 skill/data)
  const infoTick = ref(0)
  let conflictSeq = 0
  function setPendingConflict(info: ConflictInfo): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      // shareContext 多实例并发冲突时,新冲突覆盖旧 pendingConflict.value,旧 resolve 函数会丢失 → 旧工具永挂。
      // 兜底:覆盖前若仍有未解决冲突,自动按「保留外部」收口旧冲突(防 resolve 丢失)
      const prev = pendingConflict.value
      if (prev) prev.resolve({ action: 'keep_external' })
      const pending = { ...info, id: ++conflictSeq, resolve }
      pendingConflict.value = pending
      // 外发 conflict 事件(headless 集成方可经 onEvent/hook 收,无需 watch ref)
      emit({ type: 'conflict', conflict: pending })
    })
  }
  function resolveConflict(action: ConflictResolution['action']) {
    const p = pendingConflict.value
    if (!p) return
    pendingConflict.value = null
    p.resolve({ action })
  }

  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (options.debug && store) {
    store.onEvent((e) => console.log('[page-agent-sdk][storage]', e))
  }

  // ===== 模型能力(声明优先 > model 名查表 > 缺省):供 offload 阈值/压缩触发/maxTokens 缺省自适应 =====
  const llmCfg = isChatModel(options.llm) ? undefined : (options.llm as LLMConfig)
  const modelCaps = resolveModelCaps({
    model: llmCfg?.model,
    contextWindow: options.contextWindow ?? llmCfg?.contextWindow,
    maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens,
  })
  if (options.debug) console.log('[page-agent-sdk][modelCaps]', modelCaps)

  // 摘要用 LLM invoke(默认 LLM 摘要压缩);apiKey 缺失时为 undefined → 自动回退零成本索引摘要
  const summaryLlmInvoke = buildSummaryLlmInvoke(options)
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
  })

  const todosMw = createTodosMiddleware()
  const memoryMw = createMemoryMiddleware(options.memory || '')

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
  const caps = options.capabilities
  const useDataOps = caps?.dataOps !== false

  // 最终 systemPrompt = 用户 systemPrompt(或默认)+ 可操作数据段(从 data schema .describe() 自动注入;inspect 与 createAgent 共用,保持一致)
  // appendReliableWriteRules 默认 true:自定义 systemPrompt 时自动在末尾追加 reliableWriteRules(用 '---' 分隔线明确区分用户内容与 SDK 追加的写入规则)
  // 设 false 则不追加(用户已自行写规则时用);不传 systemPrompt 用默认 prompt 时已内置,此项无效
  const appendRwr = options.appendReliableWriteRules !== false
  const basePrompt = options.systemPrompt
    ? (appendRwr ? options.systemPrompt + '\n\n---\n\n' + systemPromptHelpers.reliableWriteRules : options.systemPrompt)
    : DEFAULT_SYSTEM_PROMPT
  const finalSystemPrompt = basePrompt + buildDataPrompt(finalDataConfig)

  // 工具:数据操作 + 文档抓取 + 用户自定义(子 agent 中间件据此筛选只读子集)
  // dataOps/fetch 可经 capabilities 关闭(默认开,保持零配置;关则不进工具池,省 token/上下文);筛选经纯函数 selectBuiltinTools(可单测)
  const dataOpsTools = useDataOps && finalDataConfig
    ? createDataOps(finalDataConfig, {
        onAudit: options.onAudit ?? (options.debug ? (e) => console.log('[page-agent-sdk][data audit]', e) : undefined),
        maxSnapshots: options.maxSnapshots,
        onConflict: setPendingConflict,
        autoLock: options.autoLock,
        interceptors: options.interceptors,
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
  const builtinTools = selectBuiltinTools(caps, dataOpsFiltered, fetchDocTools)
  builtinTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  const userTools: StructuredToolInterface[] = [
    ...(options.tools || []),
  ]
  userTools.forEach((t) => toolSources.set(t.name, 'user'))
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
  const allTools: StructuredToolInterface[] = [
    ...builtinTools,
    ...userTools,
    ...(humanConfirmTool ? [humanConfirmTool] : []),
    ...checkpointTools,
  ]

  const usePlanning = caps?.planning !== false
  const useSkills = caps?.skills !== false
  const useVfs = caps?.vfs !== false
  const useSummarization = caps?.summarization !== false
  const useMemory = caps?.memory !== false
  const useSubagent = caps?.subagent !== false
  // verify 默认关(烧 token);需 capabilities.verify:true + 未显式 enabled:false + maxAttempts>0(check 可选,省略则用 createWriteBackCheck)
  const verifyMaxAttempts = options.verify?.maxAttempts ?? 2
  const useVerify = caps?.verify === true && options.verify?.enabled !== false && verifyMaxAttempts > 0
  // 诊断:常见误用 warn(与 options.id/mcp 的 warn 惯例一致),避免"以为开了实际没开"
  if (options.verify?.check && caps?.verify !== true) {
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
          allTools,
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
  const subagentsMw = options.subagents?.length
    ? createSubagentsMiddleware(options.subagents, { llm: options.llm, allTools, debug: options.debug })
    : undefined

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
  // SDK 事件回调:把常用时机外发给集成方(数据槽变化 / 消息更新 / 流式事件 / 错误)
  const userOnEvent = options.onEvent
  // 运行时动态订阅(sdk.hook 注册,可多个监听器,各自可取消)
  const listeners = new Set<SdkEventHandler>()
  const emit: SdkEventHandler = (event) => {
    // approval_request 不外发(UI 已处理,避免集成方误调 resolve 双重收口)
    if ((event as any).type === 'approval_request') return
    if (userOnEvent) { try { userOnEvent(event) } catch { /* 回调抛错不影响 agent 循环 */ } }
    for (const l of listeners) { try { l(event) } catch { /* 单个监听器抛错不影响其他 */ } }
  }

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
  const middlewares = [
    usageHintsMw,
    // 按 capabilities 条件装载内置中间件(默认全开;verify 默认关)
    ...(usePlanning ? [todosMw] : []),
    ...(useSkills
      ? [
          skillsMw = createSkillsMiddleware(options.skills || [], {
            // vfs 启用时注入 readVfs,让 skill 文档源(vfs://path)能读取 vfs 文件
            readVfs: useVfs ? (p: string) => vfsStore.files[p]?.content : undefined,
          }),
        ]
      : []),
    ...(useVfs ? [createVfsMiddleware(vfsStore)] : []),
    ...(useSummarization
      ? [
          createSummarizationMiddleware({
            // 预设档位(默认 auto)提供合理默认 → contextOptions 细参覆盖个别字段 → 兜底
            ...resolveContextOptions(options, modelCaps.contextWindow),
            llmInvoke: summaryLlmInvoke,
            // A:压缩时注入当前主数据说明(防 LLM 基于过时记忆操作;dataOps 关闭时 liveData() 返回 undefined,无影响)
            getRegisteredData: () => liveData() ? [{ description: liveData()!.description ?? '主数据对象' }] : [],
            // C:跨轮摘要时保留 describe/read 工具的 result 摘要(防字段描述被摘要掉);用户可在 contextOptions 覆盖
            preserveLastToolResults:
              (options.contextOptions && (options.contextOptions as any).preserveLastToolResults) ??
              ['describe_data', 'read'],
          }),
        ]
      : []),
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
    ...(options.middleware || []),
    // SDK 事件中间件(最末,最后观察):数据写后发 data_change;每轮结束发 message_update
    // 始终装载 —— 集成方可能运行时 sdk.hook() 订阅,构造时无 onEvent 也需就绪;无监听器时 emit 为 no-op,开销可忽略
    createSdkEventMiddleware(emit, messages, liveData, usage),
  ]

  const maxMemoryRounds = options.maxMemoryRounds ?? DEFAULT_MAX_MEMORY_ROUNDS

  const core: AgentCore = {
    agentId,
    store,
    messages,
    vfsStore,
    listeners,
    todosMw,
    memoryMw,
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
    pendingConflict,
    liveData,
    usage,
    emit,

    /** 持久化恢复:灌入 messages / vfs / todos / memory / userSkills(hydrate 不触发 vfs save) */
    applySnapshot(snap: SessionSnapshot): void {
      if (snap.messages?.length) messages.push(...snap.messages)
      if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
      if (snap.todos?.length) todosMw.reset(snap.todos)
      // memory:options.memory 优先(非空覆盖),否则用持久化的
      if (snap.memory && !options.memory) memoryMw.reset(snap.memory)
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

    async send(message: string): Promise<string> {
      await core.initDone
      // input 拦截器:send 入口预处理 user message(可改写/审计)
      let msg = message
      if (options.interceptors?.input) {
        try { const r = options.interceptors.input(message); if (typeof r === 'string') msg = r } catch { /* 拦截器抛错忽略,用原 message */ }
      }
      messages.push({ role: 'user', content: msg, timestamp: Date.now() })
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
      } catch (err: any) {
        emit({ type: 'error', message: err?.message || String(err) })
        throw err
      }
    },

    /** 切换会话:flush 当前 → 载入/新建目标 → 清内存态并灌入快照(替换语义)→ 返回新会话 id */
    async switchSession(sessionId?: string): Promise<string> {
      await core.initDone
        if (!store) throw new Error('page-agent-sdk: storage 未开启,无法切换会话(请传 storage 选项)')
      // 收口挂起的冲突(按「保留外部」),防切会话后旧 conflict Promise 永久挂起
      resolveConflict('keep_external')
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
      // 释放上一会话的调试日志(切会话后旧日志不再相关,立即释放内存)
      core.agent!.debugLogs.value = []
      if (!snap) snap = await store.load(agentId, target)
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: target, rounds: snap.messages?.length ?? 0 })
      }
      if (options.memory) void store.save(agentId, core.sessionId, { memory: options.memory })
      return target
    },

    stream: (msgs, onEvent, signal) => {
      if (!core.agent) throw new Error('page-agent-sdk: agent 尚未初始化完成,请先 await mount()')
      // 包装:把 stream 事件同时转发给集成方 onEvent(approval_request 已由 emit 过滤)
      const wrappedHandler: StreamHandler = userOnEvent
        ? (event) => { onEvent?.(event); emit(event as SdkEvent) }
        : onEvent
      // abort 联动:用户停止生成时,自动收口挂起的乐观锁冲突(按「保留外部」处理,防工具永久挂起)
      if (signal) {
        const abortConflict = () => resolveConflict('keep_external')
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

    resolveConflict,

    /** 检视 agent 详情:tools/skills/data/memory/middleware/todos(inspect() 与 debug 窗口消费) */
    getInfo(): AgentInfo {
      return {
        id: agentId,
        model: isChatModel(options.llm) ? ((options.llm as any).model ?? (options.llm as any).modelName) : options.llm.model,
        systemPrompt: finalSystemPrompt,
        tools: allTools.map((t) => ({ name: t.name, description: t.description, schema: (t as any).schema, source: toolSources.get(t.name) || 'user' })),
        skills: (skillsMw ? (skillsMw as any).controller.get() as SkillSpec[] : (options.skills ?? [])).map((s) => ({ name: s.name, description: s.description })),
        data: liveData() ? { description: liveData()!.description, schema: liveData()!.schema } : undefined,
        memory: options.memory ?? '',
        middleware: middlewares.map((m) => m.name),
        todos: (core.agent?.getState?.()?.todos ?? []).map((t) => ({ content: t.content, status: t.status })),
        subagent: {
          enabled: !!subagentMw,
          maxDepth: options.subagent?.maxDepth ?? 1,
          maxParallel: options.subagent?.maxParallel ?? 4,
          allowedTools: options.subagent?.allowedTools ?? [],
        },
        verify: {
          enabled: !!verifyMw,
          maxAttempts: useVerify ? verifyMaxAttempts : 0,
          adversarial: useVerify && !!options.verify?.adversarial,
        },
        mcp: { servers: core.mcpServers },
        lastCompression: core.agent?.getState?.()?.lastCompression as AgentInfo['lastCompression'],
        checkpoints: checkpointMgr
          ? { enabled: true, auto: checkpointAuto, list: checkpointMgr.list() }
          : undefined,
      }
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
    if (options.memory) void store.save(agentId, core.sessionId, { memory: options.memory })
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
  function trimMemoryMessages(): void {
    const r = trimMemoryMessagesImpl(messages, maxMemoryRounds)
    if (r.trimmed) messages.splice(r.deleteFrom, r.deleteCount, r.summary)
  }

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
      const mcpTools: StructuredToolInterface[] = []
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
      allTools.push(...mcpTools)
      if (options.debug) console.log(`[page-agent-sdk][mcp] 注入 ${mcpTools.length} 个工具,${core.mcpServers.length} 个 server`)
    }
    core.agent = createAgent({
      // provider 抽离:llm 为模型实例则注入,否则按配置构造 ChatOpenAI
      ...(isChatModel(options.llm)
        ? { llm: options.llm }
        : {
            apiKey: options.llm.apiKey,
            baseUrl: options.llm.baseUrl,
            model: options.llm.model,
            temperature: options.llm.temperature,
            maxTokens: options.llm.maxTokens,
          }),
      systemPrompt: finalSystemPrompt,
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
      debug: options.debug,
    })
    agentRef.current = core.agent
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

  async function mount(): Promise<void> {
    await core.initDone
    // 已挂载且隐藏中(抽屉模式 hide 后再 mount):直接 show,不重建 vueApp,保留 agent/历史/生成进程
    if (vueApp) {
      show()
      return
    }
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
            fetchStream: streaming ? core.agent!.stream : undefined,
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
            onClear: () => {
              // 新建会话:同步生成 id + 重置内存态(vfs/todos/memory/debugLogs),防旧会话数据残留或污染新会话
              if (!core.store) return
              core.sessionId = makeId()
              core.vfsStore.clear?.()
              core.todosMw.reset([])
              if (!options.memory) core.memoryMw.reset('')
              // 同步释放上一会话的调试日志(否则要等下次 send 才重置,清空后抽屉仍挂旧日志占内存)
              core.agent!.debugLogs.value = []
              void core.store.createSession(core.agentId, options.session?.title, core.sessionId)
            },
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
            onClose: dialogCfg.onClose ?? (dialogCfg.drawer === true ? () => hide() : () => unmount()),  // 抽屉模式:点击遮罩/关闭按钮 → 默认 hide(保留 agent/历史/生成进程,再 mount 直接 show);非抽屉或用户传 onClose 时用自定义/卸载
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

  return {
    mount,
    unmount,
    hide,
    show,
    send: core.send,
    switchSession: core.switchSession,
    stream: core.stream,
    inspect: core.getInfo,
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
      core.infoTick.value++  // 触发 DebugDrawer 的 Agent 信息重新拉取(实时反映 skills 变更)
    },
    /** 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖);触发 controller 合并 + infoTick 刷新 */
    addSkill: (skill: SkillSpec) => {
      if (!core.skillsController) {
        console.warn('[page-agent-sdk] addSkill 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      core.addSkill(skill)
    },
    /** 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills);返回是否删除成功 */
    removeSkill: (name: string): boolean => {
      if (!core.skillsController) {
        console.warn('[page-agent-sdk] removeSkill 忽略:skills 已关闭(capabilities.skills:false)')
        return false
      }
      return core.removeSkill(name)
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
      if (opts?.emit !== false) core.emit({ type: 'data_change', operation: 'set', value: bind })
      return { ok: true }
    },
    /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
    usage: core.usage,
    /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 此 ref 自建 UI */
    pendingConflict: core.pendingConflict,
    /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
    resolveConflict: (action: ConflictResolution['action']) => core.resolveConflict(action),
  }
}
