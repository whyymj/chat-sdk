/**
 * sec-35:mission 任务目标锚定(revive-mission-anchor Phase 1)
 *  - capture 启发式(任务型/保守:问候/超短/超长/无动词/首条非任务跳过)
 *  - setMission 显式覆盖/合并/清空/explicit 标记
 *  - getMission + augmentPrompt pin 段注入
 */
import { createMissionMiddleware } from '../../harness/mission'
import { createInitialState as createState } from '../../harness/state'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[sec-35] mission 任务目标锚定(revive-mission-anchor Phase 1)')

  const mkState = (msgs: { role: string; content: string }[]) => ({ ...createState(), messages: msgs as any })

  // === capture 启发式 ===
  {
    const mw = createMissionMiddleware()
    const upd: any = mw.beforeAgent!(mkState([{ role: 'user', content: '把标题改成红色并加个按钮' }]) as any)
    assert(upd.mission?.explicit === false, '✓ capture 首条任务型 user → mission.explicit=false(自动)')
    assert(/把标题改成红色/.test(upd.mission?.goal), '✓ capture goal = user 原文')

    // augmentPrompt 注入 pin 段(闭包 mission,不读 state)
    const prompt = mw.augmentPrompt!(createState())
    assert(/当前主线目标/.test(prompt!), '✓ augmentPrompt 注入「## 当前主线目标」pin 段')
    assert(/把标题改成红色/.test(prompt!), '✓ pin 段含 goal')
  }

  // 保守:不该 capture 的
  {
    const cases: [string, any][] = [
      ['问候太短', [{ role: 'user', content: '你好' }]],
      ['超短确认', [{ role: 'user', content: '好的' }]],
      ['超长粘贴', [{ role: 'user', content: 'x'.repeat(2500) }]],
      ['无任务动词', [{ role: 'user', content: '今天天气真不错啊朋友们' }]],
    ]
    for (const [label, msgs] of cases) {
      const mw = createMissionMiddleware()
      const upd: any = mw.beforeAgent!(mkState(msgs) as any)
      assert(upd.mission === undefined, `✓ 保守:${label} → 不 capture`)
    }
  }

  // 超长 goal 截断(capture >200 字 user → goal 取首 200 + …,防 mission pin 段过大)
  {
    const mw = createMissionMiddleware()
    const longText = '帮我' + '设计一个活动页面'.repeat(30) // >200 字
    const upd: any = mw.beforeAgent!(mkState([{ role: 'user', content: longText }]) as any)
    assert(upd.mission?.goal.length <= 201 && /…$/.test(upd.mission?.goal), '✓ 超长 goal(>200 字)→ 截断首 200 + …(防 mission pin 段过大)')
    assert(upd.mission?.sourceMessageIdx === 0, '✓ capture 记 sourceMessageIdx(0)')
  }

  // 首条非任务、二条任务 → capture 二条(跳过非任务)
  {
    const mw = createMissionMiddleware()
    const upd: any = mw.beforeAgent!(mkState([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好!' },
      { role: 'user', content: '帮我搭建一个活动页' },
    ]) as any)
    assert(/帮我搭建一个活动页/.test(upd.mission?.goal), '✓ 首条非任务、二条任务 → capture 二条(跳过非任务)')
  }

  // === setMission 显式覆盖 / 合并 / 清空 ===
  {
    const mw = createMissionMiddleware()
    mw.setMission({ goal: '集成方显式目标' })
    const m1 = mw.getMission()
    assert(m1?.goal === '集成方显式目标' && m1?.explicit === true, '✓ setMission({goal}) → explicit=true(显式)')

    mw.setMission({ acceptanceCriteria: ['标准1', '标准2'] })
    const m2 = mw.getMission()
    assert(m2?.goal === '集成方显式目标' && m2?.acceptanceCriteria?.length === 2, '✓ setMission 合并(保留 goal,加 criteria)')

    // augmentPrompt 含完成标准
    const prompt = mw.augmentPrompt!(createState())
    assert(/完成标准/.test(prompt!) && /标准1/.test(prompt!), '✓ pin 段含「完成标准」+ criteria')

    // 清空
    mw.setMission({})
    assert(mw.getMission() === undefined, '✓ setMission({}) → 清空 mission')

    // capture 后 setMission 覆盖
    const mw2 = createMissionMiddleware()
    mw2.beforeAgent!(mkState([{ role: 'user', content: '帮我改下首页的标题颜色' }]) as any)
    assert(mw2.getMission()?.explicit === false, '✓ 先 capture(explicit=false)')
    mw2.setMission({ goal: '覆盖目标' })
    assert(mw2.getMission()?.goal === '覆盖目标' && mw2.getMission()?.explicit === true, '✓ setMission 覆盖 capture → explicit=true')
  }

  // === getMission 初始 / 无 user 不 capture ===
  {
    const mw = createMissionMiddleware()
    assert(mw.getMission() === undefined, '✓ 初始 getMission → undefined')
    const upd: any = mw.beforeAgent!(mkState([]) as any)
    assert(upd.mission === undefined && mw.getMission() === undefined, '✓ 无 user 消息 → 不 capture,getMission undefined')
  }
}
