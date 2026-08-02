// window 大 JSON 查询/搜索/脚本沙箱 —— 纯函数实现(便于自测)

// ============ JSONPath 简化求值器(只读,安全,无 eval) ============
// 支持子集:$ 根、.key、[n]、['key']、[*] 通配、[?(filter)] 过滤、..key 递归、..* 全后代
// 过滤表达式:@.field(嵌套) op literal,&& || (),无 eval 自实现求值

export interface JpNode {
  path: string
  value: unknown
  index?: number
}

interface JpToken {
  type: 'key' | 'index' | 'wildcard' | 'filter' | 'descendKey' | 'descendAll'
  key?: string
  index?: number
  filter?: string
}

const JP_IDENT = /[\w$-]/

export function jpTokenize(expr: string): JpToken[] {
  const tokens: JpToken[] = []
  const s = expr.trim()
  let i = s[0] === '$' ? 1 : 0
  while (i < s.length) {
    const c = s[i]
    if (c === '.') {
      if (s[i + 1] === '.') {
        i += 2
        if (s[i] === '*') {
          tokens.push({ type: 'descendAll' })
          i++
          continue
        }
        let key = ''
        while (i < s.length && JP_IDENT.test(s[i])) key += s[i++]
        if (!key) throw new Error('JSONPath: .. 后缺属性名')
        tokens.push({ type: 'descendKey', key })
        continue
      }
      i++
      if (s[i] === '*') {
        tokens.push({ type: 'wildcard' })
        i++
        continue
      }
      let key = ''
      while (i < s.length && JP_IDENT.test(s[i])) key += s[i++]
      if (!key) throw new Error('JSONPath: . 后缺属性名')
      tokens.push({ type: 'key', key })
      continue
    }
    if (c === '[') {
      i++
      const ch = s[i]
      if (ch === '*') {
        tokens.push({ type: 'wildcard' })
        i += 2
        continue
      }
      if (ch === '?' && s[i + 1] === '(') {
        i += 2
        let depth = 1
        let filter = ''
        while (i < s.length && depth > 0) {
          if (s[i] === '(') depth++
          else if (s[i] === ')') {
            depth--
            if (depth === 0) break
          }
          filter += s[i++]
        }
        if (depth !== 0) throw new Error('JSONPath: 过滤表达式括号不匹配')
        i++
        if (s[i] !== ']') throw new Error('JSONPath: 过滤表达式后缺 ]')
        i++
        tokens.push({ type: 'filter', filter })
        continue
      }
      if (ch === "'" || ch === '"') {
        const q = ch
        i++
        let key = ''
        while (i < s.length && s[i] !== q) key += s[i++]
        i++
        if (s[i] !== ']') throw new Error('JSONPath: 字符串索引后缺 ]')
        i++
        tokens.push({ type: 'key', key })
        continue
      }
      let num = ''
      while (i < s.length && /[\d-]/.test(s[i])) num += s[i++]
      if (s[i] !== ']') throw new Error('JSONPath: 索引后缺 ]')
      i++
      tokens.push({ type: 'index', index: parseInt(num, 10) })
      continue
    }
    throw new Error(`JSONPath: 语法错误,意外字符 '${c}' @${i}`)
  }
  return tokens
}

// ============ 过滤表达式求值(@.field op literal, && || () ,无 eval) ============

function jpExprTokens(expr: string): string[] {
  const toks: string[] = []
  let i = 0
  const s = expr.trim()
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n') {
      i++
      continue
    }
    if (c === '@' || c === '.') {
      let t = ''
      while (i < s.length && /[@.\w$-]/.test(s[i])) t += s[i++]
      toks.push(t)
      continue
    }
    if (c === "'" || c === '"') {
      const q = c
      let t = c
      i++
      while (i < s.length && s[i] !== q) t += s[i++]
      t += s[i] || ''
      i++
      toks.push(t)
      continue
    }
    if (/[\d-]/.test(c)) {
      let t = ''
      while (i < s.length && /[\d.eE+-]/.test(s[i])) t += s[i++]
      toks.push(t)
      continue
    }
    const two = s.slice(i, i + 2)
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      toks.push(two)
      i += 2
      continue
    }
    if (c === '<' || c === '>' || c === '(' || c === ')') {
      toks.push(c)
      i++
      continue
    }
    if (/[a-zA-Z_$]/.test(c)) {
      let t = ''
      while (i < s.length && /[\w$]/.test(s[i])) t += s[i++]
      toks.push(t)
      continue
    }
    throw new Error(`过滤表达式:意外字符 '${c}'`)
  }
  return toks
}

