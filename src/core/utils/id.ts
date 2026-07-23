/**
 * 生成唯一 id —— crypto.randomUUID 优先,降级时间+随机(无 crypto 环境如旧浏览器/测试)
 */
export function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fallthrough */
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
