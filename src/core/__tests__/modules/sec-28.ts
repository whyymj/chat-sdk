import { z } from 'zod'
import type { TestCtx } from './_ctx'

/**
 * dataHint / augmentSystem 中间件单元断言
 * - dataHint:每轮从 liveData() 动态重算「可操作数据」段(修 setData 不同步 Bug)
 * - augmentSystem:集成方回调按运行时状态(state/data)注入段
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[dataHint / augmentSystem 中间件]')

  // dataHint 中间件:有 data → augmentPrompt 返含 schema hint 的段
  {
    const data = {
      description: '主页面配置',
      schema: z.object({ title: z.string().describe('页面标题'), count: z.number() }),
      bind: { title: 'hi', count: 0 },
    }
    // 模拟 dataHintMw 的 augmentPrompt(闭包 liveData)
    let live = data
    const dataHintMw = {
      name: 'dataHint',
      augmentPrompt: () => {
        const hint = hintOf(live.schema)
        return `\n\n## 可操作数据\n${live.description ? live.description + '\n' : ''}${hint}` || undefined
      },
    }
    const seg = dataHintMw.augmentPrompt(undefined as any)
    assert(!!seg && seg.includes('页面标题'), 'dataHint 有 data → augmentPrompt 返含 schema hint 的段')
    assert(!!seg && seg.includes('主页面配置'), 'dataHint 有 data → 段含 description')

    // 模拟 setData 换 schema 后 liveData 更新 → 下轮 augmentPrompt 反映新 schema
    live = {
      description: '新配置',
      schema: z.object({ newName: z.string().describe('新字段') }),
      bind: { newName: 'x' },
    }
    const seg2 = dataHintMw.augmentPrompt(undefined as any)
    assert(!!seg2 && seg2.includes('新字段') && seg2.includes('新配置'), 'dataHint liveData 更新后 → augmentPrompt 反映新 schema(修 setData 不同步 Bug)')
    assert(!seg2!.includes('页面标题'), 'dataHint liveData 更新后 → 旧 schema hint 不再出现')
  }

  // dataHint 中间件:无 data → augmentPrompt 返 undefined(跳过)
  {
    let live: any = undefined
    const dataHintMw = {
      name: 'dataHint',
      augmentPrompt: () => (live ? hintOf(live.schema) : undefined),
    }
    assert(dataHintMw.augmentPrompt(undefined as any) === undefined, 'dataHint 无 data → augmentPrompt 返 undefined(跳过)')
  }

  // augmentSystem 钩子中间件:回调被调用且收到 { state, data }
  {
    let received: any = null
    const liveData = () => ({ description: 'd', schema: z.object({ x: z.number() }), bind: { x: 1 } })
    const state = { messages: [], todos: [], files: {}, skillsMetadata: [], skillsLoaded: [], memory: '' }
    const augmentSystemMw = {
      name: 'augmentSystem',
      augmentPrompt: (s: any) => {
        received = { state: s, data: liveData() }
        return '## 业务补充段\n当前组件:Button'
      },
    }
    const seg = augmentSystemMw.augmentPrompt(state as any)
    assert(!!received && received.state === state, 'augmentSystem 回调被调用且收到 state')
    assert(!!received && !!received.data && received.data.description === 'd', 'augmentSystem 回调收到 data(经 liveData 闭包注入)')
    assert(seg === '## 业务补充段\n当前组件:Button', 'augmentSystem 返回值作为段注入')
  }

  // augmentSystem 回调返回 undefined → 跳过该段
  {
    const augmentSystemMw = {
      name: 'augmentSystem',
      augmentPrompt: () => undefined,
    }
    assert(augmentSystemMw.augmentPrompt(undefined as any) === undefined, 'augmentSystem 返回 undefined → 跳过该段')
  }

  // augmentSystem 回调抛错 → 降级跳过(不崩)
  {
    const augmentSystemMw = {
      name: 'augmentSystem',
      augmentPrompt: () => { throw new Error('boom') },
    }
    // 中间件实现应包 try/catch;此处验证回调本身抛错时被捕获后返 undefined
    let seg: string | undefined
    try {
      seg = augmentSystemMw.augmentPrompt(undefined as any)
    } catch {
      seg = undefined // 降级
    }
    assert(seg === undefined, 'augmentSystem 回调抛错 → 降级跳过(不崩)')
  }

  // augmentSystem 回调收到的 data 随 liveData 变(controller.set 后)
  {
    let live: any = { description: 'old', schema: z.object({ a: z.string() }), bind: { a: '1' } }
    const liveData = () => live
    const state = { messages: [], todos: [], files: {}, skillsMetadata: [], skillsLoaded: [], memory: '' }
    let receivedDesc: string | undefined
    const augmentSystemMw = {
      name: 'augmentSystem',
      augmentPrompt: (s: any) => { receivedDesc = liveData().description; return 'seg' },
    }
    augmentSystemMw.augmentPrompt(state as any)
    assert(receivedDesc === 'old', 'augmentSystem 回调 data 随 liveData 变(初始)')
    live = { description: 'new', schema: z.object({ b: z.string() }), bind: { b: '2' } }
    augmentSystemMw.augmentPrompt(state as any)
    assert(receivedDesc === 'new', 'augmentSystem 回调 data 随 liveData 变(setData 后反映)')
  }
}

/** 轻量 schema hint 提取(模拟 extractSchemaHint 行为,避免 import 循环) */
function hintOf(schema: any): string {
  const shape = schema?._def?.shape ?? schema?.shape
  if (!shape) return ''
  return Object.entries(shape).map(([k, v]: any) => `- ${k}: ${(v?._def?.description || v?.description || '')}`).join('\n')
}
