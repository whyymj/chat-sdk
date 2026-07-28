# page-agent-sdk 对接提示词(Vue2 + npm + 低代码页面构建 + 抽屉模式)

把本提示词复制到对接项目的 Cursor / Claude Code,让该项目的 AI 按流程集成 `page-agent-sdk`。

---

## 你的任务

在当前 Vue2 项目中集成 `page-agent-sdk`(npm 包),实现「低代码页面构建 + AI 抽屉对话框」:集成方声明一个主数据对象(组件树/页面配置),AI Agent 经 schema 校验的工具 `read`/`write` 增量改它,左侧页面实时更新,右侧抽屉对话框驱动。

## 背景知识

- `page-agent-sdk` 是**框架无关的 JS SDK**(内部打包 Vue 3.5,对外不冲突,Vue2 项目可直接用)
- 核心模型:集成方声明 **一个主数据对象** `data: { schema, bind, description? }`,Agent 经工具读写 `bind`(schema 校验 + 白名单 + 乐观锁 + 快照)
- `bind` 是普通/响应式对象,工具直接读写它,**无 window 依赖**
- `schema` 用 zod 声明,字段 `.describe()` 自动注入 systemPrompt,集成方不用手写字段说明
- 工具:`read`(读,支持 jsonPath/fields/depth 投影)、`write`(写,合并 set/edit/delete + 自动乐观锁 + 自动快照,支持 patch jsonPath 增量)
- 详细文档:加载 `page-agent-sdk-integrate` skill(若已安装),或参考 `node_modules/page-agent-sdk/skills/page-agent-sdk-integrate/`

## Vue2 集成关键点(务必注意)

1. **SDK 自带 Vue 3.5**:打包进库,与 Vue2 宿主隔离,不冲突,Vue2 项目直接用
2. **bind 响应式**:Vue2 用 `Object.defineProperty`,对**已存在属性**响应;**新增属性**不响应(需 `Vue.set`)
   - 推荐:bind 用 Vue2 响应式对象(`data()` 返回对象 或 `Vue.observable(obj)`)
   - SDK 的 `write` set 整对象用 **merge 语义**(就地改已存在属性)→ Vue2 响应
   - SDK 的 `write` patch `append`(数组 push)→ Vue2 数组方法已重写,响应
   - SDK 的 `write` patch `set` 新字段 → Vue2 **新增属性不响应** → 需 `onEvent('data_change')` 触发重渲染(见下)
3. **UI 刷新双保险**:Vue2 响应式管已存在属性/数组方法;`onEvent('data_change')` 管新增属性/兜底重渲染
   ```js
   // 用 :key="tick" 强制组件树重建读最新 bind(新增属性场景必备)
   onEvent(e) { if (e.type === 'data_change') this.tick++ }
   ```

## 集成步骤

### 1. 安装

```bash
npm i page-agent-sdk zod @langchain/openai @langchain/core
```

### 2. 声明主数据对象 + schema(关键步骤)

```ts
// pageSchema.ts
import { z } from 'page-agent-sdk'

// 通用基础配置(所有组件共享)
const baseProps = {
  id: z.string().optional().describe('组件唯一 id(可选,锚点/调试)'),
  style: z.record(z.string(), z.string()).optional().describe('内联样式对象,如 { color: "red" }'),
  visible: z.boolean().optional().describe('是否显示,默认 true'),
  className: z.string().optional().describe('附加 class'),
}

// 组件 schema(按 type 区分,业务字段在 props 子对象)
const headingSchema = z.object({
  type: z.literal('heading'),
  ...baseProps,
  props: z.object({ text: z.string().describe('标题文本'), level: z.number().min(1).max(6).optional() }).describe('标题配置'),
})
const buttonSchema = z.object({
  type: z.literal('button'),
  ...baseProps,
  props: z.object({ label: z.string().describe('按钮文字'), variant: z.enum(['primary', 'ghost']).optional() }).describe('按钮配置'),
})
// ... 其他组件

// 容器组件(children 递归嵌套)
const containerSchema = z.object({
  type: z.literal('container'),
  ...baseProps,
  props: z.object({
    padding: z.number().optional().describe('内边距 px'),
    children: z.lazy(() => z.array(componentSchema)).describe('子组件数组(任意嵌套)'),
  }).describe('容器配置'),
})

// 组件联合(递归)
export const componentSchema: z.ZodType = z.lazy(() => z.discriminatedUnion('type', [
  headingSchema, buttonSchema, containerSchema, /* ... */
]))

// 整页 schema
export const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z.array(componentSchema).describe('组件数组(按顺序拼装页面)'),
})
```

