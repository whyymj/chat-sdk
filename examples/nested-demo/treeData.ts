import { z } from '../../src/core'

/**
 * 嵌套树示例的数据与 schema —— 对齐实际项目 window.Editor.PageInfo 格式。
 *
 * 结构:window.Editor.PageInfo = { title, theme, sections: [ { id, name, type, style, children: [...] } ] }
 * 关键点:
 *  - 递归 schema 用 z.lazy(() => BlockSchema) 自引用(需显式 : z.ZodType 类型批注),支持任意深度
 *  - style 作为显式 schema 字段声明(带结构),校验颜色/尺寸等;其它自定义属性靠 .passthrough() 放行
 *  - 注册整个 PageInfo 根 path('Editor.PageInfo'),Agent 经 jsonPath 逐级定位深层节点
 */

export interface Style {
  background?: string
  color?: string
  fontSize?: number
  fontWeight?: number
  padding?: number
  margin?: number
  borderRadius?: number
  display?: string
  [k: string]: unknown // passthrough:放行未声明的自定义样式属性
}

export type BlockType = 'section' | 'text' | 'button' | 'image' | 'card'

export interface Block {
  id: string
  name: string
  type: BlockType
  text?: string
  src?: string
  style?: Style
  children?: Block[]
  [k: string]: unknown // passthrough:放行未声明的自定义属性
}

export interface PageInfo {
  title: string
  theme?: 'light' | 'dark'
  sections: Block[]
  [k: string]: unknown
}

/** 样式 schema:显式声明常用样式键,其余自定义键靠 passthrough 放行 */
const StyleSchema = z
  .object({
    background: z.string().optional(),
    color: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.number().optional(),
    padding: z.number().optional(),
    margin: z.number().optional(),
    borderRadius: z.number().optional(),
    display: z.string().optional(),
  })
  .passthrough()

/** 递归区块 schema:children 自引用 → 任意深度;style 显式声明;其余自定义属性 passthrough 放行 */
const BlockSchema: z.ZodType = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['section', 'text', 'button', 'image', 'card']),
    text: z.string().optional(),
    src: z.string().optional(),
    style: StyleSchema.optional(),
    children: z.array(z.lazy(() => BlockSchema)).optional(),
  })
  .passthrough()

/** PageInfo 根 schema:注册到 window.Editor.PageInfo */
export const PageInfoSchema = z
  .object({
    title: z.string(),
    theme: z.enum(['light', 'dark']).optional(),
    sections: z.array(BlockSchema),
  })
  .passthrough()

/** 初始页面信息(两层 section + 子区块,演示任意深度 + style 自定义属性) */
export const initialPageInfo: PageInfo = {
  title: '夏日好物节',
  theme: 'light',
  sections: [
    {
      id: 's-banner',
      name: '顶部 Banner',
      type: 'section',
      style: { background: '#1f4d3a', padding: 32, borderRadius: 12 },
      children: [
        { id: 'b-title', name: '主标题', type: 'text', text: '夏日好物节', style: { color: '#ffffff', fontSize: 32, fontWeight: 700 } },
        { id: 'b-sub', name: '副标题', type: 'text', text: '精选好物 限时优惠', style: { color: '#e5e7eb', fontSize: 16 } },
        { id: 'b-btn', name: '行动按钮', type: 'button', text: '立即抢购', style: { background: '#f59e0b', color: '#ffffff', borderRadius: 8, padding: 10 } },
      ],
    },
    {
      id: 's-list',
      name: '商品列表',
      type: 'section',
      style: { background: '#ffffff', padding: 24, display: 'grid' },
      children: [
        { id: 'c-1', name: '商品卡 1', type: 'card', text: '无线耳机', style: { borderRadius: 10, padding: 16 } },
        { id: 'c-2', name: '商品卡 2', type: 'card', text: '机械键盘', style: { borderRadius: 10, padding: 16 } },
      ],
    },
  ],
}
