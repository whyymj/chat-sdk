/**
 * 测试模块:JSON 驱动的响应式页面
 *
 * 设计:window.page 是一个普通对象 { title, theme, components[] }(非 reactive,展示 SDK 不依赖 Vue 响应式)。
 * 配置:普通对象经 data 的 bind 字段直连 SDK,pageSchema 作为 schema 声明形状
 * (字段 .describe() 自动注入 systemPrompt「可操作数据」段 + 作为写入校验 schema)。
 * Agent 通过 write 修改 page 字段,集成方监听 onEvent('data_change') 触发 tick 重渲染画布。
 *
 * components 是 discriminated union(by type),写入时强校验,Agent 传错类型会收到清晰错误。
 */
import { z } from 'zod'

/** 组件 schema:按 type 区分的联合,每个类型有各自字段 */
export const componentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string().describe('标题文本'),
    level: z.number().int().min(1).max(6).optional().describe('层级 1-6,默认 2'),
  }),
  z.object({
    type: z.literal('paragraph'),
    text: z.string().describe('段落文本'),
  }),
  z.object({
    type: z.literal('button'),
    label: z.string().describe('按钮文字'),
    variant: z.enum(['primary', 'secondary', 'ghost']).optional().describe('样式,默认 primary'),
  }),
  z.object({
    type: z.literal('image'),
    src: z.string().describe('图片地址'),
    alt: z.string().optional().describe('替代文字'),
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string()).describe('列表项'),
  }),
  z.object({
    type: z.literal('card'),
    title: z.string().describe('卡片标题'),
    text: z.string().describe('卡片正文'),
  }),
])

export type PageComponent = z.infer<typeof componentSchema>

export const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  theme: z.enum(['light', 'dark']).describe('页面主题:light 或 dark'),
  components: z.array(componentSchema).describe('组件数组(页面内容)'),
})

export type PageData = z.infer<typeof pageSchema>

/** 初始示例页面 */
export const initialPage: PageData = {
  title: '示例页面',
  theme: 'light',
  components: [
    { type: 'heading', text: '你好,页面内 Agent', level: 1 },
    {
      type: 'paragraph',
      text: '这个页面由 window.page 的 JSON 驱动。通过右侧对话框告诉 Agent 要怎么改,左侧会实时更新。',
    },
    { type: 'button', label: '主要按钮', variant: 'primary' },
    { type: 'button', label: '次要按钮', variant: 'secondary' },
    { type: 'list', items: ['需求收集', '方案设计', '编码实现'] },
  ],
}

/** page-builder skill 全文:教 Agent 如何编辑页面(组件类型等业务知识;字段说明由 data schema .describe() 自动注入,此处不重复) */
export const pageBuilderSkillContent = `# 页面构建 Skill(window.page)

左侧页面由 \`window.page\` 这个 JSON 对象驱动,结构:{ title, theme, components[] }。

## 组件类型(每个组件对象的格式)
- 标题:{ "type": "heading", "text": "标题", "level": 1 }   // level 1-6 可选
- 段落:{ "type": "paragraph", "text": "段落文本" }
- 按钮:{ "type": "button", "label": "按钮文字", "variant": "primary" }   // variant: primary|secondary|ghost 可选
- 图片:{ "type": "image", "src": "https://...", "alt": "说明" }
- 列表:{ "type": "list", "items": ["项A", "项B"] }
- 卡片:{ "type": "card", "title": "标题", "text": "正文" }

## 修改要点
- 改单个组件优先用增量 patch(只发改动部分),避免整体重传 \`components\` 大数组被截断
- 校验失败会返回具体错误,按提示修正 type/字段后重试
`
