/**
 * 复杂页面 demo:10 种组件拼装一个页面
 *
 * 结构:每个组件 = { type, id?, style?, visible?, className?, props: {...业务字段} }
 * 通用配置(id/style/visible/className)在根,不通用字段统一包装到 props 子对象。
 * 配置:data bind 字段直连 reactive 对象(本 demo 保留 reactive 展示 Vue 响应式模式),schema 的 .describe() 自动注入 systemPrompt。
 */
import { z } from 'zod'

/** 统一基础配置(所有组件共享) */
const baseProps = {
  id: z.string().optional().describe('组件唯一 id(可选,用于锚点/调试)'),
  style: z.record(z.string(), z.string()).optional().describe('自定义内联样式对象,键值对,如 { color: "red", padding: "8px" }'),
  visible: z.boolean().optional().describe('是否显示,默认 true;设 false 隐藏组件'),
  className: z.string().optional().describe('附加 class 名(可选)'),
}

/** 1. 标题 */
const headingSchema = z.object({
  type: z.literal('heading'),
  ...baseProps,
  props: z.object({
    text: z.string().describe('标题文本'),
    level: z.number().int().min(1).max(6).optional().describe('层级 1-6,默认 2'),
  }).describe('标题配置'),
})

/** 2. 富文本 */
const richTextSchema = z.object({
  type: z.literal('richText'),
  ...baseProps,
  props: z.object({
    html: z.string().describe('富文本 HTML 内容(支持 <b>/<i>/<a>/<p>/<ul>/<li> 等基础标签)'),
  }).describe('富文本配置'),
})

/** 3. 商品瀑布流 */
const productGridSchema = z.object({
  type: z.literal('productGrid'),
  ...baseProps,
  props: z.object({
    columns: z.number().int().min(1).max(6).describe('列数 1-6'),
    gap: z.number().min(0).max(60).optional().describe('卡片间距 px,默认 16'),
    products: z.array(z.object({
      id: z.string().describe('商品 id'),
      title: z.string().describe('商品标题'),
      price: z.number().describe('价格(元)'),
      image: z.string().describe('商品主图地址'),
      tag: z.string().optional().describe('标签(如"新品"/"促销",可选)'),
    })).describe('商品列表'),
  }).describe('商品瀑布流配置'),
})

/** 4. 图片 */
const imageSchema = z.object({
  type: z.literal('image'),
  ...baseProps,
  props: z.object({
    src: z.string().describe('图片地址'),
    alt: z.string().optional().describe('替代文字'),
    width: z.string().optional().describe('宽度(如 "100%" / "320px",默认 100%)'),
  }).describe('图片配置'),
})

/** 5. 按钮 */
const buttonSchema = z.object({
  type: z.literal('button'),
  ...baseProps,
  props: z.object({
    label: z.string().describe('按钮文字'),
    variant: z.enum(['primary', 'secondary', 'ghost', 'danger']).optional().describe('样式,默认 primary'),
    action: z.string().optional().describe('点击动作描述(仅展示,不实际跳转)'),
  }).describe('按钮配置'),
})

/** 6. 列表 */
const listSchema = z.object({
  type: z.literal('list'),
  ...baseProps,
  props: z.object({
    items: z.array(z.string()).describe('列表项'),
    ordered: z.boolean().optional().describe('是否有序号(ol),默认 false(ul)'),
  }).describe('列表配置'),
})

/** 7. 卡片 */
const cardSchema = z.object({
  type: z.literal('card'),
  ...baseProps,
  props: z.object({
    title: z.string().describe('卡片标题'),
    text: z.string().describe('卡片正文'),
    image: z.string().optional().describe('卡片配图(可选)'),
    link: z.string().optional().describe('跳转链接(可选,仅展示)'),
  }).describe('卡片配置'),
})

/** 8. 间距 */
const spacerSchema = z.object({
  type: z.literal('spacer'),
  ...baseProps,
  props: z.object({
    height: z.number().min(0).max(500).describe('间距高度 px'),
  }).describe('间距配置'),
})