class JpExprParser {
  private pos = 0
  constructor(private toks: string[], private item: unknown) {}
  parse(): boolean {
    const v = this.or()
    if (this.pos < this.toks.length) throw new Error('过滤表达式:尾部多余 token')
    return v
  }
  private peek(): string {
    return this.toks[this.pos]
  }
  private next(): string {
    return this.toks[this.pos++]
  }
  private or(): boolean {
    let v = this.and()
    while (this.peek() === '||') {
      this.next()
      v = this.and() || v
    }
    return v
  }
  private and(): boolean {
    let v = this.cmp()
    while (this.peek() === '&&') {
      this.next()
      v = this.cmp() && v
    }
    return v
  }
  private cmp(): boolean {
    if (this.peek() === '(') {
      this.next()
      const v = this.or()
      if (this.peek() !== ')') throw new Error('过滤表达式:缺 )')
      this.next()
      return v
    }
    const left = this.operand()
    const op = this.peek()
    if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
      this.next()
      const right = this.operand()
      return jpCompare(op, left, right)
    }
    return jpTruthy(left)
  }
  private operand(): unknown {
    const t = this.next()
    if (t === undefined) throw new Error('过滤表达式:缺操作数')
    if (t.startsWith('@')) {
      return jpResolveAt(t, this.item)
    }
    if (t[0] === "'" || t[0] === '"') {
      return t.slice(1, -1)
    }
    if (t === 'true') return true
    if (t === 'false') return false
    if (t === 'null') return null
    const n = Number(t)
    if (!Number.isNaN(n)) return n
    throw new Error(`过滤表达式:未知操作数 '${t}'`)
  }
}

function jpTruthy(v: unknown): boolean {
  return !!v && v !== 0 && v !== '' && v !== null
}

function jpResolveAt(t: string, item: unknown): unknown {
  const parts = t.split('.').filter((p) => p && p !== '@')
  let cur: unknown = item
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function jpCompare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case '==':
      return a === b
    case '!=':
      return a !== b
    case '<':
      return (a as number) < (b as number)
    case '<=':
      return (a as number) <= (b as number)
    case '>':
      return (a as number) > (b as number)
    case '>=':
      return (a as number) >= (b as number)
    default:
      return false
  }
}

export function jpFilterEval(expr: string, item: unknown): boolean {
  return new JpExprParser(jpExprTokens(expr), item).parse()
}

// ============ 求值 ============

function jpChild(parentPath: string, key: string | number): string {
  return parentPath ? `${parentPath}.${key}` : String(key)
}

