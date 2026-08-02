/**
 * 复杂页面 demo:多种组件拼装一个页面
 *
 * 结构:每个组件 = { type, id?, style?, visible?, className?, props: {...业务字段} }
 * 通用配置(id/style/visible/className)在根,不通用字段统一包装到 props 子对象。
 * 配置:data bind 字段直连 reactive 对象(本 demo 保留 reactive 展示 Vue 响应式模式),schema 的 .describe() 自动注入 systemPrompt。
 */
import { z } from 'zod'

/** 统一基础配置(所有组件共享;~20 通用,覆盖码良平台真实通用参数) */
const baseProps = {
  // 标识与显示
  id: z.string().optional().describe('组件唯一 id(可选,用于锚点/调试)'),
  visible: z.boolean().optional().describe('是否显示,默认 true;设 false 隐藏组件'),
  className: z.string().optional().describe('附加 class 名(可选)'),
  style: z.record(z.string(), z.string()).optional().describe('自定义内联样式对象,键值对,如 { color: "red", padding: "8px" }'),
  // 布局
  margin: z.string().optional().describe('外边距(如 "8px 16px")'),
  padding: z.string().optional().describe('内边距(如 "8px")'),
  width: z.string().optional().describe('宽度(如 "100%"/"320px")'),
  height: z.string().optional().describe('高度(如 "auto"/"200px")'),
  maxWidth: z.string().optional().describe('最大宽度(如 "1200px",限制内容居中范围)'),
  // 响应式
  hideOnMobile: z.boolean().optional().describe('移动端隐藏(<768px)'),
  hideOnDesktop: z.boolean().optional().describe('桌面端隐藏(≥768px)'),
  // 动画
  animated: z.boolean().optional().describe('是否启用入场动画,默认 false'),
  animation: z.enum(['fade', 'slide', 'zoom', 'none']).optional().describe('动画类型,默认 none'),
  animationDuration: z.number().int().min(0).max(5000).optional().describe('动画时长 ms,默认 300'),
  // 交互
  hoverEffect: z.enum(['scale', 'lift', 'highlight', 'none']).optional().describe('悬停效果,默认 none'),
  cursor: z.string().optional().describe('光标样式(如 pointer/help)'),
  // 数据源/主题/无障碍
  dataSource: z.string().optional().describe('数据源标识(绑定后端接口/状态)'),
  theme: z.enum(['light', 'dark', 'custom']).optional().describe('主题色系'),
  ariaLabel: z.string().optional().describe('无障碍标签(读屏用)'),
  tooltip: z.string().optional().describe('悬浮提示文字'),
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

/** 11. 导航栏 */
const navbarSchema = z.object({
  type: z.literal('navbar'), ...baseProps,
  props: z.object({
    logo: z.string().describe('logo 图片地址'),
    title: z.string().optional().describe('站点标题(可选)'),
    menu: z.array(z.object({ label: z.string().describe('菜单项文字'), link: z.string().optional().describe('跳转链接(可选)') })).describe('菜单项列表'),
  }).describe('导航栏配置'),
})
/** 12. 横幅(静态,区别于 carousel 轮播) */
const bannerSchema = z.object({
  type: z.literal('banner'), ...baseProps,
  props: z.object({
    image: z.string().describe('横幅图片地址'),
    link: z.string().optional().describe('点击跳转链接(可选)'),
    text: z.string().optional().describe('叠加文字(可选)'),
  }).describe('横幅配置'),
})
/** 13. 倒计时 */
const countdownSchema = z.object({
  type: z.literal('countdown'), ...baseProps,
  props: z.object({
    targetTime: z.string().describe('目标结束时间(如 "2026-08-15 23:59:59")'),
    labels: z.object({
      days: z.string().optional(), hours: z.string().optional(), minutes: z.string().optional(), seconds: z.string().optional(),
    }).optional().describe('各段标签(默认 天/时/分/秒)'),
  }).describe('倒计时配置'),
})
/** 14. 优惠券 */
const couponSchema = z.object({
  type: z.literal('coupon'), ...baseProps,
  props: z.object({
    amount: z.number().describe('面额(元)'),
    threshold: z.number().optional().describe('使用门槛(满 N 元,可选)'),
    label: z.string().optional().describe('券名(如"新人券")'),
    status: z.enum(['available', 'claimed', 'used', 'expired']).optional().describe('状态,默认 available'),
  }).describe('优惠券配置'),
})
/** 15. 标签页(每标签下可嵌套任意子组件) */
const tabsSchema = z.object({
  type: z.literal('tabs'), ...baseProps,
  props: z.object({
    tabs: z.array(z.object({
      label: z.string().describe('标签文字'),
      children: z.lazy(() => z.array(componentSchema)).describe('该标签下的子组件数组'),
    })).describe('标签项(label + 各自内容)'),
  }).describe('标签页配置'),
})
/** 16. 手风琴(折叠) */
const accordionSchema = z.object({
  type: z.literal('accordion'), ...baseProps,
  props: z.object({
    items: z.array(z.object({ title: z.string().describe('项标题'), content: z.string().describe('项内容(文本)') })).describe('折叠项列表'),
    expandFirst: z.boolean().optional().describe('默认展开第一项,默认 true'),
  }).describe('手风琴配置'),
})
/** 17. 统计数据 */
const statSchema = z.object({
  type: z.literal('stat'), ...baseProps,
  props: z.object({
    items: z.array(z.object({ number: z.string().describe('数字(允许带单位,如"10万+")'), label: z.string().describe('说明文字') })).describe('统计项'),
  }).describe('统计数据配置'),
})
/** 18. 时间线 */
const timelineSchema = z.object({
  type: z.literal('timeline'), ...baseProps,
  props: z.object({
    items: z.array(z.object({ time: z.string().describe('时间点(如"2026-08-01")'), text: z.string().describe('事件描述') })).describe('时间线项'),
  }).describe('时间线配置'),
})
/** 19. 页脚 */
const footerSchema = z.object({
  type: z.literal('footer'), ...baseProps,
  props: z.object({
    links: z.array(z.object({ label: z.string().describe('链接文字'), link: z.string().optional().describe('链接地址(可选)') })).optional().describe('页脚链接组'),
    copyright: z.string().optional().describe('版权信息(如"© 2026 XX")'),
    contact: z.string().optional().describe('联系方式(可选)'),
  }).describe('页脚配置'),
})
/** 20. 评分 */
const ratingSchema = z.object({
  type: z.literal('rating'), ...baseProps,
  props: z.object({
    score: z.number().min(0).max(5).describe('评分 0-5'),
    count: z.number().optional().describe('评价人数(可选)'),
  }).describe('评分配置'),
})
/** 21. 表单 */
const formSchema = z.object({
  type: z.literal('form'), ...baseProps,
  props: z.object({
    action: z.string().optional().describe('提交动作描述(仅展示)'),
    fields: z.array(z.object({
      name: z.string().describe('字段名'), label: z.string().describe('字段标签'),
      type: z.enum(['text', 'textarea', 'number', 'select', 'checkbox']).describe('字段类型'),
      required: z.boolean().optional().describe('是否必填,默认 false'),
      placeholder: z.string().optional().describe('占位提示(可选)'),
    })).describe('表单字段'),
  }).describe('表单配置'),
})
/** 22. 输入框 */
const inputSchema = z.object({
  type: z.literal('input'), ...baseProps,
  props: z.object({
    label: z.string().describe('标签'),
    placeholder: z.string().optional().describe('占位提示'),
    inputType: z.enum(['text', 'number', 'email', 'password', 'tel']).optional().describe('输入类型,默认 text'),
  }).describe('输入框配置'),
})
/** 23. 下拉选择 */
const selectSchema = z.object({
  type: z.literal('select'), ...baseProps,
  props: z.object({
    label: z.string().describe('标签'),
    options: z.array(z.string()).describe('可选项'),
    value: z.string().optional().describe('当前选中值(可选)'),
  }).describe('下拉选择配置'),
})
/** 24. 步骤条 */
const stepperSchema = z.object({
  type: z.literal('stepper'), ...baseProps,
  props: z.object({
    steps: z.array(z.object({ title: z.string().describe('步骤标题'), description: z.string().optional().describe('步骤描述(可选)') })).describe('步骤列表'),
    current: z.number().int().min(0).optional().describe('当前步骤(从 0,默认 0)'),
  }).describe('步骤条配置'),
})
/** 25. 面包屑 */
const breadcrumbSchema = z.object({
  type: z.literal('breadcrumb'), ...baseProps,
  props: z.object({
    items: z.array(z.object({ label: z.string().describe('项文字'), link: z.string().optional().describe('链接(可选,末项通常无)') })).describe('面包屑项'),
  }).describe('面包屑配置'),
})
/** 26. 视频 */
const videoSchema = z.object({
  type: z.literal('video'), ...baseProps,
  props: z.object({
    src: z.string().describe('视频地址'),
    poster: z.string().optional().describe('封面图(可选)'),
    autoplay: z.boolean().optional().describe('自动播放,默认 false'),
    controls: z.boolean().optional().describe('显示控制条,默认 true'),
  }).describe('视频配置'),
})
/** 27. 公告栏(滚动) */
const noticeBarSchema = z.object({
  type: z.literal('noticeBar'), ...baseProps,
  props: z.object({
    text: z.string().describe('公告文字'),
    scrollable: z.boolean().optional().describe('是否滚动,默认 true'),
  }).describe('公告栏配置'),
})

/** 图标(emoji/符号字符,强调/装饰/列表前缀) */
const iconSchema = z.object({
  type: z.literal('icon'), ...baseProps,
  props: z.object({
    name: z.string().describe('图标字符(emoji 或 unicode 符号,如 🎁 / ★ / ✓)'),
    size: z.number().int().min(8).max(120).optional().describe('字号 px,默认 24'),
    color: z.string().optional().describe('颜色(十六进制,如 #e11d48)'),
  }).describe('图标配置'),
})
/** 标签(胶囊:新品/热销/限量/包邮等商品或活动标记) */
const tagSchema = z.object({
  type: z.literal('tag'), ...baseProps,
  props: z.object({
    text: z.string().describe('标签文字(如「热销」「新品」)'),
    color: z.enum(['red', 'blue', 'green', 'gray', 'orange']).optional().describe('颜色,默认 red'),
    variant: z.enum(['solid', 'outline']).optional().describe('样式:纯色/描边,默认 solid'),
  }).describe('标签配置'),
})
/** 价格(现价 + 原价划线,电商必备) */
const priceSchema = z.object({
  type: z.literal('price'), ...baseProps,
  props: z.object({
    current: z.number().min(0).describe('现价'),
    original: z.number().min(0).optional().describe('原价(划线,需 > current 才显示)'),
    unit: z.string().optional().describe('货币单位,默认 ¥'),
    size: z.enum(['sm', 'md', 'lg']).optional().describe('字号档,默认 md'),
    decimals: z.number().int().min(0).max(4).optional().describe('小数位数,默认 2'),
  }).describe('价格配置'),
})

/** 组件联合(by type 区分,含容器,递归)。z.lazy 递归需显式标注类型避免 TS 循环推断 */
export const componentSchema: z.ZodType<PageComponent> = z.lazy(() => z.discriminatedUnion('type', [
  headingSchema, richTextSchema, productGridSchema, imageSchema,
  buttonSchema, listSchema, cardSchema, spacerSchema, dividerSchema, carouselSchema,
  containerSchema, sectionSchema, gridSchema,
  navbarSchema, bannerSchema, countdownSchema, couponSchema, tabsSchema, accordionSchema,
  statSchema, timelineSchema, footerSchema, ratingSchema, formSchema, inputSchema,
  selectSchema, stepperSchema, breadcrumbSchema, videoSchema, noticeBarSchema,
  iconSchema, tagSchema, priceSchema,
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
  | z.infer<typeof navbarSchema> | z.infer<typeof bannerSchema> | z.infer<typeof countdownSchema>
  | z.infer<typeof couponSchema> | { type: 'tabs'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string; props: { tabs: { label: string; children: PageComponent[] }[] } } | z.infer<typeof accordionSchema>
  | z.infer<typeof statSchema> | z.infer<typeof timelineSchema> | z.infer<typeof footerSchema>
  | z.infer<typeof ratingSchema> | z.infer<typeof formSchema> | z.infer<typeof inputSchema>
  | z.infer<typeof selectSchema> | z.infer<typeof stepperSchema> | z.infer<typeof breadcrumbSchema>
  | z.infer<typeof videoSchema> | z.infer<typeof noticeBarSchema>
  | z.infer<typeof iconSchema> | z.infer<typeof tagSchema> | z.infer<typeof priceSchema>

/** 整页 schema */
export const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z.array(componentSchema).describe('组件数组(按顺序拼装页面)'),
})

export type PageData = z.infer<typeof pageSchema>

/** 初始示例页面:真实电商导购专题页(~70 组件实例,多层嵌套,覆盖全部 30 类型) */
export const initialPage: PageData = {
  title: '🔥 数码狂欢节 · 年中盛典',
  components: [
    { type: 'navbar', props: { logo: 'https://picsum.photos/seed/logo/120/40', title: '数码专区', menu: [{ label: '首页', link: '#' }, { label: '手机', link: '#' }, { label: '电脑', link: '#' }, { label: '家电', link: '#' }, { label: '配件', link: '#' }] } },
    { type: 'noticeBar', props: { text: '🎉 年中盛典 6.18-6.20,全场低至 5 折,满 3000 减 300,会员再享折上折!' } },
    { type: 'breadcrumb', props: { items: [{ label: '首页', link: '#' }, { label: '数码', link: '#' }, { label: '狂欢节' }] } },
    { type: 'banner', props: { image: 'https://picsum.photos/seed/banner/1200/200', link: '#', text: '年中盛典 低至 5 折' } },
    { type: 'carousel', props: { autoplay: true, interval: 4000, slides: [
      { image: 'https://picsum.photos/seed/s1/1200/400', caption: '手机专场 满 2000 减 200' },
      { image: 'https://picsum.photos/seed/s2/1200/400', caption: '笔记本 直降 1000' },
      { image: 'https://picsum.photos/seed/s3/1200/400', caption: '智能穿戴 8 折起' },
    ] } },
    { type: 'countdown', props: { targetTime: '2026-08-20 23:59:59' } },
    { type: 'section', props: { title: '💰 领券中心', children: [
      { type: 'grid', props: { columns: 4, gap: 12, children: [
        { type: 'coupon', props: { amount: 50, threshold: 300, label: '新人券', status: 'available' } },
        { type: 'coupon', props: { amount: 100, threshold: 1000, label: '数码专享', status: 'available' } },
        { type: 'coupon', props: { amount: 200, threshold: 2000, label: '大额满减', status: 'claimed' } },
        { type: 'coupon', props: { amount: 30, label: '无门槛', status: 'available' } },
      ] } },
    ] } },
    { type: 'section', props: { title: '🏆 精选好物', children: [
      { type: 'productGrid', props: { columns: 4, gap: 16, products: [
        { id: 'p1', title: '旗舰手机 Pro', price: 4999, image: 'https://picsum.photos/seed/p1/300/300', tag: '热销' },
        { id: 'p2', title: '轻薄笔记本', price: 6999, image: 'https://picsum.photos/seed/p2/300/300', tag: '新品' },
        { id: 'p3', title: '无线降噪耳机', price: 899, image: 'https://picsum.photos/seed/p3/300/300' },
        { id: 'p4', title: '4K 显示器', price: 1899, image: 'https://picsum.photos/seed/p4/300/300', tag: '促销' },
        { id: 'p5', title: '机械键盘', price: 459, image: 'https://picsum.photos/seed/p5/300/300' },
        { id: 'p6', title: '游戏鼠标', price: 199, image: 'https://picsum.photos/seed/p6/300/300', tag: '热销' },
        { id: 'p7', title: '智能手表', price: 1299, image: 'https://picsum.photos/seed/p7/300/300' },
        { id: 'p8', title: '蓝牙音箱', price: 299, image: 'https://picsum.photos/seed/p8/300/300', tag: '促销' },
      ] } },
    ] } },
    { type: 'tabs', props: { tabs: [
      { label: '手机', children: [{ type: 'productGrid', props: { columns: 3, products: [
        { id: 'm1', title: '手机 A', price: 2999, image: 'https://picsum.photos/seed/m1/300/300' },
        { id: 'm2', title: '手机 B', price: 3999, image: 'https://picsum.photos/seed/m2/300/300' },
        { id: 'm3', title: '手机 C', price: 4999, image: 'https://picsum.photos/seed/m3/300/300' },
      ] } }] },
      { label: '电脑', children: [{ type: 'productGrid', props: { columns: 3, products: [
        { id: 'c1', title: '笔记本 X', price: 5999, image: 'https://picsum.photos/seed/c1/300/300' },
        { id: 'c2', title: '台式机 Y', price: 3999, image: 'https://picsum.photos/seed/c2/300/300' },
        { id: 'c3', title: '平板 Z', price: 2999, image: 'https://picsum.photos/seed/c3/300/300' },
      ] } }] },
      { label: '配件', children: [{ type: 'productGrid', props: { columns: 3, products: [
        { id: 'a1', title: '充电器', price: 99, image: 'https://picsum.photos/seed/a1/300/300' },
        { id: 'a2', title: '数据线', price: 39, image: 'https://picsum.photos/seed/a2/300/300' },
        { id: 'a3', title: '手机壳', price: 29, image: 'https://picsum.photos/seed/a3/300/300' },
      ] } }] },
    ] } },
    { type: 'section', props: { title: '✨ 新品首发', children: [
      { type: 'grid', props: { columns: 3, gap: 12, children: [
        { type: 'card', props: { title: '折叠屏旗舰', text: '全新折叠屏,轻薄如镜。首发价 9999 元。', image: 'https://picsum.photos/seed/n1/400/200', link: '#' } },
        { type: 'card', props: { title: 'AI 眼镜', text: '智能 AR 眼镜,沉浸体验。', image: 'https://picsum.photos/seed/n2/400/200', link: '#' } },
        { type: 'card', props: { title: '智能耳机', text: 'AI 降噪,实时翻译。', image: 'https://picsum.photos/seed/n3/400/200', link: '#' } },
      ] } },
    ] } },
    { type: 'stat', props: { items: [
      { number: '10万+', label: '参与用户' },
      { number: '5000万', label: '成交额' },
      { number: '3000+', label: '精选商品' },
      { number: '4.9分', label: '用户评分' },
    ] } },
    { type: 'rating', props: { score: 4.9, count: 98642 } },
    { type: 'timeline', props: { items: [
      { time: '6.18 00:00', text: '活动开启,限量 5 折抢购' },
      { time: '6.18 10:00', text: '品牌日开启,额外满减' },
      { time: '6.19 20:00', text: '会员专享,折上折' },
      { time: '6.20 23:59', text: '活动结束' },
    ] } },
    { type: 'section', props: { title: '🎯 会员权益', children: [
      { type: 'grid', props: { columns: 4, gap: 12, children: [
        { type: 'card', props: { title: '极速发货', text: '24 小时顺丰直达' } },
        { type: 'card', props: { title: '七天无忧', text: '无理由退换' } },
        { type: 'card', props: { title: '正品保障', text: '假一赔十' } },
        { type: 'card', props: { title: '专属客服', text: '7×24 在线' } },
      ] } },
    ] } },
    { type: 'stepper', props: { current: 1, steps: [
      { title: '选商品', description: '挑选心仪数码' },
      { title: '领券', description: '领取优惠券' },
      { title: '下单', description: '享受满减' },
      { title: '收货', description: '极速送达' },
    ] } },
    { type: 'section', props: { title: '❓ 常见问题', children: [
      { type: 'accordion', props: { expandFirst: true, items: [
        { title: '优惠券怎么领?', content: '在领券中心点击「立即领取」,自动存入账户,下单自动抵扣。' },
        { title: '支持哪些支付方式?', content: '支持微信、支付宝、银行卡、花呗、白条等主流支付方式。' },
        { title: '发货多久到?', content: '现货商品 24 小时内发货,顺丰直达,一般 1-3 天到货。' },
        { title: '退换货政策?', content: '支持七天无理由退换,质量问题包运费。' },
        { title: '会员有什么权益?', content: '会员享专属折扣、优先客服、生日礼包、积分翻倍等。' },
      ] } },
    ] } },
    { type: 'video', props: { src: 'https://example.com/promo.mp4', poster: 'https://picsum.photos/seed/poster/1200/400', controls: true } },
    { type: 'divider', props: { label: '活动说明' } },
    { type: 'richText', props: { html: '<p>本次活动最终解释权归本店所有。更多详情见 <a href="#">活动规则</a>。</p>' } },
    { type: 'section', props: { title: '📬 订阅与反馈', children: [
      { type: 'input', props: { label: '邮箱订阅', placeholder: '输入邮箱接收优惠', inputType: 'email' } },
      { type: 'select', props: { label: '兴趣分类', options: ['手机', '电脑', '家电', '配件'], value: '手机' } },
      { type: 'form', props: { action: '提交订阅', fields: [
        { name: 'name', label: '昵称', type: 'text', required: true, placeholder: '您的称呼' },
        { name: 'phone', label: '手机号', type: 'text', required: true, placeholder: '11 位手机号' },
        { name: 'interest', label: '感兴趣品类', type: 'select' },
        { name: 'remark', label: '备注', type: 'textarea', placeholder: '想对我们说的' },
      ] } },
    ] } },
    { type: 'footer', props: { links: [{ label: '关于我们', link: '#' }, { label: '联系客服', link: '#' }, { label: '退换货', link: '#' }, { label: '隐私政策', link: '#' }], contact: '客服热线:400-xxx-xxxx', copyright: '© 2026 数码专区' } },
  ],
}

/** complex-builder skill 全文 */
export const complexBuilderSkillContent = `# 复杂页面构建 Skill(window.page)

左侧页面由 \`window.page\` 驱动,结构:{ title, components[] }。components 是按顺序拼装的组件数组。

## 组件结构
每个组件:{ type, id?, style?, visible?, className?, props: {...} }
- 通用配置(根):id(唯一标识)、style(自定义样式对象)、visible(显隐)、className(附加 class)
- 业务配置(props 子对象):各组件特有字段

## 组件类型(按 type 区分,业务字段在 props 内)
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
- tabs:props={ tabs[{label, children[]}] } 标签页(每标签下嵌套任意子组件)

业务组件(电商导购专题,v2 扩展):
- navbar:props={ logo, title?, menu[{label,link?}] } 导航栏
- banner:props={ image, link?, text? } 横幅(静态图,区别于 carousel)
- countdown:props={ targetTime, labels? } 倒计时
- coupon:props={ amount, threshold?, label?, status? } 优惠券(状态 available/claimed/used/expired)
- accordion:props={ items[{title,content}], expandFirst? } 手风琴
- stat:props={ items[{number,label}] } 统计数据
- timeline:props={ items[{time,text}] } 时间线
- footer:props={ links?, copyright?, contact? } 页脚
- rating:props={ score(0-5), count? } 评分
- form:props={ action?, fields[{name,label,type,required?,placeholder?}] } 表单
- input:props={ label, placeholder?, inputType? } 输入框
- select:props={ label, options, value? } 下拉选择
- stepper:props={ steps[{title,description?}], current? } 步骤条
- breadcrumb:props={ items[{label,link?}] } 面包屑
- video:props={ src, poster?, autoplay?, controls? } 视频
- noticeBar:props={ text, scrollable? } 公告栏

children 是组件数组,可任意嵌套(支持多层),用 jsonPath 增量操作(如 props.children.0.props.text)。

## 修改要点
- 增删组件:改 components 数组(append/splice);容器内改 props.children
- 改单个组件优先用增量 patch(只发改动字段),避免整体重传大数组
- 调样式用根级 style 对象(如 { color: "red" }),不要写 CSS 字符串
- 改业务字段用 props 子对象(如 write({ path, value, patch:{ op:'set', jsonPath:'props.text' } }))
- 校验失败会返回具体错误,按提示修正 type/字段后重试
- **id 无需手动传**:append 新组件时若不传 id,集成方拦截器会自动补充 \`cmp-<时间戳>-<序号>\`,你只需关注 type/props/style
`