### 3. 在 Vue2 组件中集成(抽屉模式)

```vue
<template>
  <div>
    <!-- 左侧:页面渲染区(AI 可编辑) -->
    <div class="page-canvas">
      <PageRenderer :key="tick" :page="page" />
    </div>
    <!-- 右侧:抽屉触发按钮 -->
    <button class="agent-trigger" @click="openAgent">🤖 AI 助手</button>
    <!-- SDK 挂载点(抽屉模式:右侧滑出 + 遮罩) -->
    <div ref="agentRoot"></div>
  </div>
</template>

<script>
import Vue from 'vue'
import { createChatSdk, defineSkill } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'
import { pageSchema, builderSkillContent } from './pageSchema'

export default {
  data() {
    // bind 用 Vue2 响应式对象(data 返回 → 响应式)
    return {
      page: {
        title: '新页面',
        components: [
          { type: 'heading', props: { text: '欢迎', level: 1 } },
        ],
      },
      tick: 0,        // 重渲染触发器(新增属性场景)
      agent: null,
      mounted: false,
    }
  },
  mounted() {
    this.agent = createChatSdk({
      container: this.$refs.agentRoot,
      id: 'page-builder',           // 稳定 id(多 agent 隔离 + 持久化命名空间)
      storage: 'memory',
      llm: {
        apiKey: process.env.VITE_AI_API_KEY || 'YOUR_API_KEY',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.3,            // 大 JSON 操作建议低温
      },
      // 抽屉模式:右侧滑出 + 遮罩;关闭按钮默认调 hide()(保留历史与生成进程,不卸载)
      dialog: {
        drawer: true,
        title: '页面构建 Agent',
        placeholder: '试试:加一个按钮 / 标题改成红色 / 容器里加一张卡',
      },
      // systemPrompt:描述业务 + 数据结构;reliableWriteRules 会用 '---' 分隔线自动追加(默认 true)
      systemPrompt: '你是低代码页面构建助手。主数据 = { title, components[] }(组件数组按顺序拼装页面)。每个组件 = { type, id?, style?, visible?, className?, props:{...业务字段} };容器组件 props.children 可嵌套任意组件。用户要改页面时,改 title 或 components(增删改组件、调 props、调 style、容器内改 children),左侧实时更新。组件类型与各字段详见 load_skill("page-builder")。',
      appendReliableWriteRules: true,   // 默认 true,自动追加可靠写入规则(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch)
      // data 单主对象:schema + bind 直连 Vue2 响应式对象
      data: { schema: pageSchema, bind: this.page, description: '页面配置' },
      // skill:组件类型与字段说明(供 Agent load_skill 按需加载,省 systemPrompt token)
      skills: [
        defineSkill({
          name: 'page-builder',
          description: '编辑低代码页面(组件树,含容器嵌套 children)。用户要求改页面时使用',
          getContent: () => builderSkillContent,
        }),
      ],
      debug: true,
      // onEvent:Vue2 新增属性不响应 → data_change 时 tick++ 强制 PageRenderer 重建读最新 page
      onEvent: (e) => {
        if (e.type === 'data_change') this.tick++
      },
    })
    this.agent.mount()
    this.mounted = true
  },
  beforeDestroy() {
    this.agent?.unmount()
  },
  methods: {
    openAgent() {
      // 首次 mount 后,点按钮调 show()(抽屉模式 hide/show 保留历史与生成进程)
      if (this.mounted) this.agent.show()
    },
  },
}
</script>
```

### 4. skill 内容(组件类型与字段说明)

```ts
// pageSchema.ts 末尾
export const builderSkillContent = `# 低代码页面构建 Skill

主数据 = { title, components[] }。components 是按顺序拼装的组件数组。

## 组件结构
每个组件:{ type, id?, style?, visible?, className?, props: {...} }
- 通用配置(根):id、style(样式对象)、visible(显隐)、className
- 业务配置(props 子对象):各组件特有字段

## 组件类型(按 type 区分,业务字段在 props 内)
- heading:props={ text, level? }
- button:props={ label, variant? }
- container:props={ padding?, children[] } 通用容器(可嵌套任意组件)

