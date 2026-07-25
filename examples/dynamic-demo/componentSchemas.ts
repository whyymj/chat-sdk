import { z } from '../../src/core'

/**
 * 动态注册示例的组件类型与各自 schema —— 演示「懒加载、结构各异」的组件如何经 sdk.addDataSlot 动态注册。
 *
 * 每种组件结构不同:banner(标题+配色)/ card(标题+价格+标签)/ stat(指标+单位)/ chart(图表类型+数据数组)。
 * 组件挂载时调 sdk.addDataSlot({ path: `app.components.${id}`, schema });卸载时 sdk.removeDataSlot。
 * Agent 即可按各自 schema 操作这些动态注册的 path,无需在 createChatSdk 时预声明全部组件。
 */

export interface BannerComp { id: string; type: 'banner'; title: string; bg: string; color: string }
export interface CardComp { id: string; type: 'card'; title: string; price: number; tag?: string }
export interface StatComp { id: string; type: 'stat'; label: string; value: number; unit?: string }
export interface ChartComp { id: string; type: 'chart'; chartType: 'bar' | 'line' | 'pie'; data: number[] }

export type CompType = 'banner' | 'card' | 'stat' | 'chart'
export type AnyComp = BannerComp | CardComp | StatComp | ChartComp

/** 各组件类型的 schema(动态注册时用) */
export const compSchemas: Record<CompType, z.ZodType> = {
  banner: z.object({
    id: z.string(),
    type: z.literal('banner'),
    title: z.string(),
    bg: z.string(),
    color: z.string(),
  }),
  card: z.object({
    id: z.string(),
    type: z.literal('card'),
    title: z.string(),
    price: z.number().nonnegative(),
    tag: z.string().optional(),
  }),
  stat: z.object({
    id: z.string(),
    type: z.literal('stat'),
    label: z.string(),
    value: z.number(),
    unit: z.string().optional(),
  }),
  chart: z.object({
    id: z.string(),
    type: z.literal('chart'),
    chartType: z.enum(['bar', 'line', 'pie']),
    data: z.array(z.number()),
  }),
}

/** 各组件类型的默认值(挂载时初始化) */
export function createComp(type: CompType, id: string): AnyComp {
  switch (type) {
    case 'banner': return { id, type: 'banner', title: '新 Banner', bg: '#1f4d3a', color: '#ffffff' }
    case 'card':   return { id, type: 'card', title: '新商品', price: 99, tag: '新品' }
    case 'stat':   return { id, type: 'stat', label: '指标', value: 0, unit: '%' }
    case 'chart':  return { id, type: 'chart', chartType: 'bar', data: [10, 25, 18, 32] }
  }
}

export const compTypeLabels: Record<CompType, string> = {
  banner: '🖼 Banner 横幅',
  card: '🃏 Card 商品卡',
  stat: '📊 Stat 指标',
  chart: '📈 Chart 图表',
}

/** 各组件类型的详细 description(给 LLM 看的字段说明书;动态注册时拼入 path) */
export const compTypeDescriptions: Record<CompType, string> = {
  banner: 'Banner 横幅组件:{title:string 标题文案, bg:string 背景色十六进制如#1f4d3a, color:string 文字色如#ffffff}',
  card: 'Card 商品卡组件:{title:string 商品名, price:number 非负价格, tag?:string 可选标签如"新品"/"秒杀"}',
  stat: 'Stat 指标组件:{label:string 指标名, value:number 数值, unit?:string 可选单位如"%"/"个"}',
  chart: 'Chart 图表组件:{chartType:"bar"|"line"|"pie" 图表类型, data:number[] 数据数组(按顺序对应各类目)}',
}