export function jpEval(root: unknown, expr: string): JpNode[] {
  let cur: JpNode[] = [{ path: '', value: root }]
  for (const t of jpTokenize(expr)) {
    const next: JpNode[] = []
    if (t.type === 'key') {
      for (const n of cur) {
        if (n.value != null && typeof n.value === 'object' && t.key! in (n.value as object)) {
          next.push({ path: jpChild(n.path, t.key!), value: (n.value as Record<string, unknown>)[t.key!] })
        }
      }
    } else if (t.type === 'index') {
      for (const n of cur) {
        if (Array.isArray(n.value)) {
          const v = n.value[t.index!]
          if (t.index! >= 0 && t.index! < n.value.length) {
            next.push({ path: jpChild(n.path, t.index!), value: v, index: t.index! })
          }
        }
      }
    } else if (t.type === 'wildcard') {
      for (const n of cur) {
        if (Array.isArray(n.value)) {
          n.value.forEach((v, i) => next.push({ path: jpChild(n.path, i), value: v, index: i }))
        } else if (n.value != null && typeof n.value === 'object') {
          for (const k of Object.keys(n.value)) next.push({ path: jpChild(n.path, k), value: (n.value as Record<string, unknown>)[k] })
        }
      }
    } else if (t.type === 'descendKey') {
      const key = t.key!
      const walk = (n: JpNode) => {
        if (n.value == null || typeof n.value !== 'object') return
        for (const k of Object.keys(n.value as object)) {
          const child: JpNode = { path: jpChild(n.path, k), value: (n.value as Record<string, unknown>)[k] }
          if (k === key) next.push(child)
          walk(child)
        }
      }
      for (const n of cur) walk(n)
    } else if (t.type === 'descendAll') {
      const walk = (n: JpNode) => {
        if (n.value == null || typeof n.value !== 'object') return
        for (const k of Object.keys(n.value as object)) {
          const child: JpNode = { path: jpChild(n.path, k), value: (n.value as Record<string, unknown>)[k] }
          next.push(child)
          walk(child)
        }
      }
      for (const n of cur) walk(n)
    } else if (t.type === 'filter') {
      for (const n of cur) {
        if (Array.isArray(n.value)) {
          n.value.forEach((v, i) => {
            if (jpFilterEval(t.filter!, v)) next.push({ path: jpChild(n.path, i), value: v, index: i })
          })
        } else if (n.value != null && typeof n.value === 'object') {
          for (const k of Object.keys(n.value as object)) {
            const v = (n.value as Record<string, unknown>)[k]
            if (jpFilterEval(t.filter!, v)) next.push({ path: jpChild(n.path, k), value: v })
          }
        }
      }
    }
    cur = next
  }
  return cur
}

// ============ 模糊/子串/正则搜索 ============

export interface SearchHit {
  path: string
  key?: string
  value: string
  score?: number
}

export type SearchMode = 'substring' | 'regex' | 'fuzzy'

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

export function searchJson(
  root: unknown,
  query: string,
  opts: { mode?: SearchMode; fuzzyThreshold?: number; matchKey?: boolean; limit?: number } = {},
): SearchHit[] {
  const mode = opts.mode || 'substring'
  const limit = opts.limit ?? 50
  const matchKey = opts.matchKey !== false
  const hits: SearchHit[] = []
  let regex: RegExp | null = null
  if (mode === 'regex') {
    try {
      regex = new RegExp(query, 'i')
    } catch (e) {
      throw new Error(`正则表达式无效: ${(e as Error).message}`)
    }
  }
  const walk = (val: unknown, path: string, key?: string) => {
    if (hits.length >= limit) return
    if (val == null) return
    if (typeof val === 'object') {
      if (Array.isArray(val)) {
        val.forEach((v, i) => walk(v, jpChild(path, i), String(i)))
      } else {
        for (const k of Object.keys(val)) walk((val as Record<string, unknown>)[k], jpChild(path, k), k)
      }
      return
    }
    const str = String(val)
    const matched = matchLeaf(str, query, mode, opts.fuzzyThreshold ?? 2, regex)
    if (matched) {
      hits.push({ path, key, value: str.length > 200 ? str.slice(0, 200) + '…' : str, score: matched })
      return
    }
    if (matchKey && key) {
      const km = matchLeaf(key, query, mode, opts.fuzzyThreshold ?? 2, regex)
      if (km) hits.push({ path, key, value: str.length > 200 ? str.slice(0, 200) + '…' : str, score: km })
    }
  }
  walk(root, '')
  return hits
}

function matchLeaf(
  text: string,
  query: string,
  mode: SearchMode,
  threshold: number,
  regex: RegExp | null,
): number | null {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  if (mode === 'substring') return lower.includes(q) ? 1 : null
  if (mode === 'regex') return regex && regex.test(text) ? 1 : null
  if (mode === 'fuzzy') {
    if (lower.includes(q)) return 2
    const d = levenshtein(lower, q)
    return d <= threshold ? threshold - d + 1 : null
  }
  return null
}