## 修改要点
- 增删组件:改 components 数组(append/splice);容器内改 props.children
- 改单个组件优先用增量 patch(只发改动字段),避免整体重传大数组
- 调样式用根级 style 对象(如 { color: "red" }),不要写 CSS 字符串
- 改业务字段用 props 子对象(如 write({ value:'新文本', patch:{ op:'set', jsonPath:'components.0.props.text' } }))
- 校验失败会返回具体错误,按提示修正 type/字段后重试
- jsonPath 相对主数据根逐级定位(如 components.0.props.children.1.props.text)`
```

### 5. PageRenderer.vue(Vue2 渲染组件)

```vue
<template>
  <div class="page" :style="page.style">
    <h1 v-if="page.title">{{ page.title }}</h1>
    <component
      v-for="(comp, i) in page.components"
      :key="comp.id || i"
      :is="resolveComp(comp.type)"
      :comp="comp"
    />
  </div>
</template>

<script>
export default {
  props: { page: Object },
  methods: {
    resolveComp(type) {
      // 按 type 映射到具体组件(HeadingComp/ButtonComp/ContainerComp/...)
      return { heading: 'HeadingComp', button: 'ButtonComp', container: 'ContainerComp' }[type] || 'div'
    },
  },
}
</script>
```

## 配置项速查

| 选项 | 值 | 说明 |
|---|---|---|
| `dialog.drawer` | `true` | 抽屉模式:右侧滑出 + 遮罩;关闭按钮默认 `hide()` |
| `data` | `{ schema, bind, description? }` | 主数据声明(关键);`bind` 直连 Vue2 响应式对象 |
| `systemPrompt` | 字符串 | 业务描述;`reliableWriteRules` 用 `---` 自动追加 |
| `appendReliableWriteRules` | `true`(默认) | 自动追加可靠写入规则;设 `false` 关闭 |
| `skills` | `defineSkill[]` | 组件类型/字段说明,Agent `load_skill` 按需加载 |
| `storage` | `'memory'` | 会话级持久化(消息/vfs/todos/memory;**不持久化 bind**) |
| `llm.temperature` | `0.3` | 大 JSON 操作建议低温 |
| `onEvent` | `(e) => {}` | 事件回调;`data_change` 时 `tick++` 触发 Vue2 重渲染 |
| `checkpoint` | `true` | 会话级回滚(每轮存档,改坏可一键回退) |
| `approval` | `{ tools: ['write'] }` | 写操作前人工确认(防 AI 误改) |

## 常见坑

1. **Vue2 新增属性不响应**:SDK `write` patch `set` 新字段时,Vue2 `Object.defineProperty` 不响应 → `onEvent('data_change')` 里 `tick++`,用 `:key="tick"` 强制组件树重建
2. **数组操作响应**:Vue2 重写了 `push`/`splice` 等,SDK `write` patch `append`(数组 push)响应正常
3. **bind 不持久化**:`storage` 持久化消息/vfs/todos/memory,但**不持久化 bind**(可能含非序列化内容);跨刷新恢复 bind 需自己存 + `sdk.setData({ bind: restoredBind })`
4. **DeepSeek 400 `missing field tool_call_id`**:SDK 内部已处理,仅自定义工具管道时注意用 snake_case
5. **`.env` `VITE_AI_SYSTEM_PROMPT` 必须单行**(dotenv 不支持多行)
6. **大 JSON 增量改**:改数组元素某字段用 `write({ value:180, patch:{ op:'set', jsonPath:'components.0.props.price' } })`,避免整体重传被 max_tokens 截断
7. **schema 白名单**:`z.object` schema 自动启用白名单(只暴露声明字段);`discriminatedUnion`/`record`/`lazy` 非顶层不启用(全开放)。低代码组件树用 `discriminatedUnion` 时,组件字段都在各分支 schema 声明,无泄露问题

## 验证清单

- [ ] `npm i` 后 `import { createChatSdk, z } from 'page-agent-sdk'` 不报错
- [ ] `import 'page-agent-sdk/style.css'` 抽屉样式正常
- [ ] Agent `read` 能读到 `page` 结构;`write` patch 能改 `components.0.props.text`
- [ ] Vue2 已存在属性改动 → 页面响应;新增属性 → `tick++` 后页面刷新
- [ ] 抽屉关闭后再开(`show()`)→ 历史对话与生成进程保留
- [ ] schema 校验失败 → 返回结构化错误,不写入

## 参考资源

- `node_modules/page-agent-sdk/skills/page-agent-sdk-integrate/`(集成 skill,完整文档)
- `node_modules/page-agent-sdk/dist/`(构建产物)
- 在线示例:`https://esm.sh/page-agent-sdk@2.9.0`(CDN 验证)