/** 9. 分割线 */
const dividerSchema = z.object({
  type: z.literal('divider'),
  ...baseProps,
  props: z.object({
    label: z.string().optional().describe('分割线中间文字(可选,无则纯线)'),
  }).describe('分割线配置'),
})

/** 10. 轮播 */
const carouselSchema = z.object({
  type: z.literal('carousel'),
  ...baseProps,
  props: z.object({
    autoplay: z.boolean().optional().describe('是否自动播放,默认 false'),
    interval: z.number().int().min(1000).max(20000).optional().describe('切换间隔 ms,默认 3000'),
    slides: z.array(z.object({
      image: z.string().describe('轮播图地址'),
      caption: z.string().optional().describe('说明文字(可选)'),
    })).describe('轮播项'),
  }).describe('轮播配置'),
})

/**
 * 容器组件(支持 children 嵌套其他组件)
 * - container:通用容器,可设 padding,children 任意组件
 * - section:带标题区块,title + children
 * - grid:网格布局,columns + gap + children
 * children 用 z.lazy 递归引用 componentSchema(下方定义)
 */
const containerSchema = z.object({
  type: z.literal('container'),
  ...baseProps,
  props: z.object({
    padding: z.number().min(0).max(100).optional().describe('内边距 px,默认 0'),
    children: z.lazy(() => z.array(componentSchema)).describe('子组件数组(任意 type,递归嵌套)'),
  }).describe('通用容器配置'),
})

const sectionSchema = z.object({
  type: z.literal('section'),
  ...baseProps,
  props: z.object({
    title: z.string().describe('区块标题'),
    children: z.lazy(() => z.array(componentSchema)).describe('子组件数组'),
  }).describe('带标题区块配置'),
})

const gridSchema = z.object({
  type: z.literal('grid'),
  ...baseProps,
  props: z.object({
    columns: z.number().int().min(1).max(6).describe('列数 1-6'),
    gap: z.number().min(0).max(60).optional().describe('列间距 px,默认 12'),
    children: z.lazy(() => z.array(componentSchema)).describe('子组件数组(按列排布)'),
  }).describe('网格布局配置'),
})

/** 组件联合(by type 区分,含容器,递归)。z.lazy 递归需显式标注类型避免 TS 循环推断 */
export const componentSchema: z.ZodType<PageComponent> = z.lazy(() => z.discriminatedUnion('type', [
  headingSchema, richTextSchema, productGridSchema, imageSchema,
  buttonSchema, listSchema, cardSchema, spacerSchema, dividerSchema, carouselSchema,
  containerSchema, sectionSchema, gridSchema,
]))

/** 递归类型需手动声明(z.infer 无法推导 z.lazy 自引用) */
export type PageComponent =
  | z.infer<typeof headingSchema> | z.infer<typeof richTextSchema>
  | z.infer<typeof productGridSchema> | z.infer<typeof imageSchema>
  | z.infer<typeof buttonSchema> | z.infer<typeof listSchema>
  | z.infer<typeof cardSchema> | z.infer<typeof spacerSchema>
  | z.infer<typeof dividerSchema> | z.infer<typeof carouselSchema>
  | { type: 'container'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string; props: { padding?: number; children: PageComponent[] } }
  | { type: 'section'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string; props: { title: string; children: PageComponent[] } }
  | { type: 'grid'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string; props: { columns: number; gap?: number; children: PageComponent[] } }

/** 整页 schema */
export const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z.array(componentSchema).describe('组件数组(按顺序拼装页面)'),
})

export type PageData = z.infer<typeof pageSchema>

