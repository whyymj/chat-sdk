/**
 * 测试模块:JSON 驱动的响应式页面
 *
 * 设计:window.page 是一个 reactive 对象 { title, theme, components[] }。
 * Agent 通过 set_data_slot 修改 page.title / page.theme / page.components,
 * 左侧 PageRenderer 实时响应更新。
 *
 * components 是 discriminated union(by type),写入时强校验,Agent 传错类型会收到清晰错误。
 */
import { z } from 'zod'
import type { DataSlotSpec } from '../../src/core/tools/dataSlotOps'

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
  title: z.string(),
  theme: z.enum(['light', 'dark']),
  components: z.array(componentSchema),
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

/** 注册到 dataSlotOps 的可操作属性(粒度到子属性,保证响应式) */
export const pageDataSlots: DataSlotSpec[] = [
  { path: 'page.title', description: '页面标题(字符串)', schema: z.string() },
  { path: 'page.theme', description: '页面主题:light 或 dark', schema: z.enum(['light', 'dark']) },
  {
    path: 'page.components',
    description: '组件数组(整体替换)。每个元素结构见下方组件类型。',
    schema: z.array(componentSchema),
  },
]

/** page-builder skill 全文:教 Agent 如何编辑页面 */
export const pageBuilderSkillContent = `# 页面构建 Skill(window.page)

左侧页面由 \`window.page\` 这个 JSON 对象驱动,结构:
\`\`\`json
{ "title": "页面标题", "theme": "light", "components": [ ...组件... ] }
\`\`\`

## 可操作属性(用 set_data_slot 修改,value 必须是合法 JSON 字符串)
- \`page.title\`:字符串。例:set_data_slot({ path: "page.title", value: "\\"新标题\\"" })
- \`page.theme\`:"light" | "dark"。例:value: "\\"dark\\""
- \`page.components\`:组件数组,**整体替换**。修改单个组件也要传入完整新数组。

## 修改流程
1. 先 get_data_slot({ path: "page" }) 读取当前完整页面
2. 在脑中/工作区构造修改后的完整 \`components\` 数组
3. set_data_slot({ path: "page.components", value: "<完整数组的 JSON>" })

## 组件类型(value 里每个组件对象的格式)
- 标题:{ "type": "heading", "text": "标题", "level": 1 }   // level 1-6 可选
- 段落:{ "type": "paragraph", "text": "段落文本" }
- 按钮:{ "type": "button", "label": "按钮文字", "variant": "primary" }   // variant: primary|secondary|ghost 可选
- 图片:{ "type": "image", "src": "https://...", "alt": "说明" }
- 列表:{ "type": "list", "items": ["项A", "项B"] }
- 卡片:{ "type": "card", "title": "标题", "text": "正文" }

## 注意
- value 永远是 **JSON 字符串**:字符串值要额外加引号(如标题 value 是 \`"\\\\\"新标题\\\\\""\`),数组/对象直接 JSON 化。
- 改 components 时必须传**完整数组**(含未改动的组件),因为是整体替换。
- 校验失败会返回具体错误,按提示修正 type/字段后重试。
`
