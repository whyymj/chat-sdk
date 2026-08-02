/**
 * sec-36:宿主动作 actions + DOM 读取纯函数 domToStructure(胜任自动化 agent)
 * - actionsToTools:每个 action 一个命名 tool / 非法名跳过 / invoke 调 run / 异常隔离 / undefined 默认文案
 * - actionsToInspectInfo:元信息(description + hasParams)
 * - domToStructure:tag/attrs 默认白名单 + data-* / text / depth 截断 childCount / 严格白名单 / includeText=false / null
 */
import { z } from 'zod'
import { actionsToTools, actionsToInspectInfo } from '../../sdk/actions'
import { domToStructure } from '../../tools/domTool'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  // ===== actions 宿主动作 =====
  // ✓ actionsToTools → 每个 action 生成一个命名 tool
  const tools = actionsToTools({
    save_draft: { description: '保存草稿', run: () => 'saved' },
    publish: { description: '发布', run: () => 'published' },
  })
  assert(tools.length === 2, '✓ actionsToTools → 每个 action 一个 tool(2 个)')
  assert(tools[0].name === 'save_draft', '✓ actionsToTools → tool 名 = action 名(save_draft)')
  assert(tools[1].name === 'publish', '✓ actionsToTools → tool 名 = action 名(publish)')
  assert(typeof tools[0].description === 'string' && tools[0].description.includes('保存'), '✓ actionsToTools → description 透传')

  // ✓ actionsToTools → 非法名(连字符 / 数字开头)跳过,合法的保留
  const tools2 = actionsToTools({
    'bad-name': { description: '非法', run: () => 'x' },
    good_name: { description: '合法', run: () => 'y' },
    '1leading': { description: '非法', run: () => 'z' },
  })
  assert(tools2.length === 1 && tools2[0].name === 'good_name', '✓ actionsToTools → 非法名跳过(连字符/数字开头),仅留 good_name')

  // ✓ action tool invoke → 调 run 返回结果
  const okTool = actionsToTools({ ok: { description: 'ok', run: () => '成功结果' } })[0]
  const okResult = await invoke(okTool, {})
  assert(okResult === '成功结果', '✓ action tool invoke → 调 run 返回结果')

  // ✓ action tool run 抛错 → 错误字符串回灌(异常隔离,不崩 agent)
  const errTool = actionsToTools({ boom: { description: 'boom', run: () => { throw new Error('炸了') } } })[0]
  const errResult = await invoke(errTool, {})
  assert(errResult.includes('执行失败') && errResult.includes('炸了'), '✓ action tool run 抛错 → 错误字符串回灌(异常隔离)')

  // ✓ action tool run 返 undefined → 默认完成文案
  const voidTool = actionsToTools({ noop: { description: 'noop', run: () => undefined } })[0]
  const voidResult = await invoke(voidTool, {})
  assert(voidResult.includes('执行完成'), '✓ action tool run 返 undefined → 默认完成文案')

  // ✓ actionsToInspectInfo → 元信息(description + hasParams)
  const info = actionsToInspectInfo({
    save: { description: '保存', run: () => '' },
    query: { description: '查询', run: () => '', params: z.object({ id: z.string() }) },
  })
  assert(info.save.hasParams === false, '✓ actionsToInspectInfo → 无 params → hasParams=false')
  assert(info.query.hasParams === true, '✓ actionsToInspectInfo → 有 params → hasParams=true')
  assert(info.save.description === '保存', '✓ actionsToInspectInfo → description 透传')

  // ===== domToStructure 纯函数(mock DOM 节点 duck-typing) =====
  const mockEl = (tag: string, attrs: Record<string, string> = {}, text = '', children: unknown[] = []): any => ({
    tagName: tag.toUpperCase(),
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    children,
  })

  // ✓ domToStructure → 基本结构(tag 小写 / 默认白名单 attrs / data-* / text / 子节点)
  const node = mockEl('div', { id: 'main', class: 'card', 'data-id': '7' }, '标题', [mockEl('span', {}, '子文本')])
  const s1 = domToStructure(node, { depth: 1 })
  assert(s1?.tag === 'div', '✓ domToStructure → tag 小写(div)')
  assert(s1?.attrs.id === 'main' && s1.attrs.class === 'card', '✓ domToStructure → 默认白名单含 id/class')
  assert(s1?.attrs['data-id'] === '7', '✓ domToStructure → 默认含 data-*')
  assert(s1?.text === '标题', '✓ domToStructure → 直接文本子节点')
  assert(s1?.children?.length === 1 && s1.children[0].tag === 'span', '✓ domToStructure → depth=1 展开 1 层子节点')

  // ✓ domToStructure → depth=0 截断:childCount 不展开 children
  const s2 = domToStructure(node, { depth: 0 })
  assert(s2?.childCount === 1 && !s2.children, '✓ domToStructure → depth=0 截断 childCount=1 不展开')

  // ✓ domToStructure → 严格 attrs 白名单(传了 = 只白名单,不含 data-*)
  const s3 = domToStructure(mockEl('a', { href: '/x', id: 'y', 'data-track': 'z' }, '链'), { depth: 0, attrs: ['href'] })
  assert(s3?.attrs.href === '/x' && s3.attrs.id === undefined && s3.attrs['data-track'] === undefined, '✓ domToStructure → 严格白名单(只 href,排除 id/data-*)')

  // ✓ domToStructure → includeText=false 不返回 text
  const s4 = domToStructure(node, { depth: 0, includeText: false })
  assert(s4?.text === undefined, '✓ domToStructure → includeText=false 不返回 text')

  // ✓ domToStructure → null 输入返回 null
  assert(domToStructure(null, { depth: 3 }) === null, '✓ domToStructure → null 输入返回 null')

  // M5: 默认白名单不含 value(防 <input value>/<textarea> 敏感表单值灌入 LLM 上下文;原 value 在默认白名单与"防敏感属性泄露"定位矛盾)
  const s5 = domToStructure(mockEl('input', { id: 'u', value: '密码明文' }), { depth: 0 })
  assert(s5?.attrs.id === 'u' && s5.attrs.value === undefined, '✓ domToStructure → 默认不含 value(防表单敏感值泄露)')
  // 显式 attrs:['value'] 仍可暴露(集成方按需 opt-in)
  const s6 = domToStructure(mockEl('input', { value: 'x' }), { depth: 0, attrs: ['value'] })
  assert(s6?.attrs.value === 'x', '✓ domToStructure → 显式 attrs:["value"] 可暴露(opt-in)')
}