/** 初始示例页面:10 种叶子组件 + 3 种容器组件(含嵌套) */
export const initialPage: PageData = {
  title: '复杂页面 Demo',
  components: [
    { type: 'heading', id: 'hero-title', style: { textAlign: 'center', color: '#e11d48' }, props: { text: '🔥 周年庆大促', level: 1 } },
    { type: 'carousel', props: { autoplay: true, interval: 4000, slides: [
      { image: 'https://picsum.photos/seed/banner1/800/300', caption: '满 300 减 50' },
      { image: 'https://picsum.photos/seed/banner2/800/300', caption: '新品首发' },
      { image: 'https://picsum.photos/seed/banner3/800/300', caption: '会员专享' },
    ] } },
    { type: 'richText', props: { html: '<p>本次活动 <b>全场满减</b>,<i>限时 3 天</i>。更多详情见 <a href="#">活动规则</a>。</p>' } },
    { type: 'divider', props: { label: '精选好物' } },
    { type: 'productGrid', props: { columns: 3, gap: 16, products: [
      { id: 'p1', title: '无线降噪耳机', price: 899, image: 'https://picsum.photos/seed/p1/300/300', tag: '新品' },
      { id: 'p2', title: '机械键盘', price: 459, image: 'https://picsum.photos/seed/p2/300/300', tag: '热销' },
      { id: 'p3', title: '4K 显示器', price: 1899, image: 'https://picsum.photos/seed/p3/300/300' },
      { id: 'p4', title: '蓝牙音箱', price: 299, image: 'https://picsum.photos/seed/p4/300/300', tag: '促销' },
      { id: 'p5', title: '智能手表', price: 1299, image: 'https://picsum.photos/seed/p5/300/300' },
      { id: 'p6', title: '游戏鼠标', price: 199, image: 'https://picsum.photos/seed/p6/300/300' },
    ] } },
    { type: 'section', props: { title: '会员权益区', children: [
      { type: 'card', props: { title: '会员权益', text: '开通会员享专属折扣 + 包邮 + 优先客服。每月仅需 9.9 元。', image: 'https://picsum.photos/seed/member/400/200', link: '#member' } },
      { type: 'list', props: { items: ['满 300 减 50', '满 500 减 100', '会员折上折', '限时秒杀每日 10 点'], ordered: false } },
    ] } },
    { type: 'grid', props: { columns: 3, gap: 12, children: [
      { type: 'card', props: { title: '极速发货', text: '24 小时内发货,顺丰直达。' } },
      { type: 'card', props: { title: '七天无忧', text: '不满意可七天无理由退换。' } },
      { type: 'card', props: { title: '正品保障', text: '官方授权,假一赔十。' } },
    ] } },
    { type: 'image', props: { src: 'https://picsum.photos/seed/poster/800/200', alt: '活动海报', width: '100%' } },
    { type: 'container', props: { padding: 16, children: [
      { type: 'button', props: { label: '立即抢购', variant: 'danger', action: '跳转到抢购页' } },
      { type: 'spacer', props: { height: 40 } },
    ] } },
  ],
}

/** complex-builder skill 全文 */
export const complexBuilderSkillContent = `# 复杂页面构建 Skill(window.page)

左侧页面由 \`window.page\` 驱动,结构:{ title, components[] }。components 是按顺序拼装的组件数组。

## 组件结构
每个组件:{ type, id?, style?, visible?, className?, props: {...} }
- 通用配置(根):id(唯一标识)、style(自定义样式对象)、visible(显隐)、className(附加 class)
- 业务配置(props 子对象):各组件特有字段

## 13 种组件(按 type 区分,业务字段在 props 内)
叶子组件:
- heading:props={ text, level? }
- richText:props={ html }
- productGrid:props={ columns, gap?, products[] }
- image:props={ src, alt?, width? }
- button:props={ label, variant?, action? }
- list:props={ items, ordered? }
- card:props={ title, text, image?, link? }
- spacer:props={ height }
- divider:props={ label? }
- carousel:props={ autoplay?, interval?, slides[] }

容器组件(支持 children 嵌套其他组件):
- container:props={ padding?, children[] } 通用容器
- section:props={ title, children[] } 带标题区块
- grid:props={ columns, gap?, children[] } 网格布局(子组件按列排布)

children 是组件数组,可任意嵌套(支持多层),用 jsonPath 增量操作(如 props.children.0.props.text)。

## 修改要点
- 增删组件:改 components 数组(append/splice);容器内改 props.children
- 改单个组件优先用增量 patch(只发改动字段),避免整体重传大数组
- 调样式用根级 style 对象(如 { color: "red" }),不要写 CSS 字符串
- 改业务字段用 props 子对象(如 write({ path, value, patch:{ op:'set', jsonPath:'props.text' } }))
- 校验失败会返回具体错误,按提示修正 type/字段后重试
`
