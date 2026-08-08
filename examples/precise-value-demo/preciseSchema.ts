import { z } from 'zod'

/**
 * 精确值保护 demo schema —— 含需精确保存的字段:
 *  - id:唯一标识(freeze 只读,精确值不入 LLM 消息流)
 *  - token:访问令牌(verbatim 原样保留,防压缩丢字/防幻觉改错)
 *  - title:普通字段(AI 可自由改)
 *  - items[0].hash:内容签名(verbatim)
 */
export const preciseSchema = z.object({
  id: z.string().describe('唯一标识(freeze 保护,只读不可改)'),
  token: z.string().describe('访问令牌(verbatim 保护,改值须经 resource_update)'),
  title: z.string().describe('标题(普通字段,可自由改)'),
  items: z.array(z.object({
    name: z.string().describe('条目名(普通字段)'),
    hash: z.string().describe('内容签名(verbatim 保护)'),
  })),
})

/** 受保护资源配置 */
export const resourcesConfig = [
  { path: 'id', mode: 'freeze' as const },
  { path: 'token', mode: 'verbatim' as const },
  { path: 'items.0.hash', mode: 'verbatim' as const },
]

/** 初始数据(精确值:id / 长 token / hash 签名) */
export const initialData = {
  id: 'usr_Ax7b9QzP_2024_fixed',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  title: '用户配置',
  items: [{ name: 'profile', hash: 'a1b2c3d4e5f6_signature_hash_v1' }],
}