// ============ Web Worker 沙箱脚本执行 ============
// 把 data 深拷贝(structured clone)传给 Worker,Worker 内跑 LLM 脚本,主线程可超时 terminate。
// Worker 独立全局,无 window/document 访问;禁用 fetch/XHR/importScripts 防网络外泄。
// mode:'query' 返回结果给 LLM(只读);'transform' 返回值经 schema 校验后落地(就地)。

export interface EvalResult {
  ok: boolean
  result?: unknown
  error?: string
  elapsedMs: number
}

const WORKER_PREAMBLE = [
  "self.fetch = () => { throw new Error('fetch 已被沙箱禁用') }",
  "self.XMLHttpRequest = function(){ throw new Error('XMLHttpRequest 已被沙箱禁用') }",
  "self.importScripts = () => { throw new Error('importScripts 已被沙箱禁用') }",
  "self.WebSocket = function(){ throw new Error('WebSocket 已被沙箱禁用') }",
  // 同源数据泄漏:Worker 可读写宿主同源 indexedDB/caches(page-agent-sdk 自身会话数据),禁用
  "try { self.indexedDB = undefined } catch {}",
  "try { self.caches = undefined } catch {}",
  // 嵌套 worker 绕过:dedicated worker 内 new Worker 有独立全局(其 fetch 未禁),禁构造
  "try { self.Worker = undefined } catch {}",
  "try { self.SharedWorker = undefined } catch {}",
  // 其它同源/网络侧信道
  "try { self.EventSource = undefined } catch {}",
  "try { self.BroadcastChannel = undefined } catch {}",
  "if (self.navigator && self.navigator.sendBeacon) self.navigator.sendBeacon = () => { throw new Error('sendBeacon 已被沙箱禁用') }",
].join('\n')

export function runSandboxedScript(
  data: unknown,
  script: string,
  timeoutMs = 3000,
): Promise<EvalResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    let done = false
    const finish = (r: Omit<EvalResult, 'elapsedMs'>) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        worker.terminate()
      } catch {}
      URL.revokeObjectURL(url)
      resolve({ ...r, elapsedMs: Date.now() - start })
    }
    const workerCode =
      WORKER_PREAMBLE +
      '\nself.onmessage = async (e) => {\n' +
      '  try {\n' +
      '    const fn = new Function("data", e.data.script);\n' +
      '    let result = fn(e.data.data);\n' +
      '    if (result && typeof result.then === "function") result = await result;\n' +
      '    self.postMessage({ ok: true, result });\n' +
      '  } catch (err) {\n' +
      '    self.postMessage({ ok: false, error: String((err && err.message) || err) });\n' +
      '  }\n' +
      '};'
    let url = '' // 空串初始:createObjectURL 失败时 catch 的 if(url) 为假,不 revoke(正确);成功后被覆盖
    let worker: Worker
    try {
      const blob = new Blob([workerCode], { type: 'application/javascript' })
      url = URL.createObjectURL(blob)
      worker = new Worker(url)
    } catch (e) {
      // createObjectURL 已成功但 new Worker 抛错:url 已分配需释放,防每次创建失败累积泄漏 blob URL
      if (url) URL.revokeObjectURL(url)
      resolve({ ok: false, error: `无法创建 Worker 沙箱: ${(e as Error).message}`, elapsedMs: 0 })
      return
    }
    const timer = setTimeout(() => finish({ ok: false, error: `脚本执行超时(${timeoutMs}ms),已终止` }), timeoutMs)
    worker.onmessage = (e: MessageEvent) => finish(e.data)
    worker.onerror = (e: ErrorEvent) => finish({ ok: false, error: e.message || 'Worker 运行错误' })
    try {
      worker.postMessage({ data, script })
    } catch (e) {
      finish({ ok: false, error: `数据无法传递给 Worker(可能含不可克隆值): ${(e as Error).message}` })
    }
  })
}

