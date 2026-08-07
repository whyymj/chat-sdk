/**
 * Mission 中间件 —— 会话级任务目标锚定(revive-mission-anchor Phase 1)
 *
 * Phase 1 最小版:
 *  - capture:首条「任务型」user 启发式(非空/非问候/含任务动词,**不调 LLM**);或 setMission 显式覆盖
 *  - augmentPrompt 每轮注入「## 当前主线目标」pin 段(goal + 完成标准)
 *  - setMission/getMission API 供集成方显式注入/监控
 *
 * **压缩豁免(天然)**:mission 经 augmentPrompt 每轮重建到 system prompt(不在 AgentMessage[]),
 * compressInput 压的是 messages,故 mission 不随 older 轮次丢 —— **无需改 summarization**。
 * 原始任务目标即使多轮压缩后,LLM 仍每轮看到完整 mission pin 段。
 */
import type { Middleware } from './middleware'
import type { Mission } from './state'

/** capture 启发式用的任务动词(覆盖改/建/查/设计/编排等;保守,宁漏不误) */
const CAPTURE_VERBS = /(?:改|加|删|生成|查询|分析|创建|修改|配置|实现|检查|对比|整理|转换|设计|搭建|编排|布局|调整|更新)/

/** 判断 user 文本是否「任务型」(应 capture);保守:太短/问候/超长/无任务动词 → 不 capture */
function shouldCapture(text: string): boolean {
  if (!text || text.trim().length < 8) return false
  if (/^(你好|hi|hello|ok|好的|继续|嗯|谢谢|hey|哈喽|收到|明白)/i.test(text.trim())) return false
  if (text.length > 2000) return false // 超长疑似粘贴文档
  return CAPTURE_VERBS.test(text)
}

/** 从 messages 找首条任务型 user,capture 为 mission(不调 LLM,纯规则) */
function captureFromMessages(messages: { role: string; content: string }[]): Mission | undefined {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue
    const text = messages[i].content
    if (shouldCapture(text)) {
      return {
        goal: text.length > 200 ? text.slice(0, 200) + '…' : text,
        sourceMessageIdx: i,
        capturedAt: Date.now(),
        explicit: false,
      }
    }
  }
  return undefined
}

export function createMissionMiddleware(): Middleware & {
  setMission: (m: Partial<Mission>) => void
  getMission: () => Mission | undefined
  /** 重置为初始态(切会话/清空聊天):清 mission + 撤销清空标记,新会话可正常自动 capture */
  reset: () => void
} {
  let mission: Mission | undefined
  // setMission({}) 显式清空 → beforeAgent 不再自动重捕(P1-6);reset() 切会话归零(新会话可正常 capture)
  let explicitlyCleared = false

  const mw: Middleware & {
    setMission: (m: Partial<Mission>) => void
    getMission: () => Mission | undefined
  } = {
    name: 'mission',
    beforeAgent: (state) => {
      // 仅在「未捕获且未被显式清空」时自动 capture 首条任务型 user
      // (setMission({}) 收尾解除锚定后,不再从历史重捕过期目标;reset 切会话归零,新会话可正常 capture)
      if (!mission && !explicitlyCleared) {
        mission = captureFromMessages(state.messages)
      }
      return mission ? { mission } : {}
    },
    augmentPrompt: () => {
      if (!mission) return undefined
      const lines = ['## 当前主线目标', mission.goal]
      if (mission.acceptanceCriteria?.length) {
        lines.push('完成标准:')
        mission.acceptanceCriteria.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
      }
      lines.push('(每步操作应服务此目标;偏离时回到主线)')
      return lines.join('\n')
    },
    /** 显式设置/覆盖 mission;传 {} 清空(回到无锚点,且同会话内不再自动重捕历史任务消息 P1-6) */
    setMission: (m: Partial<Mission>) => {
      if (Object.keys(m).length === 0) {
        mission = undefined
        explicitlyCleared = true // 显式清空:同会话内 beforeAgent 不再从历史重捕(防过期目标重锚)
        return
      }
      explicitlyCleared = false // 显式设新目标:撤销清空标记
      mission = {
        goal: m.goal ?? mission?.goal ?? '',
        acceptanceCriteria: m.acceptanceCriteria ?? mission?.acceptanceCriteria,
        sourceMessageIdx: m.sourceMessageIdx ?? mission?.sourceMessageIdx ?? -1,
        capturedAt: m.capturedAt ?? mission?.capturedAt ?? Date.now(),
        explicit: m.explicit ?? true, // setMission 默认显式(true);不继承旧 capture 的 false
      }
    },
    getMission: () => mission,
    /** 重置为初始态(切会话/清空聊天调用):清 mission + 撤销清空标记,新会话首条任务型 user 可正常自动 capture */
    reset: () => {
      mission = undefined
      explicitlyCleared = false
    },
  }
  return mw
}
