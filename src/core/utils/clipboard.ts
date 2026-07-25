/**
 * 复制文本到剪贴板 —— 兼容非 secure context(HTTP / 非 localhost)与旧浏览器。
 *
 * navigator.clipboard.writeText 仅在 secure context(https / localhost)可用,HTTP 站点下
 * navigator.clipboard 为 undefined 或 writeText reject。降级 document.execCommand('copy')
 * (已废弃但仍广泛可用),失败返回 false(调用方据此决定是否显示成功提示,避免误导)。
 */
export async function copyText(text: string): Promise<boolean> {
  // 优先:Clipboard API(secure context)
  try {
    const clip = (globalThis as any).navigator?.clipboard
    if (clip && typeof clip.writeText === 'function') {
      await clip.writeText(text)
      return true
    }
  } catch {
    // 权限拒绝 / 非 secure context → 降级
  }
  // 降级:execCommand(旧浏览器 / HTTP)
  try {
    const doc = globalThis.document
    if (!doc || !doc.body) return false
    const ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    doc.body.appendChild(ta)
    ta.select()
    const ok = doc.execCommand('copy')
    doc.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
